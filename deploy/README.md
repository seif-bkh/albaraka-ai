# deploy — run everything on your host

## Quickstart

```bash
cp .env.example .env          # keys optional — demo runs in mock mode
make up                       # = docker compose --env-file .env -f deploy/docker-compose.yml --profile app up -d --build
```

> The compose file lives in `deploy/` and the secrets live in the repo-root `.env` — always run
> from the repository root and always pass both `--env-file .env` and `-f deploy/docker-compose.yml`
> (or use `make up`). Compose's default project directory is `deploy/`, so without `--env-file .env`
> it never sees your root `.env` and reports `required variable … is missing a value`.

| URL | What |
|---|---|
| http://localhost:9000 | **Frontoffice** — Al-Mouchir chat (FR / AR RTL / EN) |
| http://localhost:9000/admin | **Backoffice** — Sharia review, KB, prompts, audit |
| http://localhost:9002/actuator/health/liveness | Spring API |
| http://localhost:9003/v1/rag/health | RAG service (LangChain) |
| http://localhost:9001 | Keycloak (realm `albaraka`) |
| http://localhost:9004 | PostgreSQL (pgvector) — MinIO is internal-only |

`make down` stops everything (named volumes keep your data). `make logs` tails the stack.
`make up` ≠ zero-config: Flyway seeds and the demo KB load on first boot; the RAG service boots
in mock mode and needs no provider keys.

## Services (docs/12 §2.2)

| Service | Image | Publish | Notes |
|---|---|---|---|
| `postgres` | `pgvector/pgvector:0.8.1-pg17` | 9004 | UTF8, `shared_preload_libraries=vector`, init scripts |
| `redis` | `redis:7.4-alpine` | — | cache / rate-limit / locks (appendonly) |
| `keycloak` | `quay.io/keycloak/keycloak:26.6.3` | 9001 | realm import + MFA, postgres-backed |
| `minio` | `quay.io/minio/minio` (pinned) | — (internal) | document originals (versioned buckets) |
| `rag-assistant` | `albaraka-ai/rag-assistant:dev` | 9003 (health) | FastAPI + LangChain — **only** egress to Groq/Google |
| `server` | `albaraka-ai/server:dev` | 9002 | Spring Boot 4.1 — Flyway, governance, SSE orchestration |
| `frontoffice-web` / `backoffice-web` | `albaraka-ai/*-web:dev` | — | Angular 22 static bundles (nginx) |
| `nginx` | `nginx:1.28-alpine` | 9000 | one origin: `/` → frontoffice, `/admin` → backoffice, `/api` → server |

## Provider keys — optional

| Mode | `RAG_PROVIDER_MODE` | Requires |
|---|---|---|
| `mock` (default) | `mock` | nothing — deterministic mock models/embeddings |
| `live` | `live` | `GROQ_API_KEY` (chat/rerank) + `GOOGLE_API_KEY` (embeddings) |

## Known constraints

* **The app plane needs Docker BuildKit** (default on Docker Desktop and modern Engine):
  `docker compose --env-file .env -f deploy/docker-compose.yml --profile app build` pulls the `maven:3.9-eclipse-temurin-21` builder
  (server image) and `node:22-alpine` (both SPAs) on first build.
* Wait for the health-gated start: the `server` container starts only after
  postgres/redis/keycloak/minio/rag-assistant are healthy; nginx after the server.
* Postgres `pgdata` is a named volume; reset with `docker compose --env-file .env -f deploy/docker-compose.yml down -v` (deletes demo data).
* Keycloak import runs **once** (empty DB). Realm edits afterwards: `kcadm` per
  `specs/keycloak/README.md`.
