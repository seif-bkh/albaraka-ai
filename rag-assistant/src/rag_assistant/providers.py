"""Providers — deterministic mock adapters (default) and live LangChain adapters.

The mock adapters are first-class: CI, the demo compose profile and the golden gate run
entirely on them (no paid API, no external network).
"""
from __future__ import annotations

import hashlib
import json
import math
import time
from typing import Any, AsyncIterator

import numpy as np


def _tokenize(text: str) -> list[str]:
    out, cur = [], ""
    for ch in text.lower():
        if ch.isalnum() or ch in "’'":
            cur += ch
        elif cur:
            out.append(cur)
            cur = ""
    if cur:
        out.append(cur)
    return out


class MockEmbeddings:
    """Deterministic 1536-dim vectors: hashed token bag, L2-normalised."""

    dim: int = 1536

    def _vec(self, text: str) -> np.ndarray:
        v = np.zeros(self.dim, dtype=np.float32)
        for tok in _tokenize(text):
            h = int(hashlib.sha256(tok.encode("utf-8")).hexdigest()[:12], 16)
            v[h % self.dim] += 1.0
        n = float(np.linalg.norm(v))
        return v / n if n else v

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t).astype(float).tolist() for t in texts]

    def embed_query(self, text: str) -> list[float]:
        return self._vec(text).astype(float).tolist()


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    ab = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(x * x for x in b)) or 1.0
    return float(ab / (na * nb))


class MockChatModel:
    """Deterministic grounded generator: extracts claim sentences from the context.

    Mirrors what the live prompt does (answer only from context, citations as [S1..Sn]).
    """

    def __init__(self, model: str = "mock-chat"):
        self.model = model

    def generate(self, question: str, context: list[dict[str, Any]], locale: str) -> tuple[str, dict[str, Any]]:
        bullets: list[str] = []
        seen: set[str] = set()
        for c in context:
            s = c["content"].strip()
            if s and s not in seen:
                seen.add(s)
                bullets.append(s)
        intro = {
            "fr-FR": "Voici ce que dit la documentation approuvée :",
            "ar-TN": "إليك ما تقوله الوثائق المعتمدة:",
            "en-GB": "Here is what the approved documentation says:",
        }[locale]
        md = intro + "\n\n" + "\n".join(f"- {b}" for b in bullets[:5]) + "\n\n*Consultez votre agence pour les conditions en vigueur.*"
        return md, {"chat": self.model, "reranker": "mock", "degradationStep": 0}

    async def stream(self, question: str, context: list[dict[str, Any]], locale: str) -> AsyncIterator[str]:
        md, _ = self.generate(question, context, locale)
        for chunk in md.split(" "):
            yield chunk + " "
            await asyncio_sleep(0.005)


async def asyncio_sleep(s: float) -> None:
    import asyncio

    await asyncio.sleep(s)


class LiveProviders:
    """Live LangChain adapters (used when RAG_PROVIDER_MODE=live)."""

    def __init__(self, settings):
        from langchain_google_genai import GoogleGenerativeAIEmbeddings
        from langchain_groq import ChatGroq

        self.chat_model = settings.chat_model
        self.reranker_model = settings.reranker_model
        self.embeddings = GoogleGenerativeAIEmbeddings(
            model=settings.embed_model, google_api_key=settings.google_api_key
        )
        self.groq = ChatGroq(
            model=settings.chat_model, api_key=settings.groq_api_key, temperature=0.2, streaming=True
        )

    async def generate_stream(self, question: str, context: list[dict[str, Any]], locale: str) -> AsyncIterator[str]:
        from langchain_core.prompts import ChatPromptTemplate

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "You are Al-Mouchir, assistant of Al Baraka Bank Tunisia. Answer ONLY from the "
                    "provided context, in the requested language, with inline citation marks [S1..Sn]. "
                    "If the answer is not in the context, say you do not know. Never invent figures. "
                    "Keep the answer short and structured as bullets.",
                ),
                ("human", "Question: {question}\n\nContext:\n{context}\n\nLanguage: {locale}"),
            ]
        )
        ctx = "\n\n".join(f"[S{i+1}] {c['content']}" for i, c in enumerate(context))
        chain = prompt | self.groq
        async for chunk in chain.astream({"question": question, "context": ctx, "locale": locale}):
            content = chunk.content if hasattr(chunk, "content") else str(chunk)
            if content:
                yield content
                await asyncio_sleep(0)

    async def embed(self, text: str) -> list[float]:
        return await self.embeddings.aembed_query(text)


def make_providers(settings):
    if settings.provider_mode == "live" and settings.groq_api_key and settings.google_api_key:
        return LiveProviders(settings)
    return MockChatModel(settings.chat_model)
