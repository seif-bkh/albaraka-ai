"""Internal contract models — mirror docs/08 §8 (X-RAG-Contract: 1)."""
from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field

LOCALES = ("fr-FR", "ar-TN", "en-GB")
REFUSAL_CODES = ("REF-01", "REF-02", "REF-03", "REF-04", "REF-05", "REF-06")


class RagRequestContext(BaseModel):
    """Stage-0 envelope (docs/04 §2)."""

    conversation_id: UUID
    message_id: UUID
    locale: Literal["fr-FR", "ar-TN", "en-GB"]
    channel: str = "WEB_APP"
    audience: str = "PUBLIC"
    max_classification: str = "PUBLIC"
    retrieval_config: dict[str, Any] = Field(default_factory=dict)
    prompt: dict[str, Any] | None = None
    model: dict[str, Any] | None = None
    history: list[dict[str, Any]] = Field(default_factory=list)


class Citation(BaseModel):
    id: str
    chunkId: str
    documentId: str
    documentTitle: str
    documentTitleLocale: str = "fr-FR"
    collectionCode: str = "PRODUCTS"
    headingPath: list[str] = Field(default_factory=list)
    excerpt: str
    url: str
    locale: str
    validFrom: str | None = None
    validUntil: str | None = None
    score: float


class AnswerPayload(BaseModel):
    messageId: str
    answerMarkdown: str
    language: str
    dir: Literal["ltr", "rtl"]
    confidence: float
    usedSources: list[str]
    citations: list[Citation]
    caveats: list[str] = Field(default_factory=list)
    disclaimers: list[str] = Field(default_factory=list)
    needsHuman: bool = False
    cached: bool = False
    models: dict[str, Any] = Field(default_factory=dict)
    latencyMs: int = 0
    ttftMs: int = 0


class RefusalPayload(BaseModel):
    messageId: str
    refusalCode: str
    title: str
    body: str
    locale: str
    sources: list[Citation] = Field(default_factory=list)
    fatwaRequestRef: str | None = None
    handoffAvailable: bool = True


class ChatRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    context: RagRequestContext


class IngestRequest(BaseModel):
    job_id: UUID
    doc_id: UUID
    version_id: UUID
    source_ref: str
    content: str
    lang: str = "fr-FR"


class ChunkIn(BaseModel):
    id: str
    ordinal: int
    lang: str
    content: str
    heading_path: list[str] = Field(default_factory=list)
    embedding: list[float]
    content_sha256: str


class IngestCompleteRequest(BaseModel):
    job_id: UUID
    version_id: UUID
    chunks: list[ChunkIn]
