# CiviForm Program Architect

A 3-step U.S. Web Design System (USWDS) web application for designing, reviewing, validating, and visualizing CiviForm program migration JSON files.

## Features

- **Step 1 — Define Program**: Configure target jurisdiction, single or dual-program suite generation (with automatic shared universal question harmonization), program archetype, custom instructions, and upload PDFs or fetch web pages as source material. Includes a built-in `test` jurisdiction mode for instant previewing without LLM API calls.
- **Step 2 — Review & Edit**: Interactive USWDS multiselectable accordions to review and edit program details, application overview steps (1–5 steps), and screens, questions, and conditional logic.
- **Step 3 — Export & Visualize**: Generates CiviForm-compatible JSON, runs 12-rule schema validation (`scripts/validate_civiform_json.py`), and renders an interactive CiviForm flowchart visualizer (`public/visualizer/`).

## Project Structure

```
program-architect/
├── server.py                      # Python HTTP & API server (/api/validate, /api/fetch-url, /api/gemini)
├── requirements.txt               # Python dependencies
├── Dockerfile                     # Container image for Cloud Run / Docker deployment
├── LICENSE
├── .gitignore
├── README.md
├── public/
│   ├── index.html                 # Redirects to program-generator.html
│   ├── program-generator.html     # Main 3-step USWDS application
│   ├── assets/
│   │   └── logo.svg
│   └── visualizer/
│       ├── README.md
│       ├── civiform-visualizer.css
│       └── civiform-visualizer.js
└── scripts/
    ├── __init__.py
    ├── validate_civiform_json.py
    └── civiform_builder.py
```

## Local Development

1. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

2. Set your LLM API key (optional — can also be entered in the UI or bypassed using `test` as the jurisdiction):

   ```bash
   export GEMINI_API_KEY="your-api-key"
   ```

3. Start the server:

   ```bash
   python3 server.py 8765
   ```

4. Open `http://localhost:8765/program-generator.html` in your browser.

## Container / Cloud Deployment

```bash
docker build -t civiform-program-architect .
docker run -p 8080:8080 -e GEMINI_API_KEY="your-api-key" civiform-program-architect
```
