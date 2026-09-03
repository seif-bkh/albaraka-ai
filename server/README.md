# `server/` — Al-Mouchir executable backend

The runnable implementation of the documented stack (Spring Boot 4.1 + Spring AI 2.0 remains the
**target production topology** — `deploy/docker-compose.yml`, ADR-008, docs/13 §2). This sandbox
has no Java/Maven/Docker egress, so the executable backend is a **Node parity implementation
under the same contracts**: `specs/openapi.yaml` (REST + SSE), `specs/asyncapi.yaml` (events),
`specs/db/schema.sql` (storage — executed verbatim, pgvector stubbed exactly like `tools/db-verify`).

```bash
cd server
npm install
npm run db:init      # embedded PostgreSQL + schema (246 stmts) + seeds V900–V903 + demo KB
npm run dev          # API on :8080
npm run eval         # golden-set gate (8 cases, deterministic)
```

## What is real vs mocked

| Layer | Real | Mocked |
|---|---|---|
| Storage | **real `specs/db/schema.sql` on embedded PostgreSQL** (embedded-postgres 18, same binary family the target PG 17 uses; pgvector → `real[]` like tools/db-verify) | pgvector HNSW (docker topology) |
| Sharia gate | **real triggers**: `chunk.searchable` recompute, two-eyes / self-approval checks, audit hash chain, append-only | — |
| Retrieval | **real SQL on `searchable` chunks**: FTS (`albaraka_fts`) + ts_rank + pg_trgm similarity | dense embedding ranking (Spring AI / pgvector) |
| Guardrails | **real rules** (injection, PII patterns), written to `guardrail_event` | Groq llama-guard calls (LIVE mode) |
| Answer generation | **answer contract** (framed, cited, trilingual, demo-labelled) | Groq `llama-3.3-70b-versatile` (LIVE mode with `GROQ_API_KEY`) |
| Identity | JWT HS256 + role checks (same authority names) | Keycloak RS256 (docker topology) |

`PROVIDER_MODE=LIVE` + `GROQ_API_KEY`/`GOOGLE_API_KEY` switches the adapters to the real
providers (same endpoints `tools/spike` validates); every call still obeys the answer contract.

## Dev users (backoffice login, dev only)

| email | password | roles |
|---|---|---|
| `admin@albaraka.tn` | `Admin#123` | ADMIN, AI_ENGINEER |
| `sharia@albaraka.tn` | `Sharia#123` | SHARIA_OFFICER |
| `compliance@albaraka.tn` | `Compliance#123` | COMPLIANCE_OFFICER |
| `reviewer@albaraka.tn` | `Review#123` | REVIEWER |
| `agent@albaraka.tn` | `Agent#123` | AGENT |

Production: Keycloak is the IdP; these accounts do not exist there (see specs/keycloak/README).

## The demo knowledge base

`src/seed-demo.js` loads 5 synthetic, trilingual documents (account opening, debt consolidation,
a **quarantined** 2023 tariff grid, a draft, and an in-review 2026 tariff update) so every workflow
is demonstrable — the Sharia gate, REF-03 fatwa routing, REF-04 personal-data refusal, REF-05
honest refusal with the three closest sources. The UI labels this content as demonstration data;
the bank's approved corpus replaces it through the ingestion/backoffice flow.

## SSE contract (docs/08 §3.1)

`POST /api/v1/chat/messages/send` → `text/event-stream`, frames in order:
`accepted → status* → sources (before first token) → token* → answer|refusal|error → done (last)`.
30 s idle timeout not applicable in demo mode (streams complete in ~2 s); `Last-Event-ID` is not
supported (docs/08), idempotency via `Idempotency-Key` replay is a Phase 2 refinement.
