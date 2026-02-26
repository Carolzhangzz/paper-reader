import asyncio
import os
import pty
import re
from collections.abc import AsyncGenerator


def _clean_env() -> dict:
    """Return env without CLAUDECODE to allow nested claude CLI calls."""
    env = os.environ.copy()
    env.pop("CLAUDECODE", None)
    return env


MODEL = os.environ.get("PAPER_READER_MODEL", "claude-haiku-4-5-20251001")


def chunk_text(text: str, max_tokens: int = 12000) -> list[str]:
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
    text = ""
    if paper.get("abstract"):
        text += f"Abstract: {paper['abstract']}\n\n"
    for s in paper.get("sections", []):
        text += f"## {s['heading']}\n{s['content']}\n\n"

    chunks = chunk_text(text, max_tokens)
    return chunks[0] if chunks else text[:max_tokens * 4]


def _strip_ansi(text: str) -> str:
    """Remove terminal escape sequences from PTY output."""
    text = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)
    text = re.sub(r'\x1b\][^\x07]*\x07', '', text)
    text = re.sub(r'\x1b[()][AB012]', '', text)
    text = text.replace('\r', '')
    return text


async def stream_claude(prompt: str) -> AsyncGenerator[str, None]:
    """Run `claude -p` with PTY for real-time unbuffered streaming."""
    master_fd, slave_fd = pty.openpty()

    proc = await asyncio.create_subprocess_exec(
        "claude", "-p", prompt, "--model", MODEL,
        stdout=slave_fd,
        stderr=asyncio.subprocess.PIPE,
        env=_clean_env(),
    )
    os.close(slave_fd)

    loop = asyncio.get_event_loop()

    try:
        while True:
            try:
                data = await asyncio.wait_for(
                    loop.run_in_executor(None, os.read, master_fd, 4096),
                    timeout=1.0,
                )
                if not data:
                    break
                text = _strip_ansi(data.decode("utf-8", errors="replace"))
                if text:
                    yield text
            except asyncio.TimeoutError:
                if proc.returncode is not None:
                    break
            except OSError:
                break
    finally:
        try:
            os.close(master_fd)
        except OSError:
            pass
        await proc.wait()

    if proc.returncode != 0:
        stderr = await proc.stderr.read()
        err_msg = stderr.decode("utf-8", errors="replace").strip()
        if err_msg:
            yield f"\n\n[Error: {err_msg}]"
