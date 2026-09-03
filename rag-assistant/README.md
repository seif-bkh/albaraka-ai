# rag-assistant — Al-Mouchir RAG service (Python)

The **only** component that touches models. Owns retrieval, reranking, generation, guard
classification and the egress PII gate ([ADR-009](../docs/adr/ADR-009-python-rag-service.md)).
Spoken to by the Spring `server` over the internal contract (docs/08 §8).

## Stack

- **FastAPI** + Uvicorn (`:8000`), pydantic-settings
- **LangChain 1.x** — `langchain-postgres` **PGVectorStore** (hybrid vector + BM25) for the
  real backend; `langchain-groq` (chat/rerank), `langchain-google-genai` (embeddings)
- Deterministic **mock** providers (default) so CI, the golden gate and the demo profile run
  with zero keys and zero network

## Run

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
uvicorn rag_assistant.main:app --port 8000     # mock mode by default
python -m pytest -q                            # golden gate — 8/8 (same cases as docs/11)
```

## Contract (docs/08 §8)

| Endpoint | Purpose |
|---|---|
| `GET /v1/rag/health` | liveness + mode (`mock`/`live`) + vector backend |
| `POST /v1/rag/chat` | SSE pipeline: `accepted → status* → sources → token* → answer|refusal|error → done` |
| `POST /v1/rag/ingest` | parse/chunk/embed a document job (worker) |
| `POST /v1/rag/ingest/complete` | hand chunks+vectors to Spring (`published=false`) |

Auth: `Authorization: Bearer <RAG_SERVICE_TOKEN>` (same value as `server` env). Always send
`X-RAG-Contract: 1`.

## Vector backends

- `RAG_VECTOR_BACKEND=mock` — in-memory index over `seed_demo.py` (10 trilingual chunks,
  Arabic diacritic/variant folding). Used by CI and the demo compose profile.
- `RAG_VECTOR_BACKEND=pgvector` — `langchain-postgres` PGVectorStore in schema `rag.chunks`,
  mirrored from the bank's approved chunks (`published AND sharia_approved`). Wired by the
  compose profile behind `SERVER_PUBLISH` → `POST /v1/rag/ingest/complete`.

## Provider modes

- `RAG_PROVIDER_MODE=mock` (default) — `MockChatModel` + `MockEmbeddings` (deterministic).
- `RAG_PROVIDER_MODE=live` — requires `RAG_GROQ_API_KEY` + `RAG_GOOGLE_API_KEY`; uses
  `llama-3.3-70b-versatile` (chat), `llama-3.1-8b-instant` (rerank), `gemini-embedding-001` (embed).

## Why Python, why LangChain

The 11-stage pipeline (docs/04) is model-bound work: chunkers, embedding stores, hybrid retrieval,
rerankers and guard models change constantly, and LangChain's ecosystem does that work natively
(pgvector, Groq, Google, prompt templates, streaming). The Java side keeps auth, governance,
audit and persistence — the parts that must not change quickly. See ADR-009 for the trade-offs.
