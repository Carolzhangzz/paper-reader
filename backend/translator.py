"""Fast translation via Google Translate — no API key, no cost, instant results."""

from deep_translator import GoogleTranslator

# Google Translate has a 5000 char limit per request, so we chunk long texts
MAX_CHUNK = 4500


def _translate_text(text: str, target: str, source: str = "auto") -> str:
    """Translate text, chunking if too long."""
    if not text.strip():
        return text

    if len(text) <= MAX_CHUNK:
        return GoogleTranslator(source=source, target=target).translate(text)

    # Split by paragraphs, translate in chunks
    paragraphs = text.split("\n")
    chunks = []
    current = ""

    for para in paragraphs:
        if len(current) + len(para) > MAX_CHUNK and current:
            chunks.append(current)
            current = ""
        current += para + "\n"

    if current.strip():
        chunks.append(current)

    translator = GoogleTranslator(source=source, target=target)
    translated_chunks = [translator.translate(chunk) for chunk in chunks]
    return "\n".join(translated_chunks)


def translate_sections(sections: list[dict], target_lang: str):
    """Yield (heading, translated_text) for each section. Generator for streaming."""
    for section in sections:
        heading = section["heading"]
        content = section["content"]

        # Translate heading
        try:
            translated_heading = _translate_text(heading, target_lang)
        except Exception:
            translated_heading = heading

        # Translate content
        try:
            translated_content = _translate_text(content, target_lang)
        except Exception as e:
            translated_content = f"[Translation failed: {e}]"

        yield translated_heading, translated_content
