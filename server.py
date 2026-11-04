#!/usr/bin/env python3
"""Local HTTP & API server for the CiviForm Program Architect UI.

Serves static files from public/ and provides:
  - GET  /api/health
  - GET  /api/fetch-url?url=<encoded_url>
  - POST /api/validate (runs validate_civiform_json.py)
  - POST /api/gemini (proxies LLM requests using user key or environment variables)
  - GET  /sample-benefit-form.pdf (built-in sample PDF for URL testing)
"""

import base64
import http.server
import importlib
import json
import os
from pathlib import Path
import re
import socket
import socketserver
import sys
import urllib.error
import urllib.parse
import urllib.request

from bs4 import BeautifulSoup

BASE_DIR = Path(__file__).resolve().parent
PROTOTYPES_DIR = BASE_DIR / "public"
SKILL_SCRIPTS_DIR = BASE_DIR / "scripts"
sys.path.insert(0, str(SKILL_SCRIPTS_DIR))

import validate_civiform_json  # noqa: E402


def get_local_api_key(provider: str = "gemini") -> str:
  provider = (provider or "gemini").strip().lower()
  if provider == "anthropic":
    return (os.environ.get("ANTHROPIC_API_KEY") or "").strip()
  if provider == "openai":
    return (os.environ.get("OPENAI_API_KEY") or "").strip()

  env_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
  if env_key:
    return env_key.strip()
  key_path = Path.home() / "google_api_key"
  if key_path.exists():
    try:
      return key_path.read_text(encoding="utf-8").strip()
    except OSError:
      pass
  return ""


def build_sample_pdf_bytes() -> bytes:
  """Builds a valid multi-section PDF document for testing PDF URL extraction."""
  lines = [
      "MUNICIPAL RESIDENT ASSISTANCE & WORKFORCE APPLICATION",
      "Instructions: Complete all sections below to apply for resident assistance and career training.",
      "Section 1: Applicant Identity and Contact Information",
      "1. First Name: ______________________",
      "2. Middle Name: _____________________",
      "3. Last Name: _______________________",
      "4. Date of Birth (Must be 18 years or older): ____/____/______",
      "5. Residential Street Address: _______________________________",
      "6. City: _________________ State: _____ Zip Code: __________",
      "7. Email Address: ___________________________",
      "8. Primary Phone Number: ____________________",
      "Section 2: Residency and Household Eligibility",
      "9. Do you currently reside within the municipality? ( ) Yes  ( ) No",
      "10. Number of people in household: ________",
      "11. Total Gross Annual Household Income ($): $______________",
      "12. Are you currently self-employed or operating a sole proprietorship? ( ) Yes  ( ) No",
      "Section 3: Conditional Self-Employment Details (Complete only if Yes to Question 12)",
      "13. If yes, describe your self-employment business or trade: ________________________",
      "14. Average monthly net self-employment earnings ($): $______________",
      "Section 4: Supporting Documentation",
      "15. Please upload a copy of your government-issued photo ID and proof of residency.",
      "For Office Use Only: Reviewer ID _______ Date Received _______ Approved ( ) Denied ( )",
  ]

  stream_cmds = ["BT", "/F1 11 Tf", "50 750 Td", "18 TL"]
  for line in lines:
    escaped = (
        line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    )
    stream_cmds.append(f"({escaped}) Tj T*")
  stream_cmds.append("ET")
  stream_data = "\n".join(stream_cmds).encode("latin-1")

  objects = [
      b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
      b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
      (
          b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
          b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
      ),
      (
          f"4 0 obj\n<< /Length {len(stream_data)} >>\nstream\n".encode("latin-1")
          + stream_data
          + b"\nendstream\nendobj\n"
      ),
      b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ]

  out = bytearray(b"%PDF-1.4\n")
  offsets = [0]
  for obj in objects:
    offsets.append(len(out))
    out.extend(obj)
  xref_pos = len(out)
  out.extend(f"xref\n0 {len(offsets)}\n".encode("latin-1"))
  out.extend(b"0000000000 65535 f \n")
  for off in offsets[1:]:
    out.extend(f"{off:010d} 00000 n \n".encode("latin-1"))
  out.extend(
      f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode(
          "latin-1"
      )
  )
  return bytes(out)


class ReusableTCPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
  allow_reuse_address = True
  address_family = socket.AF_INET6

  def server_bind(self):
    self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    super().server_bind()


class ArchitectRequestHandler(http.server.SimpleHTTPRequestHandler):
  """HTTP handler for static files and Program Architect API routes."""

  def __init__(self, *args, **kwargs):
    super().__init__(*args, directory=str(PROTOTYPES_DIR), **kwargs)

  def end_headers(self):
    self.send_header(
        "Cache-Control", "no-store, no-cache, must-revalidate, max-age=0"
    )
    self.send_header("Pragma", "no-cache")
    self.send_header("Expires", "0")
    super().end_headers()

  def send_json(self, status_code: int, payload: dict):
    body = json.dumps(payload).encode("utf-8")
    self.send_response(status_code)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.send_header("Access-Control-Allow-Origin", "*")
    self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    self.send_header("Access-Control-Allow-Headers", "Content-Type")
    self.end_headers()
    self.wfile.write(body)

  def do_OPTIONS(self):
    self.send_response(204)
    self.send_header("Access-Control-Allow-Origin", "*")
    self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    self.send_header("Access-Control-Allow-Headers", "Content-Type")
    self.end_headers()

  def do_GET(self):
    parsed = urllib.parse.urlparse(self.path)
    if parsed.path == "/api/health":
      has_key = bool(get_local_api_key("gemini"))
      self.send_json(
          200,
          {
              "ok": True,
              "hasLocalApiKey": has_key,
              "authMethod": "api-key" if has_key else "none",
          },
      )
      return

    if parsed.path == "/sample-benefit-form.pdf":
      pdf_bytes = build_sample_pdf_bytes()
      self.send_response(200)
      self.send_header("Content-Type", "application/pdf")
      self.send_header("Content-Length", str(len(pdf_bytes)))
      self.send_header("Access-Control-Allow-Origin", "*")
      self.end_headers()
      self.wfile.write(pdf_bytes)
      return

    if parsed.path == "/api/fetch-url":
      qs = urllib.parse.parse_qs(parsed.query)
      target_url = (qs.get("url") or [""])[0].strip()
      if not target_url:
        self.send_json(400, {"ok": False, "error": "Missing url parameter."})
        return
      self.handle_fetch_url(target_url)
      return

    super().do_GET()

  def do_POST(self):
    parsed = urllib.parse.urlparse(self.path)
    content_len = int(self.headers.get("Content-Length", "0") or "0")
    raw_body = self.rfile.read(content_len) if content_len > 0 else b"{}"
    try:
      data = json.loads(raw_body.decode("utf-8"))
    except Exception as e:
      self.send_json(400, {"ok": False, "error": f"Invalid JSON body: {e}"})
      return

    if parsed.path == "/api/validate":
      self.handle_validate(data)
      return

    if parsed.path == "/api/gemini":
      self.handle_gemini_proxy(data)
      return

    self.send_json(404, {"ok": False, "error": "Unknown API endpoint."})

  def handle_fetch_url(self, target_url: str):
    if target_url.endswith("/sample-benefit-form.pdf") or target_url == "sample-benefit-form.pdf":
      pdf_bytes = build_sample_pdf_bytes()
      self.send_json(
          200,
          {
              "ok": True,
              "kind": "pdf",
              "url": target_url,
              "filename": "sample-benefit-form.pdf",
              "base64": base64.b64encode(pdf_bytes).decode("ascii"),
          },
      )
      return

    if not re.match(r"^https?://", target_url, re.I):
      target_url = "https://" + target_url

    try:
      req = urllib.request.Request(
          target_url,
          headers={
              "User-Agent": (
                  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
              ),
              "Accept": (
                  "application/pdf,text/html,application/xhtml+xml,text/plain,*/*"
              ),
          },
      )
      with urllib.request.urlopen(req, timeout=15) as resp:
        content_type = (resp.headers.get("Content-Type") or "").lower()
        raw_bytes = resp.read(15 * 1024 * 1024)  # Up to 15 MB
    except Exception as e:
      self.send_json(
          200,
          {
              "ok": False,
              "error": f"Could not fetch URL ({e}).",
              "url": target_url,
          },
      )
      return

    is_pdf = (
        "application/pdf" in content_type
        or target_url.lower().split("?")[0].endswith(".pdf")
        or raw_bytes.startswith(b"%PDF-")
    )
    if is_pdf:
      filename = target_url.split("?")[0].rstrip("/").split("/")[-1] or "remote-document.pdf"
      if not filename.lower().endswith(".pdf"):
        filename += ".pdf"
      self.send_json(
          200,
          {
              "ok": True,
              "kind": "pdf",
              "url": target_url,
              "filename": filename,
              "base64": base64.b64encode(raw_bytes).decode("ascii"),
          },
      )
      return

    # Parse HTML or plain text
    html_text = raw_body_to_text(raw_bytes)
    soup = BeautifulSoup(html_text, "html.parser")

    # Discover linked PDFs / CivicPlus DocumentCenter / DocAccess documents before decomposing
    pdf_links = []
    seen_pdf_urls = set()
    for a_tag in soup.find_all("a", href=True):
      href = (a_tag.get("href") or "").strip()
      if not href or href.startswith("#") or href.lower().startswith("javascript:"):
        continue
      full_url = urllib.parse.urljoin(target_url, href)
      if re.search(r"(\.pdf(?:$|[?#])|/DocumentCenter/View/|/Archive\.aspx\?ADID=|docaccess)", full_url, re.I):
        if full_url not in seen_pdf_urls:
          seen_pdf_urls.add(full_url)
          link_text = a_tag.get_text(" ", strip=True) or full_url.split("/")[-1]
          pdf_links.append({"title": link_text[:140], "url": full_url})

    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer"]):
      tag.decompose()

    title = ""
    if soup.title and soup.title.string:
      title = soup.title.string.strip()
    if not title:
      h1 = soup.find("h1")
      if h1:
        title = h1.get_text(" ", strip=True)

    headings = []
    for h in soup.find_all(["h1", "h2", "h3"]):
      ht = h.get_text(" ", strip=True)
      if ht and len(ht) < 140 and ht not in headings:
        headings.append(ht)

    fields = []
    for label in soup.find_all("label"):
      lt = label.get_text(" ", strip=True)
      if lt and 2 <= len(lt) <= 160:
        fields.append(lt)

    lines = [
        line.strip()
        for line in soup.get_text("\n").splitlines()
        if line.strip()
    ]
    clean_text = "\n".join(lines[:400])

    has_docaccess_hash = "#docaccess-" in target_url.lower()
    is_directory_page = bool(
        has_docaccess_hash
        or (len(pdf_links) >= 2 and len(fields) == 0)
        or re.search(r"/(documents|forms|fees|documentcenter)(?:[/?#]|$)", target_url, re.I)
    )

    self.send_json(
        200,
        {
            "ok": True,
            "kind": "webpage",
            "url": target_url,
            "title": title,
            "headings": headings[:25],
            "fields": fields[:60],
            "pdfLinks": pdf_links[:25],
            "hasDocAccessHash": has_docaccess_hash,
            "isDirectoryPage": is_directory_page,
            "text": clean_text[:30000],
        },
    )

  def handle_validate(self, data: dict):
    program_json = data.get("programJson") if "programJson" in data else data
    programs_list = data.get("programs")
    try:
      importlib.reload(validate_civiform_json)
      issues = []
      if isinstance(programs_list, list) and len(programs_list) >= 2:
        loaded = []
        for idx, p_json in enumerate(programs_list):
          label = f"program-{idx + 1}.json"
          loaded.append((label, p_json))
          issues.extend(validate_civiform_json.validate_single_program(p_json, label))
        issues.extend(validate_civiform_json.validate_multi_program_suite(loaded))
      else:
        issues = validate_civiform_json.validate_single_program(
            program_json, "generated-program.json"
        )
      errors = [
          f"{i.path}: {i.message}" for i in issues if i.severity == "ERROR"
      ]
      warnings = [
          f"{i.path}: {i.message}" for i in issues if i.severity == "WARNING"
      ]
      self.send_json(
          200,
          {
              "ok": True,
              "valid": len(errors) == 0,
              "errors": errors,
              "warnings": warnings,
          },
      )
    except Exception as e:
      self.send_json(500, {"ok": False, "error": str(e)})

  def handle_gemini_proxy(self, data: dict):
    provider = (data.get("provider") or "gemini").strip().lower()
    api_key = (data.get("apiKey") or "").strip() or get_local_api_key(provider)
    model = (data.get("model") or "gemini-3.5-flash").strip()
    payload = data.get("payload") or {}

    if not api_key:
      self.send_json(
          200,
          {
              "ok": False,
              "error": f"No API key provided for {provider}.",
          },
      )
      return

    if provider == "anthropic":
      endpoint = "https://api.anthropic.com/v1/messages"
      headers = {
          "Content-Type": "application/json",
          "x-api-key": api_key,
          "anthropic-version": "2023-06-01",
      }
    elif provider == "openai":
      endpoint = "https://api.openai.com/v1/chat/completions"
      headers = {
          "Content-Type": "application/json",
          "Authorization": f"Bearer {api_key}",
      }
    else:
      if isinstance(payload.get("contents"), list):
        for c in payload["contents"]:
          if isinstance(c, dict):
            for p in c.get("parts") or []:
              if isinstance(p, dict):
                if "inline_data" in p and "inlineData" not in p:
                  p["inlineData"] = {
                      "mimeType": (
                          p["inline_data"].get("mime_type")
                          or p["inline_data"].get("mimeType")
                      ),
                      "data": p["inline_data"].get("data"),
                  }
                  del p["inline_data"]
      endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{urllib.parse.quote(model)}:generateContent?key={urllib.parse.quote(api_key)}"
      headers = {"Content-Type": "application/json"}

    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
      with urllib.request.urlopen(req, timeout=90) as resp:
        resp_body = json.loads(resp.read().decode("utf-8"))
        self.send_json(200, {"ok": True, "modelUsed": model, "response": resp_body})
    except urllib.error.HTTPError as e:
      err_body = e.read().decode("utf-8", errors="replace")
      self.send_json(
          200,
          {
              "ok": False,
              "error": f"{provider.upper()} HTTP {e.code}: {err_body[:500]}",
          },
      )
    except Exception as e:
      self.send_json(200, {"ok": False, "error": str(e)})


def raw_body_to_text(raw_bytes: bytes) -> str:
  for enc in ("utf-8", "latin-1"):
    try:
      return raw_bytes.decode(enc)
    except UnicodeDecodeError:
      continue
  return raw_bytes.decode("utf-8", errors="replace")


if __name__ == "__main__":
  port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8765"))
  with ReusableTCPServer(("::", port), ArchitectRequestHandler) as httpd:
    print(f"Serving CiviForm Program Architect on http://[::]:{port}", flush=True)
    httpd.serve_forever()
