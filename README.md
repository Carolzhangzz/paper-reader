# Paper Reader

A web-based academic paper reader with side-by-side translation, AI-powered summarization, and Q&A chat.

Paste an arXiv URL, DOI, or any paper link — get instant Chinese/English translation, structured summaries, and interactive Q&A, all in a clean dark-themed interface.

## Features

- **PDF Viewer** — Renders the original paper with Retina-sharp quality, zoom controls
- **Section Outline** — Collapsible sidebar listing all paper sections for quick navigation
- **Instant Translation** — Google Translate powered, section-by-section streaming (free, no API key)
- **AI Summary** — Auto-generates structured summaries via Claude CLI
- **Key Points Extraction** — Contributions, methodology, results, limitations
- **Q&A Chat** — Ask questions about the paper with context-aware answers
- **Smart URL Resolution** — Supports arXiv, DOI, Semantic Scholar, HuggingFace, ADS, and direct PDF links

## Architecture

```
Frontend (Vanilla HTML/CSS/JS)          Backend (FastAPI)
┌─────────────────────────────┐        ┌──────────────────────────┐
│  PDF.js viewer  │ Translation│        │  Paper Ingestion         │
│  Section outline│ Summary    │◄──SSE──│  (PyMuPDF + httpx)       │
│  Zoom controls  │ Key Points │        │                          │
│  Q&A Chat panel │            │        │  Google Translate         │
└─────────────────────────────┘        │  (deep-translator)       │
                                       │                          │
                                       │  Claude CLI              │
                                       │  (summary/chat/extract)  │
                                       └──────────────────────────┘
```

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Backend | Python + FastAPI | API server, PDF parsing, streaming |
| PDF Parsing | PyMuPDF (fitz) | Text extraction, section detection |
| Translation | deep-translator (Google Translate) | Fast, free translation |
| AI Features | Claude Code CLI (`claude -p`) | Summary, key points, Q&A |
| Frontend | Vanilla HTML/CSS/JS + PDF.js | No build step, dark theme |

## Quick Start

### Prerequisites

- Python 3.11+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

### Setup

```bash
git clone https://github.com/Carolzhangzz/paper-reader.git
cd paper-reader
pip install -r requirements.txt
```

### Run

```bash
uvicorn backend.main:app --reload --port 8899
```

Open http://localhost:8899 in your browser.

### Usage

1. Paste a paper URL (arXiv, DOI, PDF link, etc.)
2. Click **Load** — the PDF renders on the left with a section outline
3. Click **Translate** — instant translation streams on the right
4. Switch tabs to **Summary** or **Key Points** for AI analysis
5. Click **Q&A** to chat about the paper

## Supported URL Formats

| Source | Example |
|--------|---------|
| arXiv | `https://arxiv.org/abs/2301.00234` |
| DOI | `https://doi.org/10.1234/...` |
| Semantic Scholar | `https://semanticscholar.org/paper/...` |
| HuggingFace | `https://huggingface.co/papers/...` |
| NASA ADS | `https://ui.adsabs.harvard.edu/abs/...` |
| Direct PDF | Any `.pdf` URL |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PAPER_READER_MODEL` | `claude-haiku-4-5-20251001` | Claude model for AI features |

## License

MIT
