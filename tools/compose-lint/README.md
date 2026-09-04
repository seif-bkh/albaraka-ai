# `tools/compose-lint`

Executable checks over [`deploy/docker-compose.yml`](../../deploy/docker-compose.yml) — the local /
dev topology of docs/12 §2.2. Run before every commit that touches the compose file or its
authorities, and in CI on every pull request.

```bash
npm install
npm run verify      # lint, then prove the linter can fail (mutation self-test)
```

Node ≥ 20. One dependency, `js-yaml`.

## Why this exists

A compose file has no compiler. The eight statements in it that silently break the Phase 1 backend
are exactly the ones a human cannot see from `docker compose config` output:

* a cluster initialised `LATIN1`/`SQL_ASCII` — the `albaraka_fts` text-search configuration then
  classifies every Arabic token as `word` and the trilingual index dies without an error;
* `shared_preload_libraries=vector` dropped — `CREATE EXTENSION` succeeds, HNSW fails at runtime;
* `KEYCLOAK_ADMIN` instead of `KC_BOOTSTRAP_ADMIN_*` (deprecated in Keycloak 26);
* a realm placeholder substituted with a **double-quoted** sed pattern — bash expands `${URL}` to
  its value, so sed searches for the value instead of the literal placeholder in the realm file,
  and the imported realm keeps `${FRONTOFFICE_URL}` unresolved;
* a realm placeholder never passed to the container — the sed replacement expands the *container*
  value, so a `.env` override is silently ignored and only the `:-default` is ever used;
* an image tag drifting from the pinned version (pgvector, Keycloak floor, Redis major);
* a required `specs/config` placeholder the server container never receives at boot.

The linter derives its expectations from the documents that give the compose file its meaning
rather than restating them:

| Expectation | Derived from |
|---|---|
| Service set, app/data-plane split, app profile | `docs/12-deployment-observability.md` §2.2 |
| pgvector image pin | `docs/02-repository-layout.md` §3 (`<pgvector.version>`) |
| Keycloak floor, Redis/PostgreSQL majors | `docs/adr/ADR-008-platform-versions.md` |
| UTF8 cluster-encoding requirement | `docs/03-data-model.md` §8 |
| Every `${VAR}` used by compose, secret-shaped handling | `.env.example` |
| Required/optional env placeholders the server needs | `specs/config/application*.yaml` |

Change the document, the ADR or the config and the linter's demands change with it.

## Check groups

| Group | What it asserts |
|---|---|
| `G` | the service set is exactly docs/12 §2.2 (plus `minio-init`); infrastructure has no `profiles`; application services are exactly `[app]` — the data plane must stay usable in Phase 0 |
| `I` | no floating tag (`latest`/`nightly`/`master`) anywhere; pgvector pins the docs/02 §3 version on PostgreSQL's ADR-008 major; Keycloak ≥ ADR-008 floor from `quay.io`; Redis on the documented major line; MinIO is `quay.io/…:RELEASE.*`; application images are `albaraka-ai/<svc>:dev` built from the repo root through `deploy/docker/` |
| `P` | postgres is initialised `--encoding=UTF8 --locale=C.UTF-8` (docs/03 §8), preloads `vector`, uses `albaraka_ai`/`albaraka`, has a `pg_isready` healthcheck, mounts the named volume and `deploy/postgres/init` |
| `K` | keycloak uses `KC_BOOTSTRAP_ADMIN_*` (never `KEYCLOAK_ADMIN`), imports the realm (`--import-realm`) after sed-substituting **all five** placeholders — the pattern single-quoted, the replacement expanded from the container `environment:`, which must carry the four URL vars — points `KC_DB_URL` at the `keycloak` database, publishes 8080, healthchecks the realm's OIDC configuration and waits for postgres to be healthy |
| `E` | every compose `${VAR}` is declared in `.env.example`; every required `specs/config` placeholder reaches the `server` container; secret-shaped values are `${VAR}` from the env, never literals; server profile is `dev`, DB URL/identity match the config, issuer-uri (browser-visible `localhost:9001`) is split from jwk-set-uri (in-network `keycloak:8080`), `../specs:/app/specs:ro` is mounted, postgres is `service_healthy` before boot |
| `R` / `N` | redis runs `--appendonly yes` with a ping healthcheck; nginx publishes the `.env.example` dev origin (`BANK_PUBLIC_URL` port) and mounts the frozen `./nginx/nginx.conf` target |

`ERROR` fails the build. `WARN` never does, and is used for judgements a human should make.

## Self-test

`self-test.mjs` takes the committed compose file, breaks one thing at a time in a throwaway copy
(and, for two mutations, mutates the authority document instead — docs/02 §3's pgvector pin and
ADR-008's Keycloak floor), runs the linter and asserts the expected check id fires. 33 mutations:
30 defects + 3 negative controls (a label, a restart policy, an extra volume — legitimate changes
that must NOT be flagged). The baseline itself must pass, so a linter that fails on the committed
file aborts the suite instead of reporting a green lie.

```bash
npm run self-test   # → 33 mutations · 33 detected · 0 MISSED · 0 BROKEN
```

## Defects this linter caught while being written

* `KEYCLOAK_ADMIN`/`KEYCLOAK_ADMIN_PASSWORD` instead of the Keycloak 26 bootstrap pair (M15);
* the realm-placeholder sed pattern double-quoted — a real no-op substitution (M29);
* realm placeholders absent from the keycloak container environment — `.env` overrides silently
  ignored (M30);
* postgres volumes without the init directory (keycloak database would never be created) and
  missing `shared_preload_libraries=vector` (M13);
* `.env`/`.env.example` drifting from the set of variables the compose file and `specs/config`
  actually require (M19–M22).
