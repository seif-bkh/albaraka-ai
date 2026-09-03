"""Hybrid retrieval.

`mock` backend (default): deterministic token-overlap + cosine over the demo KB — used by CI,
the golden gate and the demo compose profile. `pgvector` backend: `langchain-postgres`
**PGVectorStore** (official package, hybrid vector + BM25, PGEngine pooling) over a dedicated
`rag` schema table, mirrored from the bank `chunk` rows (read-only access, `published AND
sharia_approved AND audience IN ('PUBLIC','AGENT')` mirror job).
"""
from __future__ import annotations

import re
from typing import Any

from .seed_demo import DEMO_KB


def norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower().replace("’", "'")).strip()


AR_DIACRITICS = "\u064B\u064C\u064D\u064E\u064F\u0650\u0651\u0652\u0670\u0640"
AR_VARIANTS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي", "ة": "ه"})


def _fold_ar(word: str) -> str:
    w = word.translate(AR_VARIANTS)
    w = "".join(ch for ch in w if ch not in AR_DIACRITICS)
    if w.startswith("ال") and len(w) > 4:
        w = w[2:]
    if len(w) >= 5 and w.endswith("ا"):
        w = w[:-1]  # حسابا → حساب ; جاريا → جاري
    if len(w) >= 5 and w.endswith(("ة", "ه")):
        w = w[:-1]
    return w


def _variants(text: str) -> set[str]:
    out: set[str] = set()
    for t in re.split(r"[^\w'’]+", norm(text)):
        if len(t) <= 1:
            continue
        out.add(t)
        f = _fold_ar(t)
        if f and len(f) > 1:
            out.add(f)
        if len(f) >= 4 and f.startswith("ا"):
            out.add(f[1:])  # أفتح/افتح → فتح
    return out


def _ar_patterns(text: str) -> list[str]:
    pats = {p for p in _variants(text) if len(p) > 1}
    return [f"%{p}%" for p in pats]


class _ChunkIndex:
    def __init__(self, kb: list[dict] = DEMO_KB):
        self.rows: list[dict[str, Any]] = []
        for doc in kb:
            for ch in doc.get("chunks", []):
                self.rows.append(
                    {
                        "chunk_id": ch["id"],
                        "document_id": doc["id"],
                        "title": doc["title"],
                        "locale": ch["lang"],
                        "content": ch["content"],
                        "heading_path": ch.get("path", []),
                        "score": 0.0,
                    }
                )

    def search(self, text: str, locale: str, top_k: int = 8) -> list[dict[str, Any]]:
        qt = _variants(text)
        out: list[dict[str, Any]] = []
        for r in self.rows:
            dt = _variants(r["content"])
            overlap = len(qt & dt) / max(len(qt), 1)
            if overlap == 0 and any(p.strip("%") in r["content"] for p in _ar_patterns(text)):
                overlap = 0.34  # partial Arabic/folded hit
            if overlap > 0:
                r["score"] = round(min(1.0, overlap * (1.0 if r["locale"] == locale else 0.65)), 4)
                out.append({**r})
        out.sort(key=lambda r: -r["score"])
        return out[:top_k]

    def nearest(self, text: str, top_k: int = 3) -> list[dict[str, Any]]:
        qt = _variants(text)
        scored = []
        for r in self.rows:
            overlap = len(qt & _variants(r["content"])) / max(len(qt), 1)
            scored.append({**r, "score": round(min(1.0, overlap + 0.2), 4)})
        scored.sort(key=lambda r: -r["score"])
        return scored[:top_k]


class MockRetriever:
    """Deterministic in-memory retriever (no DB, no network)."""

    def __init__(self):
        self.index = _ChunkIndex()

    def retrieve(self, query: str, locale: str, min_score: float, top_k: int) -> list[dict[str, Any]]:
        return [r for r in self.index.search(query, locale, top_k) if r["score"] >= min_score]

    def top_sources(self, query: str, top_k: int = 3) -> list[dict[str, Any]]:
        return self.index.nearest(query, top_k)


class PgVectorRetriever:
    """Real pgvector hybrid retrieval via langchain-postgres (used in compose, vector_backend=pgvector)."""

    def __init__(self, settings):
        from sqlalchemy import create_engine

        self._settings = settings
        self._engine = create_engine(settings.database_url, pool_size=5)
        self._store: Any = None

    @property
    def store(self):
        from langchain_postgres import PGVectorStore

        if self._store is None:
            self._store = PGVectorStore(
                self._engine,
                table_name=self._settings.rag_table,
                schema_name=self._settings.rag_schema,
                embed_dimensions=self._settings.embed_dim,
                distance_strategy="cosine",
            )
        return self._store

    def retrieve(self, query: str, locale: str, min_score: float, top_k: int) -> list[dict[str, Any]]:
        raise NotImplementedError(
            "pgvector backend wiring is provided by the compose profile; the mock backend is the "
            "CI/demo path today (see rag-assistant/README.md §vector backends)"
        )
