# ADR-009 — Dedicated Python RAG service (LangChain) behind the Spring API

- **Status:** accepted (2026-09-03)
- **Deciders:** architecture, backend lead, RAG lead, compliance observer
- **Supersedes:** the interim Node parity backend (see `legacy/node-parity/`) as the
  *runtime* implementation; the Spring Boot topology of [ADR-005](ADR-005-modular-monolith.md)
  and the external API contract of `specs/openapi.yaml` are unchanged.

## Context

The RAG pipeline (retrieval, reranking, grounded generation, refusal classification) is
*model-bound work*: embeddings, vector stores, chunkers, rerankers and guard models change
frequently, and the strongest ecosystem for them is Python (LangChain, LangGraph, HuggingFace
model zoo, pgvector tooling). The banking facade, however, must stay Java: audit, Sharia
governance, knowledge lifecycle, Keycloak IAM and regulatory tooling are the hard, slowly
changing parts of the system.

The first executable implementation used a Node parity backend for convenience. The team
reviewed it and chose the following split instead, because the model-bound part is where
Python genuinely wins (a Java RAG implementation would re-implement LangChain's retriever /
vector-store / evaluator toolkit at a cost no one wants to carry).

## Decision

Two application services, one boundary:

| Service | Language/stack | Owns | Never |
|---|---|---|---|
| `server` | Java 21, Spring Boot 4.1 | Keycloak auth & RBAC, conversations/messages, knowledge lifecycle, Sharia governance & two-eyes, audit chain, analytics, **orchestration** of chat (SSE), admin API | Model calls, vector math, prompt to a provider |
| `rag-assistant` | Python 3.12, FastAPI, LangChain 1.x | retrieval (pgvector + FTS hybrid), reranking, grounded generation, **all** provider egress (Groq/Google), egress PII gate, guard classification (REF-01/03/04/05), embeddings at ingestion | Flips `published`/`sharia_approved` flags, writes audit, knows Keycloak |

Boundary: **one internal contract** `POST /v1/rag/chat` (SSE, model-agnostic) + `POST /v1/rag/ingest`
(job worker) + `GET /v1/rag/health`, defined in [`08-api-design.md`](08-api-design.md) §8 and
validated by contract tests in CI. The service-to-service call carries a short-lived service
token derived from a shared secret; it never carries a user's Keycloak token.

### Why this is safe for the Sharia invariant

Python **may insert** `chunk` rows during ingestion, but only with `published = false` and
`sharia_approved = false` (schema defaults/constraints enforce this). Only the Spring
`knowledge` + `governance` publish transaction may flip those flags, and that is the same
single-writer rule ADR-005 already required — the difference is one hop over HTTP instead of
one method call. The retrieval query additionally filters on the flags, so an unapproved
chunk is invisible even if something failed.

### Why one hop is acceptable

- The RAG call is the dominant latency anyway (embedding + retrieval + LLM); an internal HTTP
  round-trip (~1–3 ms on the compose network) is noise.
- SSE is proxied stream-through: `rag-assistant` emits `status/sources/token/answer/refusal/error/done`
  frames with the **same vocabulary** as the public contract, so the Spring side filters and
  forwards without de/serialising answers.
- The service is horizontally separate, which lets the RAG team ship model changes without a
  banking release, and lets compliance see exactly one egress point (the Python service).

### Failure modes

- `rag-assistant` down → Spring answers from the degradation ladder (cached answer → retrieval-only
  sources → static trilingual fallback), exactly the ladder already specified in doc 01 §7.2.
- Contract drift → versioned headers (`X-RAG-Contract: 1`) + CI contract tests on both sides.
- Provider keys missing → `RAG_PROVIDER_MODE=mock` deterministic mode (like the previous
  `local-mock`), used by the demo compose profile and CI.

## Consequences

1. `server/` becomes the Spring Boot multi-module build; model adapters (`assistant-infra`
   LLM/embedding parts) move to `rag_assistant`.
2. New `rag-assistant/` Python package (FastAPI + LangChain) with its own Docker image, tests
   and README.
3. `deploy/docker-compose.yml` runs the full stack: `postgres(pgvector)`, `redis`, `keycloak`,
   `server`, `rag-assistant`, `web` (nginx + Angular bundles), optional `minio`.
4. The previous Node backend is preserved in `legacy/node-parity/` (reference only; no longer
   built by default).
5. The 8-case golden eval gate becomes a Python `pytest` suite in `rag-assistant/tests/`
   (the assertion values stay identical).
