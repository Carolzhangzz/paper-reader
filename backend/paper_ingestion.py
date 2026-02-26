import os
import re
import asyncio
import hashlib
import logging
import httpx
import fitz  # PyMuPDF
from xml.etree import ElementTree

logger = logging.getLogger(__name__)

# In-memory paper store
_papers: dict[str, dict] = {}


def get_paper(paper_id: str) -> dict | None:
    return _papers.get(paper_id)


def store_paper(paper: dict) -> str:
    pid = hashlib.md5(paper["fullText"][:500].encode()).hexdigest()[:12]
    paper["id"] = pid
    _papers[pid] = paper
    return pid


# ===== URL Classification =====

def classify_url(url: str) -> dict:
    url = url.strip()
    if not url:
        return {"type": "invalid"}

    # Bare arxiv ID: 2301.00234
    if re.match(r'^\d{4}\.\d{4,5}(v\d+)?$', url):
        return {"type": "arxiv", "id": url}

    # arxiv.org/abs/... or arxiv.org/pdf/...
    m = re.search(r'arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5}(?:v\d+)?)', url)
    if m:
        return {"type": "arxiv", "id": m.group(1)}

    # ADS (NASA): ui.adsabs.harvard.edu/abs/2025arXiv251023947L
    m = re.search(r'arXiv(\d{2})(\d{2})(\d{4,5})', url)
    if m:
        arxiv_id = f"{m.group(1)}{m.group(2)}.{m.group(3)}"
        return {"type": "arxiv", "id": arxiv_id}

    # Semantic Scholar: semanticscholar.org/paper/...
    # HuggingFace papers: huggingface.co/papers/2301.00234
    m = re.search(r'huggingface\.co/papers/(\d{4}\.\d{4,5})', url)
    if m:
        return {"type": "arxiv", "id": m.group(1)}

    # DOI
    m = re.search(r'(10\.\d{4,}/\S+)', url)
    if m:
        return {"type": "doi", "doi": m.group(1)}

    # Direct PDF URL
    if re.search(r'\.pdf(\?.*)?$', url, re.I):
        return {"type": "pdf", "url": url}

    # Generic URL — needs resolution
    if url.startswith("http"):
        return {"type": "unknown", "url": url}

    return {"type": "invalid"}


# ===== Claude CLI URL Resolution =====

async def resolve_url_with_claude(url: str) -> dict:
    """Use claude CLI to extract arxiv ID or PDF link from any URL."""
    prompt = (
        f"Given this academic paper URL: {url}\n\n"
        "Extract the arxiv ID (format: YYMM.NNNNN like 2301.00234) if this is an arxiv paper. "
        "If not arxiv, provide the direct PDF download URL.\n\n"
        "Reply with ONLY one line in one of these formats:\n"
        "arxiv:2301.00234\n"
        "pdf:https://example.com/paper.pdf\n"
        "none\n\n"
        "No explanation. Just the ID or URL."
    )

    env = os.environ.copy()
    env.pop("CLAUDECODE", None)

    proc = await asyncio.create_subprocess_exec(
        "claude", "-p", prompt,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )
    stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
    result = stdout.decode().strip()
    logger.info(f"Claude resolved '{url}' -> '{result}'")

    # Parse response
    for line in result.split("\n"):
        line = line.strip()
        if line.startswith("arxiv:"):
            arxiv_id = line[6:].strip()
            # Validate format
            if re.match(r'\d{4}\.\d{4,5}(v\d+)?$', arxiv_id):
                return {"type": "arxiv", "id": arxiv_id}
        elif line.startswith("pdf:"):
            pdf_url = line[4:].strip()
            if pdf_url.startswith("http"):
                return {"type": "pdf", "url": pdf_url}

    return {"type": "invalid"}


# ===== ArXiv Metadata =====

async def fetch_arxiv_metadata(arxiv_id: str) -> dict:
    api_url = f"https://export.arxiv.org/api/query?id_list={arxiv_id}"
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(api_url)
        resp.raise_for_status()

    ns = {"a": "http://www.w3.org/2005/Atom"}
    root = ElementTree.fromstring(resp.text)
    entry = root.find("a:entry", ns)
    if entry is None:
        return {}

    title = (entry.findtext("a:title", "", ns) or "").strip().replace("\n", " ")
    abstract = (entry.findtext("a:summary", "", ns) or "").strip().replace("\n", " ")
    authors = [a.findtext("a:name", "", ns) for a in entry.findall("a:author", ns)]
    published = entry.findtext("a:published", "", ns)

    return {"title": title, "authors": authors, "abstract": abstract, "published": published}


# ===== PDF Download =====

async def download_pdf(url: str) -> bytes:
    async with httpx.AsyncClient(timeout=60, follow_redirects=True, max_redirects=10) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        if len(resp.content) > 50 * 1024 * 1024:
            raise ValueError("PDF too large (>50MB)")

        # Check if we actually got a PDF
        content_type = resp.headers.get("content-type", "")
        if "html" in content_type and not resp.content[:5] == b'%PDF-':
            raise ValueError(
                f"URL returned HTML, not a PDF. The page might require authentication or the URL isn't a direct PDF link."
            )

        return resp.content


# ===== PDF Text Extraction (PyMuPDF) =====

def extract_text_from_pdf(pdf_bytes: bytes) -> dict:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = []
    for page in doc:
        pages.append(page.get_text())
    doc.close()

    full_text = "\n\n".join(pages)
    sections = detect_sections(full_text)

    return {
        "pages": pages,
        "fullText": full_text,
        "sections": sections,
        "numPages": len(pages),
    }


# ===== Section Detection =====

HEADING_PATTERNS = [
    re.compile(
        r'^(?:\d+\.?\s+)?'
        r'(Abstract|Introduction|Related Work|Background|Methodology|Methods?|'
        r'Approach|Model|Experiments?|Results?|Discussion|Conclusions?|'
        r'Acknowledgments?|References|Appendix|Evaluation|Implementation|'
        r'System Overview|Problem (?:Statement|Definition|Formulation)|'
        r'Proposed (?:Method|Approach|Framework|System)|'
        r'Experimental (?:Setup|Results|Evaluation)|'
        r'Limitations?|Future Work|Datasets?|Training|Analysis|Summary)\b',
        re.I,
    ),
    re.compile(r'^(?:[\dIVXivx]+\.?\s+)[A-Z][A-Za-z\s]{2,50}$'),
    re.compile(r'^\d+\.\d*\s+[A-Z][A-Za-z\s]{2,50}$'),
]


def detect_sections(text: str) -> list[dict]:
    lines = text.split("\n")
    sections: list[dict] = []
    current = {"heading": "Header", "content": ""}

    for line in lines:
        trimmed = line.strip()
        if not trimmed:
            current["content"] += "\n"
            continue

        is_heading = len(trimmed) < 80 and any(p.match(trimmed) for p in HEADING_PATTERNS)

        if is_heading:
            if current["content"].strip():
                sections.append({"heading": current["heading"], "content": current["content"].strip()})
            current = {"heading": trimmed, "content": ""}
        else:
            current["content"] += trimmed + " "

    if current["content"].strip():
        sections.append({"heading": current["heading"], "content": current["content"].strip()})

    if not sections:
        sections.append({"heading": "Full Text", "content": text.strip()})

    return sections


# ===== Main Load Flow =====

async def load_paper(url: str) -> dict:
    classified = classify_url(url)

    # For unknown URLs, use Claude CLI to resolve
    if classified["type"] in ("unknown", "invalid"):
        logger.info(f"Unknown URL format, asking Claude to resolve: {url}")
        classified = await resolve_url_with_claude(url)
        if classified["type"] == "invalid":
            raise ValueError(
                "Could not identify paper from this URL. "
                "Try an arXiv URL (e.g. arxiv.org/abs/2301.00234), DOI, or direct PDF link."
            )

    metadata = {}

    # ArXiv: get metadata + PDF
    if classified["type"] == "arxiv":
        arxiv_id = classified["id"]
        logger.info(f"Loading arxiv paper: {arxiv_id}")
        try:
            metadata = await fetch_arxiv_metadata(arxiv_id)
        except Exception as e:
            logger.warning(f"Failed to fetch arxiv metadata: {e}")
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"

    elif classified["type"] == "doi":
        pdf_url = f"https://doi.org/{classified['doi']}"

    else:
        pdf_url = classified.get("url", url)

    # Download PDF
    logger.info(f"Downloading PDF from: {pdf_url}")
    pdf_bytes = await download_pdf(pdf_url)

    # Extract text
    extracted = extract_text_from_pdf(pdf_bytes)

    # Build paper object
    paper = {
        "title": metadata.get("title") or _extract_title(extracted["fullText"]),
        "authors": metadata.get("authors", []),
        "abstract": metadata.get("abstract") or _extract_abstract(extracted["fullText"]),
        "fullText": extracted["fullText"],
        "sections": extracted["sections"],
        "numPages": extracted["numPages"],
    }

    pid = store_paper(paper)
    return paper


def _extract_title(text: str) -> str:
    for line in text.split("\n")[:10]:
        line = line.strip()
        if 10 < len(line) < 200 and not re.match(r'^(arxiv|doi|http)', line, re.I):
            return line
    return "Untitled"


def _extract_abstract(text: str) -> str:
    m = re.search(r'abstract[:\s]*(.{50,1500}?)(?=\n\s*\n|\bintroduction\b|\b1[\s.]+)', text, re.I | re.S)
    return re.sub(r'\s+', ' ', m.group(1)).strip() if m else ""
