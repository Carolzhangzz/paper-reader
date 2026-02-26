import json
import logging
import traceback
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response, StreamingResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from .models import LoadRequest, SummarizeRequest, ExtractRequest, TranslateRequest, ChatRequest
from .paper_ingestion import load_paper, get_paper
from .llm import stream_claude, get_paper_context
from .translator import translate_sections
from . import prompts

app = FastAPI(title="Paper Reader")

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


# ===== SSE helpers =====

async def sse_from_claude(prompt: str):
    try:
        async for token in stream_claude(prompt):
            yield f"data: {json.dumps({'token': token})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


async def sse_from_translator(sections, target_lang):
    """Translate sections via Google Translate, streaming each as SSE."""
    try:
        for heading, translated in translate_sections(sections, target_lang):
            chunk = f"## {heading}\n\n{translated}\n\n"
            yield f"data: {json.dumps({'token': chunk, 'section': heading})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        logger.error(f"Translation error: {traceback.format_exc()}")
        yield f"data: {json.dumps({'error': str(e)})}\n\n"


def build_prompt(system: str, user: str) -> str:
    return f"{system}\n\n---\n\n{user}"


# ===== API Routes =====

@app.post("/api/paper/load")
async def api_load_paper(req: LoadRequest):
    try:
        paper = await load_paper(req.url)
        return {
            "id": paper["id"],
            "title": paper["title"],
            "authors": paper["authors"],
            "abstract": paper["abstract"],
            "numPages": paper["numPages"],
            "sections": [{"heading": s["heading"], "content": s["content"]} for s in paper["sections"]],
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Load paper error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to load paper: {e}")


@app.get("/api/paper/{paper_id}/pdf")
async def api_get_pdf(paper_id: str):
    paper = get_paper(paper_id)
    if not paper or "pdf_bytes" not in paper:
        raise HTTPException(status_code=404, detail="PDF not found")
    return Response(content=paper["pdf_bytes"], media_type="application/pdf")


@app.post("/api/paper/summarize")
async def api_summarize(req: SummarizeRequest):
    paper = get_paper(req.paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found.")
    context = get_paper_context(paper)
    prompt = build_prompt(prompts.SUMMARIZE_SYSTEM, prompts.SUMMARIZE_USER.format(text=context))
    return StreamingResponse(sse_from_claude(prompt), media_type="text/event-stream")


@app.post("/api/paper/extract")
async def api_extract(req: ExtractRequest):
    paper = get_paper(req.paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found.")
    context = get_paper_context(paper)
    prompt = build_prompt(prompts.EXTRACT_SYSTEM, prompts.EXTRACT_USER.format(text=context))
    return StreamingResponse(sse_from_claude(prompt), media_type="text/event-stream")


@app.post("/api/paper/translate")
async def api_translate(req: TranslateRequest):
    paper = get_paper(req.paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found.")

    lang_map = {"zh": "zh-CN", "en": "en"}
    target = lang_map.get(req.target_lang, "zh-CN")

    return StreamingResponse(
        sse_from_translator(paper["sections"], target),
        media_type="text/event-stream",
    )


@app.post("/api/paper/chat")
async def api_chat(req: ChatRequest):
    paper = get_paper(req.paper_id)
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found.")
    context = get_paper_context(paper, max_tokens=20000)
    parts = [prompts.CHAT_SYSTEM.format(context=context)]
    for msg in req.history[-10:]:
        role = "User" if msg["role"] == "user" else "Assistant"
        parts.append(f"{role}: {msg['content']}")
    parts.append(f"User: {req.question}")
    parts.append("Assistant:")
    return StreamingResponse(sse_from_claude("\n\n".join(parts)), media_type="text/event-stream")


# ===== Serve Frontend =====

app.mount("/css", StaticFiles(directory=FRONTEND_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=FRONTEND_DIR / "js"), name="js")


@app.get("/favicon.svg")
async def serve_favicon():
    return FileResponse(FRONTEND_DIR / "favicon.svg")


@app.get("/")
async def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")
