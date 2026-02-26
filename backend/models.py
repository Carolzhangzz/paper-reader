from pydantic import BaseModel

class LoadRequest(BaseModel):
    url: str

class SummarizeRequest(BaseModel):
    paper_id: str

class ExtractRequest(BaseModel):
    paper_id: str

class TranslateRequest(BaseModel):
    paper_id: str
    target_lang: str = "zh"  # "zh" or "en"

class ChatRequest(BaseModel):
    paper_id: str
    question: str
    history: list[dict] = []
