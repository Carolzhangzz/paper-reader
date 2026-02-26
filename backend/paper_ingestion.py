import re
import hashlib
import httpx
import fitz  # PyMuPDF
from xml.etree import ElementTree

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

    # arxiv
    m = re.search(r'arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5}(?:v\d+)?)', url)
    if m:
        return {"type": "arxiv", "id": m.group(1)}

    # DOI
    m = re.search(r'(10\.\d{4,}/\S+)', url)
    if m:
        return {"type": "doi", "doi": m.group(1)}

    # Direct PDF URL
    if re.search(r'\.pdf(\?.*)?$', url, re.I):
        return {"type": "pdf", "url": url}

    # Generic URL — try as PDF
    if url.startswith("http"):
        return {"type": "url", "url": url}

    # Could be a bare arxiv ID like 2301.00234
    if re.match(r'^\d{4}\.\d{4,5}(v\d+)?$', url):
        return {"type": "arxiv", "id": url}

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

    if classified["type"] == "invalid":
        raise ValueError("Unrecognized URL format. Try an arXiv URL, DOI, or direct PDF link.")

    metadata = {}

    # ArXiv: get metadata + PDF
    if classified["type"] == "arxiv":
        arxiv_id = classified["id"]
        try:
            metadata = await fetch_arxiv_metadata(arxiv_id)
        except Exception:
            pass
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"

    elif classified["type"] == "doi":
        pdf_url = f"https://doi.org/{classified['doi']}"

    else:
        pdf_url = classified.get("url", url)

    # Download PDF
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
