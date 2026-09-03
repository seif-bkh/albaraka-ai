# deploy — run everything on your host

## Quickstart

```bash
cp .env.example .env          # keys optional — demo runs in mock mode
make up                       # = docker compose -f deploy/docker-compose.yml --profile app up -d --build
```

> The compose file lives in `deploy/` — always run from the repository root, and
> always pass `-f deploy/docker-compose.yml` (or use `make up`).

| URL | What |
|---|---|
| http://localhost:8082 | **Frontoffice** — Al-Mouchir chat (FR / AR RTL / EN) |
| http://localhost:8082/admin | **Backoffice** — Sharia review, KB, prompts, audit |
| http://localhost:8081/actuator/health/liveness | Spring API |
| http://localhost:8000/v1/rag/health | RAG service (LangChain) |
| http://localhost:8080 | Keycloak (realm `albaraka`) |
| http://localhost:5432 / 9000 | PostgreSQL (pgvector) / MinIO console |

`make down` stops everything (named volumes keep your data). `make logs` tails the stack.
`make up` ≠ zero-config: Flyway seeds and the demo KB load on first boot; the RAG service boots
in mock mode and needs no provider keys.

## Services (docs/12 §2.2)

| Service | Image | Publish | Notes |
|---|---|---|---|
| `postgres` | `pgvector/pgvector:0.8.1-pg17` | 5432 | UTF8, `shared_preload_libraries=vector`, init scripts |
| `redis` | `redis:7.4-alpine` | — | cache / rate-limit / locks (appendonly) |
| `keycloak` | `quay.io/keycloak/keycloak:26.6.3` | 8080 | realm import + MFA, postgres-backed |
| `minio` | `quay.io/minio/minio` (pinned) | 9000/9001 | document originals (versioned buckets) |
| `rag-assistant` | `albaraka-ai/rag-assistant:dev` | — | FastAPI + LangChain — **only** egress to Groq/Google |
| `server` | `albaraka-ai/server:dev` | 8081 | Spring Boot 4.1 — Flyway, governance, SSE orchestration |
| `frontoffice-web` / `backoffice-web` | `albaraka-ai/*-web:dev` | — | Angular 22 static bundles (nginx) |
| `nginx` | `nginx:1.28-alpine` | 8082 | one origin: `/` → frontoffice, `/admin` → backoffice, `/api` → server |

## Provider keys — optional

| Mode | `RAG_PROVIDER_MODE` | Requires |
|---|---|---|
| `mock` (default) | `mock` | nothing — deterministic mock models/embeddings |
| `live` | `live` | `GROQ_API_KEY` (chat/rerank) + `GOOGLE_API_KEY` (embeddings) |

## Known constraints

* **The app plane needs Docker BuildKit** (default on Docker Desktop and modern Engine):
  `docker compose -f deploy/docker-compose.yml --profile app build` pulls the `maven:3.9-eclipse-temurin-21` builder
  (server image) and `node:22-alpine` (both SPAs) on first build.
* Wait for the health-gated start: the `server` container starts only after
  postgres/redis/keycloak/minio/rag-assistant are healthy; nginx after the server.
* Postgres `pgdata` is a named volume; reset with `docker compose -f deploy/docker-compose.yml down -v` (deletes demo data).
* Keycloak import runs **once** (empty DB). Realm edits afterwards: `kcadm` per
  `specs/keycloak/README.md`.
