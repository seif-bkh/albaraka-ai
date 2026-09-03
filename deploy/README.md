# `deploy/` — local/dev topology (Phase 0 deliverable)

[`docker-compose.yml`](docker-compose.yml) freezes the local development topology of
[docs/12 §2.2](../../docs/12-deployment-observability.md): `postgres` (pgvector), `redis`,
`keycloak`, `minio` (+ bucket initialiser), and the application plane behind the `app` profile
(`server`, `frontoffice-web`, `backoffice-web`, `nginx`).

## What runs today (Phase 0)

The data plane is runnable now — no application code needed:

```bash
cp .env.example .env          # fill POSTGRES_PASSWORD, KC_BOOTSTRAP_ADMIN_PASSWORD,
                              # MINIO_ROOT_PASSWORD + the two provider keys
docker compose up -d
docker compose ps             # all four infrastructure services healthy
```

That gives you exactly the stack the Phase 1 backend boots against, including the **imported
`albaraka` realm** (with roles, clients, MFA flow — validated by `tools/realm-lint`), a UTF-8
pgvector cluster with both buckets created (versioning on), and a Keycloak admin at
`http://localhost:8080` whose bootstrap admin comes from your `.env`.

## What is frozen for Phase 1

The application containers are behind `profiles: [app]` because their build contexts
(`deploy/docker/Dockerfile.*`, `deploy/nginx/nginx.conf`) are Phase 1 deliverables. Until they
exist, `docker compose --profile app up --build` is expected to fail at build time — the topology,
ports, environment wiring, healthchecks and dependencies of those containers are nevertheless
**fixed here as the target state**, and `tools/compose-lint` enforces them so Phase 1 cannot
silently fork the contract.

```bash
docker compose --profile app up --build   # Phase 1: full stack behind nginx on :8082
```

## The three traps this file (and compose-lint) exist to prevent

1. **Cluster encoding.** `POSTGRES_INITDB_ARGS=--encoding=UTF8 --locale=C.UTF-8` and a comment are
   not enough: docs/03 §8 requires the cluster itself to be UTF8, because on `SQL_ASCII` the
   `albaraka_fts` parser classifies every non-ASCII token — i.e. the entire Arabic corpus — as
   `word`, and the trilingual index silently stops working. An existing `SQL_ASCII` volume cannot
   be fixed by editing compose; the volume must be recreated.
2. **`shared_preload_libraries=vector`.** The pgvector image does not preload it. `CREATE
   EXTENSION` succeeds either way; HNSW index creation fails at runtime without it.
3. **Keycloak 26 bootstrap.** `KC_BOOTSTRAP_ADMIN_USERNAME` / `KC_BOOTSTRAP_ADMIN_PASSWORD`
   replace the deprecated `KEYCLOAK_ADMIN` pair, and the realm import substitutes the `${…}`
   placeholders first (Keycloak does not resolve `redirectUris`/`webOrigins`/`rootUrl` itself —
   [specs/keycloak/README](../specs/keycloak/README.md)). The `sed` step in the keycloak service
   entrypoint does that; a first-boot import is the only automatic import.

## Checking the file

```bash
cd tools/compose-lint && npm run verify
```

The linter derives the pinned versions from the repository rather than restating them: pgvector
from docs/02 §3 (`<pgvector.version>`), Keycloak's floor from ADR-008, Redis's major from ADR-008,
and every variable from `.env.example` and the `${…}` placeholders of `specs/config/`.

## Related

* [docs/12-deployment-observability.md](../docs/12-deployment-observability.md) — §2.2 the
  topology, §3 images, §5 DB operations, §8 runbooks
* [specs/config/README.md](../specs/config/README.md) — what belongs in YAML and what belongs in
  the database; the env contract the compose file satisfies
* [specs/keycloak/README.md](../specs/keycloak/README.md) — realm placeholders and import procedure
