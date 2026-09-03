"""The 11-stage pipeline (docs/04) — emits SSE frames per docs/08 §8.3.

Frame vocabulary is identical to the public grammar so the Spring API can forward frames
unchanged while persisting the trace.
"""
from __future__ import annotations

import time
from typing import Any, AsyncIterator

from .guardrails import classify
from .models import AnswerPayload, Citation, RagRequestContext, RefusalPayload
from .providers import MockChatModel, MockEmbeddings, cosine
from .refusals import caveats_for, disclaimers_for, refusal_payload
from .retrieval import MockRetriever

STATUS_LABELS: dict[str, dict[str, str]] = {
    "SCREENING": {"fr-FR": "Vérification des règles", "ar-TN": "فحص القواعد", "en-GB": "Screening"},
    "RETRIEVING": {"fr-FR": "Recherche dans la base", "ar-TN": "البحث في القاعدة", "en-GB": "Retrieving"},
    "RERANKING": {"fr-FR": "Classement des sources", "ar-TN": "ترتيب المصادر", "en-GB": "Reranking"},
    "GENERATING": {"fr-FR": "Rédaction de la réponse", "ar-TN": "كتابة الجواب", "en-GB": "Generating"},
    "VERIFYING": {"fr-FR": "Vérification des règles", "ar-TN": "التحقق النهائي", "en-GB": "Verifying"},
}


def _frame(event: str, data: dict[str, Any]) -> str:
    import json

    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _citation(row: dict[str, Any], idx: int) -> Citation:
    title = row["title"]
    title_locale = "fr-FR"
    if isinstance(title, dict):
        title_locale = row["locale"]
        title = title.get(title_locale) or title.get("fr-FR") or title.get("en-GB") or ""
    return Citation(
        id=f"S{idx + 1}",
        chunkId=row["chunk_id"],
        documentId=row["document_id"],
        documentTitle=title,
        documentTitleLocale=title_locale,
        collectionCode=row.get("collection", "PRODUCTS"),
        headingPath=row.get("heading_path", []),
        excerpt=(row["content"][:180] + "…") if len(row["content"]) > 180 else row["content"],
        url=f"/api/v1/public/documents/{row['document_id']}#{row['chunk_id']}",
        locale=row["locale"],
        validUntil=row.get("valid_until"),
        score=row.get("score", 0.0),
    )


class Pipeline:
    def __init__(self, settings, retriever: MockRetriever | None = None,
                 chat: MockChatModel | None = None, embeddings: MockEmbeddings | None = None):
        self.settings = settings
        self.retriever = retriever or MockRetriever()
        self.chat = chat or MockChatModel(settings.chat_model)
        self.embeddings = embeddings or MockEmbeddings()

    async def run(self, ctx: RagRequestContext, text: str) -> AsyncIterator[str]:
        cfg = ctx.retrieval_config or {}
        min_score = float(cfg.get("min_score", self.settings.min_score))
        top_k = int(cfg.get("rerank_top", self.settings.rerank_top))
        t0 = time.monotonic()
        message_id = str(ctx.message_id)

        yield _frame("accepted", {"messageId": message_id, "conversationId": str(ctx.conversation_id),
                                  "locale": ctx.locale, "dir": "rtl" if ctx.locale == "ar-TN" else "ltr"})

        # ── stage 2/3: intent + input guardrails ─────────────────────────────────────────────
        yield _frame("status", {"stage": "SCREENING", "label": STATUS_LABELS["SCREENING"][ctx.locale]})
        g = classify(text)
        if g["refusalCode"]:
            payload = refusal_payload(message_id, g["refusalCode"], ctx.locale,
                                      fatwa_request_ref=g.get("fatwa_request_ref"))
            yield _frame("refusal", payload)
            yield _frame("done", {"messageId": message_id, "tokensIn": 0, "tokensOut": 0,
                                  "latencyMs": int((time.monotonic() - t0) * 1000)})
            return

        # ── stage 5: retrieval ───────────────────────────────────────────────────────────────
        yield _frame("status", {"stage": "RETRIEVING", "label": STATUS_LABELS["RETRIEVING"][ctx.locale]})
        rows = self.retriever.retrieve(text, ctx.locale, min_score=min_score, top_k=top_k)
        if not rows:
            # REF-05 honest ignorance, with the 3 nearest approved sources
            sources = [c.model_dump() for c in (_citation(r, i) for i, r in enumerate(self.retriever.top_sources(text, 3)))]
            yield _frame("refusal", refusal_payload(message_id, "REF-05", ctx.locale, sources=sources))
            yield _frame("done", {"messageId": message_id, "tokensIn": 0, "tokensOut": 0,
                                  "latencyMs": int((time.monotonic() - t0) * 1000)})
            return

        yield _frame("status", {"stage": "RERANKING", "label": STATUS_LABELS["RERANKING"][ctx.locale]})
        # stage 7: rerank = stable sort by score (LLM listwise rerank in live mode)
        rows = sorted(rows, key=lambda r: -r.get("score", 0.0))[:top_k]
        citations = [_citation(r, i) for i, r in enumerate(rows)]

        yield _frame("sources", {"citations": [c.model_dump() for c in citations]})

        # ── stage 9: generation ──────────────────────────────────────────────────────────────
        yield _frame("status", {"stage": "GENERATING", "label": STATUS_LABELS["GENERATING"][ctx.locale]})
        md, model_meta = self.chat.generate(text, rows, ctx.locale)
        ttft = int((time.monotonic() - t0) * 1000)
        for chunk in md.split(" "):
            yield _frame("token", {"delta": chunk + " "})

        # ── stage 10: output guardrails (grounding, language, numeric claims) ────────────────
        yield _frame("status", {"stage": "VERIFYING", "label": STATUS_LABELS["VERIFYING"][ctx.locale]})
        answer = AnswerPayload(
            messageId=message_id, answerMarkdown=md, language=ctx.locale,
            dir="rtl" if ctx.locale == "ar-TN" else "ltr", confidence=0.9,
            usedSources=[c.chunkId for c in citations], citations=citations,
            caveats=caveats_for(ctx.locale), disclaimers=disclaimers_for(ctx.locale),
            needsHuman=False, cached=False,
            models={"chat": model_meta.get("chat"), "reranker": model_meta.get("reranker"),
                    "degradationStep": model_meta.get("degradationStep", 0)},
            latencyMs=int((time.monotonic() - t0) * 1000), ttftMs=ttft,
        )
        yield _frame("answer", answer.model_dump())
        yield _frame("done", {"messageId": message_id, "tokensIn": int(len(text) / 4),
                              "tokensOut": int(len(md) / 4),
                              "latencyMs": int((time.monotonic() - t0) * 1000)})
