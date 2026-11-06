#!/usr/bin/env python3
"""HTTP server for CiviForm Program Architect UI + JSON Validator & LLM API Proxy."""

import base64
from html.parser import HTMLParser
import http.server
import json
import os
import re
import shutil
import socket
import socketserver
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(REPO_ROOT, "public")
SCRIPTS_DIR = os.path.join(REPO_ROOT, "scripts")

sys.path.insert(0, SCRIPTS_DIR)
import validate_civiform_json


def _extract_pdf_text_with_pdftotext(raw_bytes: bytes) -> str:
  """Extracts layout-preserved text from PDF bytes using pdftotext if available."""
  pdftotext_bin = shutil.which("pdftotext") or (
      "/usr/bin/pdftotext" if os.path.exists("/usr/bin/pdftotext") else None
  )
  if not pdftotext_bin or not raw_bytes:
    return ""
  try:
    proc = subprocess.run(
        [pdftotext_bin, "-layout", "-", "-"],
        input=raw_bytes,
        capture_output=True,
        timeout=15,
    )
    if proc.returncode == 0 and proc.stdout:
      return proc.stdout.decode("utf-8", errors="replace").strip()
  except Exception:
    pass
  return ""


class _SimpleHTMLTextExtractor(HTMLParser):
  """Extracts visible text, title, headings, and form field labels from HTML."""

  def __init__(self):
    super().__init__()
    self._skip_depth = 0
    self._in_title = False
    self._in_heading = False
    self._in_label = False
    self.title_parts = []
    self.headings = []
    self.labels = []
    self.text_chunks = []
    self._current_buf = []

  def handle_starttag(self, tag, attrs):
    t = tag.lower()
    if t in ("script", "style", "noscript", "svg", "head"):
      if t != "head":
        self._skip_depth += 1
      return
    if self._skip_depth > 0:
      return
    if t == "title":
      self._in_title = True
      self._current_buf = []
    elif t in ("h1", "h2", "h3", "h4", "legend"):
      self._in_heading = True
      self._current_buf = []
    elif t == "label":
      self._in_label = True
      self._current_buf = []
    elif t == "input":
      attr_dict = dict(attrs)
      placeholder = (attr_dict.get("placeholder") or "").strip()
      aria_label = (attr_dict.get("aria-label") or "").strip()
      name = (attr_dict.get("name") or "").strip()
      label_cand = aria_label or placeholder or name
      if label_cand and len(label_cand) < 120:
        self.labels.append(label_cand)

  def handle_endtag(self, tag):
    t = tag.lower()
    if t in ("script", "style", "noscript", "svg"):
      self._skip_depth = max(0, self._skip_depth - 1)
      return
    if self._skip_depth > 0:
      return
    if t == "title" and self._in_title:
      self._in_title = False
      txt = " ".join("".join(self._current_buf).split())
      if txt:
        self.title_parts.append(txt)
    elif t in ("h1", "h2", "h3", "h4", "legend") and self._in_heading:
      self._in_heading = False
      txt = " ".join("".join(self._current_buf).split())
      if txt:
        self.headings.append(txt)
    elif t == "label" and self._in_label:
      self._in_label = False
      txt = " ".join("".join(self._current_buf).split())
      if txt:
        self.labels.append(txt)
    elif t in ("p", "li", "div", "tr", "br", "section", "article"):
      self.text_chunks.append("\n")

  def handle_data(self, data):
    if self._in_title or self._in_heading or self._in_label:
      self._current_buf.append(data)
    if self._skip_depth == 0:
      cleaned = " ".join(data.split())
      if cleaned:
        self.text_chunks.append(cleaned + " ")


classReusableTCPServer = socketserver.ThreadingTCPServer


class DualStackServer(classReusableTCPServer):
  allow_reuse_address = True
  address_family = socket.AF_INET6

  def server_bind(self):
    self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    super().server_bind()


class ArchitectHandler(http.server.SimpleHTTPRequestHandler):

  def __init__(self, *args, **kwargs):
    super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

  def end_headers(self):
    self.send_header("Access-Control-Allow-Origin", "*")
    self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    self.send_header("Access-Control-Allow-Headers", "Content-Type")
    super().end_headers()

  def do_OPTIONS(self):
    self.send_response(204)
    self.end_headers()

  def do_GET(self):
    parsed = urllib.parse.urlsplit(self.path)

    if parsed.path == "/api/health":
      self.send_response(200)
      self.send_header("Content-Type", "application/json")
      self.end_headers()
      self.wfile.write(
          json.dumps(
              {"status": "ok", "service": "civiform-program-architect"}
          ).encode("utf-8")
      )
      return

    if parsed.path == "/api/fetch-url":
      qs = urllib.parse.parse_qs(parsed.query)
      target_url = (qs.get("url") or [""])[0].strip()
      label_hint = ""
      # Support lines where user typed "Program Name: https://..."
      url_match = re.search(r"(https?://\S+)", target_url, re.IGNORECASE)
      if url_match:
        prefix_part = target_url[: url_match.start()].strip().rstrip(":-–—")
        if prefix_part:
          label_hint = prefix_part.strip()
        target_url = url_match.group(1).strip()
      elif target_url and not target_url.lower().startswith(
          ("http://", "https://")
      ):
        if "." in target_url and " " not in target_url:
          target_url = "https://" + target_url

      if not target_url or not target_url.lower().startswith(
          ("http://", "https://")
      ):
        self._send_json(
            400,
            {"ok": False, "error": "Invalid or missing http(s) URL"},
        )
        return

      try:
        ctx = ssl.create_default_context()
        req = urllib.request.Request(
            target_url,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 "
                    "CiviFormProgramArchitect/2.0"
                ),
                "Accept": (
                    "text/html,application/xhtml+xml,application/pdf,"
                    "application/xml;q=0.9,*/*;q=0.8"
                ),
            },
        )
        with urllib.request.urlopen(req, timeout=20, context=ctx) as resp:
          content_type = (
              resp.headers.get("Content-Type") or ""
          ).lower().strip()
          content_disp = resp.headers.get("Content-Disposition") or ""
          raw_bytes = resp.read(20 * 1024 * 1024)  # 20 MB max

        is_pdf = (
            "application/pdf" in content_type
            or target_url.lower().split("?")[0].endswith(".pdf")
            or raw_bytes[:5] == b"%PDF-"
        )

        if is_pdf:
          b64_data = base64.b64encode(raw_bytes).decode("ascii")
          fname = (
              target_url.split("?")[0].rstrip("/").split("/")[-1]
              or "remote.pdf"
          )
          cd_match = re.search(
              r'filename\*?=["\']?(?:UTF-8\'\')?([^"\';\r\n]+)',
              content_disp,
              re.IGNORECASE,
          )
          if cd_match:
            fname = urllib.parse.unquote(cd_match.group(1).strip())
          if not fname.lower().endswith(".pdf"):
            fname += ".pdf"

          extracted_pdf_text = _extract_pdf_text_with_pdftotext(raw_bytes)
          self._send_json(
              200,
              {
                  "ok": True,
                  "url": target_url,
                  "labelHint": label_hint,
                  "kind": "pdf",
                  "contentType": "application/pdf",
                  "filename": fname,
                  "size": len(raw_bytes),
                  "base64": b64_data,
                  "extractedText": extracted_pdf_text,
              },
          )
          return

        html_text = raw_bytes.decode("utf-8", errors="replace")
        extractor = _SimpleHTMLTextExtractor()
        extractor.feed(html_text)
        full_text = re.sub(
            r"\n{3,}", "\n\n", "".join(extractor.text_chunks)
        ).strip()
        title = extractor.title_parts[0] if extractor.title_parts else ""
        if not title and extractor.headings:
          title = extractor.headings[0]

        self._send_json(
            200,
            {
                "ok": True,
                "url": target_url,
                "labelHint": label_hint,
                "kind": "webpage",
                "contentType": content_type or "text/html",
                "title": title[:200],
                "headings": extractor.headings[:40],
                "fields": list(dict.fromkeys(extractor.labels))[:80],
                "text": full_text[:25000],
            },
        )
      except Exception as e:
        self._send_json(
            200,
            {
                "ok": False,
                "url": target_url,
                "error": str(e),
            },
        )
      return

    return super().do_GET()

  def do_POST(self):
    parsed = urllib.parse.urlsplit(self.path)
    if parsed.path == "/api/validate":
      content_len = int(self.headers.get("Content-Length", 0))
      raw_body = self.rfile.read(content_len).decode("utf-8")
      try:
        payload = json.loads(raw_body)
        if (
            isinstance(payload, dict)
            and "programs" in payload
            and isinstance(payload["programs"], list)
        ):
          programs_list = payload["programs"]
          is_valid, messages, report = (
              validate_civiform_json.validate_multi_program_suite(programs_list)
          )
          self._send_json(
              200,
              {
                  "valid": is_valid,
                  "messages": messages,
                  "report": report,
                  "programCount": len(programs_list),
              },
          )
        else:
          program_data = (
              payload.get("programData", payload)
              if isinstance(payload, dict) and "programData" in payload
              else payload
          )
          is_valid, messages, report = (
              validate_civiform_json.validate_program_migration_Wrapper(
                  program_data
              )
          )
          self._send_json(
              200,
              {
                  "valid": is_valid,
                  "messages": messages,
                  "report": report,
                  "programCount": 1,
              },
          )
      except Exception as e:
        self._send_json(
            400,
            {
                "valid": False,
                "messages": [f"Server validation exception: {str(e)}"],
                "report": f"Error: {str(e)}",
            },
        )
      return

    if parsed.path == "/api/extract-pdf-text":
      content_len = int(self.headers.get("Content-Length", 0))
      raw_body = self.rfile.read(content_len).decode("utf-8")
      try:
        req_json = json.loads(raw_body)
        b64_str = (req_json.get("base64") or "").strip()
        if not b64_str:
          self._send_json(400, {"ok": False, "error": "Missing base64 data"})
          return
        raw_bytes = base64.b64decode(b64_str)
        extracted_text = _extract_pdf_text_with_pdftotext(raw_bytes)
        self._send_json(
            200,
            {
                "ok": True,
                "extractedText": extracted_text,
            },
        )
      except Exception as e:
        self._send_json(200, {"ok": False, "error": str(e)})
      return

    if parsed.path == "/api/gemini":
      content_len = int(self.headers.get("Content-Length", 0))
      raw_body = self.rfile.read(content_len).decode("utf-8")
      try:
        req_json = json.loads(raw_body)
        provider = (req_json.get("provider") or "gemini").strip().lower()
        model = (req_json.get("model") or "gemini-2.5-flash").strip()
        api_key = (req_json.get("apiKey") or "").strip()
        gemini_payload = req_json.get("payload") or {}

        ctx = ssl.create_default_context()

        # 1. Anthropic Claude Proxy
        if provider == "anthropic" or model.startswith("claude-"):
          effective_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
          if not effective_key:
            self._send_json(
                400,
                {
                    "ok": False,
                    "error": (
                        f"Missing Anthropic API key for {model}. Provide an API"
                        " key in Step 1 or set ANTHROPIC_API_KEY."
                    ),
                },
            )
            return
          if isinstance(gemini_payload, dict):
            if int(gemini_payload.get("max_tokens") or 0) < 16384:
              gemini_payload["max_tokens"] = 16384
            # Strip heavy inline base64 PDF blocks if extracted text is already rich
            msgs = gemini_payload.get("messages")
            if isinstance(msgs, list):
              total_txt = 0
              for msg in msgs:
                if isinstance(msg, dict) and isinstance(
                    msg.get("content"), list
                ):
                  for blk in msg["content"]:
                    if isinstance(blk, dict) and blk.get("type") == "text":
                      total_txt += len(blk.get("text") or "")
              if total_txt >= 2500:
                for msg in msgs:
                  if isinstance(msg, dict) and isinstance(
                      msg.get("content"), list
                  ):
                    msg["content"] = [
                        blk
                        for blk in msg["content"]
                        if not (
                            isinstance(blk, dict)
                            and blk.get("type") == "document"
                        )
                    ]
          req = urllib.request.Request(
              "https://api.anthropic.com/v1/messages",
              data=json.dumps(gemini_payload).encode("utf-8"),
              headers={
                  "Content-Type": "application/json",
                  "x-api-key": effective_key,
                  "anthropic-version": "2023-06-01",
              },
              method="POST",
          )
          with urllib.request.urlopen(req, timeout=180, context=ctx) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
          self._send_json(
              200,
              {"ok": True, "modelUsed": model, "response": resp_data},
          )
          return

        # 2. OpenAI Proxy
        if (
            provider == "openai"
            or model.startswith("gpt-")
            or model.startswith("o3")
            or model.startswith("o4")
        ):
          effective_key = api_key or os.environ.get("OPENAI_API_KEY", "")
          if not effective_key:
            self._send_json(
                400,
                {
                    "ok": False,
                    "error": (
                        f"Missing OpenAI API key for {model}. Provide an API"
                        " key in Step 1 or set OPENAI_API_KEY."
                    ),
                },
            )
            return
          if isinstance(gemini_payload, dict):
            is_reasoning_model = (
                model.startswith("o3")
                or model.startswith("o4")
                or model.startswith("gpt-5")
            )
            if is_reasoning_model:
              gemini_payload.pop("temperature", None)
              gemini_payload.pop("max_tokens", None)
              gemini_payload["max_completion_tokens"] = 16384
              gemini_payload["reasoning_effort"] = "low"
            elif "max_tokens" not in gemini_payload:
              gemini_payload["max_tokens"] = 16384
          req = urllib.request.Request(
              "https://api.openai.com/v1/chat/completions",
              data=json.dumps(gemini_payload).encode("utf-8"),
              headers={
                  "Content-Type": "application/json",
                  "Authorization": f"Bearer {effective_key}",
              },
              method="POST",
          )
          with urllib.request.urlopen(req, timeout=180, context=ctx) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
          self._send_json(
              200,
              {"ok": True, "modelUsed": model, "response": resp_data},
          )
          return

        # 3. Google Gemini Proxy
        effective_gemini_key = (
            api_key
            or os.environ.get("GEMINI_API_KEY", "")
            or os.environ.get("GOOGLE_API_KEY", "")
        )
        if not effective_gemini_key:
          self._send_json(
              400,
              {
                  "ok": False,
                  "error": (
                      f"Missing Gemini API key for {model}. Provide an API key"
                      " in Step 1 or set GEMINI_API_KEY."
                  ),
              },
          )
          return

        candidate_models = [model]
        if model == "gemini-3.5-flash":
          candidate_models.extend(["gemini-2.5-flash", "gemini-2.5-pro"])
        elif model == "gemini-3.1-pro":
          candidate_models.extend(["gemini-2.5-pro", "gemini-2.5-flash"])
        elif model == "gemini-3.1-flash-lite":
          candidate_models.extend(["gemini-2.5-flash-lite", "gemini-2.5-flash"])
        elif "2.5-flash" not in model:
          candidate_models.append("gemini-2.5-flash")

        # Keep thinkingBudget minimal so structured JSON returns quickly without timeout
        if isinstance(gemini_payload, dict):
          gen_cfg = gemini_payload.setdefault("generationConfig", {})
          if isinstance(gen_cfg, dict) and "thinkingConfig" not in gen_cfg:
            if "pro" in model.lower():
              gen_cfg["thinkingConfig"] = {"thinkingBudget": 128}
            else:
              gen_cfg["thinkingConfig"] = {"thinkingBudget": 0}

          # If prompt already contains rich extracted text (>= 2500 chars), strip redundant inlineData PDFs
          contents_list = gemini_payload.get("contents")
          if isinstance(contents_list, list):
            total_text_chars = 0
            for c_item in contents_list:
              if isinstance(c_item, dict) and isinstance(
                  c_item.get("parts"), list
              ):
                for p_item in c_item["parts"]:
                  if isinstance(p_item, dict) and isinstance(
                      p_item.get("text"), str
                  ):
                    total_text_chars += len(p_item["text"])
            if total_text_chars >= 2500:
              for c_item in contents_list:
                if isinstance(c_item, dict) and isinstance(
                    c_item.get("parts"), list
                ):
                  c_item["parts"] = [
                      p_item
                      for p_item in c_item["parts"]
                      if not (isinstance(p_item, dict) and "inlineData" in p_item)
                  ]

        payload_bytes = json.dumps(gemini_payload).encode("utf-8")
        last_err = "Unknown Gemini proxy error"
        resp_data = None
        used_model = model

        for cand_model in candidate_models:
          try:
            url = (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"{urllib.parse.quote(cand_model)}:generateContent?key="
                f"{urllib.parse.quote(effective_gemini_key)}"
            )
            req = urllib.request.Request(
                url,
                data=payload_bytes,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=180, context=ctx) as resp:
              resp_data = json.loads(resp.read().decode("utf-8"))
              used_model = cand_model
              break
          except urllib.error.HTTPError as he:
            err_body = he.read().decode("utf-8", errors="replace")
            last_err = f"HTTP {he.code} for {cand_model}: {err_body[:300]}"
          except Exception as ex:
            last_err = f"{cand_model} error: {str(ex)}"

        if resp_data is not None:
          self._send_json(
              200,
              {
                  "ok": True,
                  "modelUsed": used_model,
                  "response": resp_data,
              },
          )
        else:
          self._send_json(
              200,
              {
                  "ok": False,
                  "error": last_err,
              },
          )
      except Exception as e:
        self._send_json(
            200,
            {
                "ok": False,
                "error": str(e),
            },
        )
      return

    self.send_error(404, "Endpoint not found")

  def _send_json(self, status_code, data):
    body = json.dumps(data).encode("utf-8")
    self.send_response(status_code)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)


if __name__ == "__main__":
  port = int(
      sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PORT", "8765")
  )
  with DualStackServer(("::", port), ArchitectHandler) as httpd:
    print(f"Serving CiviForm Program Architect on http://[::]:{port}")
    sys.stdout.flush()
    httpd.serve_forever()
