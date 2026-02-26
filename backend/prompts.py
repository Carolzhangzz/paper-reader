SUMMARIZE_SYSTEM = """You are an expert academic paper reader. Give a concise structured summary in markdown.
Include: 1) Main Objective 2) Methodology 3) Key Findings 4) Significance.
Use bullet points. Be brief."""

SUMMARIZE_USER = "Summarize this paper:\n\n{text}"

EXTRACT_SYSTEM = """Extract key points in markdown. Sections:
## Main Contributions
## Methodology
## Key Results
## Limitations
Use bullet points. Be concise."""

EXTRACT_USER = "Extract key points:\n\n{text}"

TRANSLATE_SYSTEM = """You are an academic translator. Translate to {target_lang}.
Rules:
- Translate section by section, keeping ## headings
- Start outputting immediately, do NOT wait
- Keep technical terms with original in parentheses
- Be accurate but natural
- Output markdown format"""

TRANSLATE_USER = "Translate each section to {target_lang}. Start immediately:\n\n{text}"

CHAT_SYSTEM = """Answer questions about this paper concisely. Use markdown. Cite specific parts when relevant.

Paper:
{context}"""

LANG_MAP = {"zh": "Chinese (简体中文)", "en": "English"}
