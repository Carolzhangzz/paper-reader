import asyncio
from collections.abc import AsyncGenerator


def chunk_text(text: str, max_tokens: int = 12000) -> list[str]:
    """Chunk text to fit within token limits (rough: 1 token ≈ 4 chars)."""
    max_chars = max_tokens * 4
    if len(text) <= max_chars:
        return [text]

    chunks = []
    paragraphs = text.split("\n\n")
    current = ""

    for para in paragraphs:
        if len(current) + len(para) > max_chars and current:
            chunks.append(current.strip())
            current = ""
        current += para + "\n\n"

    if current.strip():
        chunks.append(current.strip())
    return chunks


def get_paper_context(paper: dict, max_tokens: int = 24000) -> str:
    """Build a context string from paper data, truncated to fit."""
    text = ""
    if paper.get("abstract"):
        text += f"Abstract: {paper['abstract']}\n\n"
    for s in paper.get("sections", []):
        text += f"## {s['heading']}\n{s['content']}\n\n"

    chunks = chunk_text(text, max_tokens)
    return chunks[0] if chunks else text[:max_tokens * 4]


async def stream_claude(prompt: str) -> AsyncGenerator[str, None]:
    """Run `claude -p` and stream stdout tokens."""
    proc = await asyncio.create_subprocess_exec(
        "claude", "-p", prompt,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    while True:
        chunk = await proc.stdout.read(64)  # Read small chunks for streaming feel
        if not chunk:
            break
        yield chunk.decode("utf-8", errors="replace")

    await proc.wait()

    if proc.returncode != 0:
        stderr = await proc.stderr.read()
        err_msg = stderr.decode("utf-8", errors="replace").strip()
        if err_msg:
            yield f"\n\n[Error: {err_msg}]"
