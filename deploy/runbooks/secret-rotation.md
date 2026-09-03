# RUNBOOK — secret-rotation

| | |
|---|---|
| **Scenario** | Scheduled rotation (180 days, docs/12 §9), suspected exposure, personnel exit, or an import that should not keep a shared secret |
| **RTO / RPO** | n/a — zero-downtime when done in the right order; a bad order breaks login/streams |
| **Source of truth** | `.env.example`/`.env`, deploy/docker-compose.yml (all `${…}`), specs/keycloak/README.md (Vault), docs/06-07 (secrets never committed) |

## Inventory (the only secrets this compose topology has)

| Variable | Service | Retained where |
|---|---|---|
| `POSTGRES_PASSWORD` | postgres, keycloak (`KC_DB_PASSWORD`), server | `.env` (dev) / Vault |
| `KC_BOOTSTRAP_ADMIN_PASSWORD` | keycloak | `.env` / Vault |
| `MINIO_ROOT_PASSWORD` | minio, minio-init, server (`STORAGE_SECRET_KEY`) | `.env` / Vault |
| `GROQ_API_KEY`, `GOOGLE_API_KEY` | server | `.env` / Vault |
| Keycloak `frontoffice`/`backoffice` client secrets | Keycloak realm | **Vault only** — never in `specs/keycloak/albaraka-realm.json` (realm-lint enforces no secrets) |

Anything else (JWT signing, `WIDGET_REDIRECT_URI` style URLs) is not a secret and rotating it is a
red herring.

## Rotation order — the critical part

The **ordering** is the runbook. Rotating `POSTGRES_PASSWORD` alone (or `MINIO_ROOT_PASSWORD`
alone) breaks the other services' boot, because the compose file derives
`KC_DB_PASSWORD`/`STORAGE_SECRET_KEY` from the same `.env` values. The safe pattern for **any**
of them:

1. Take the service **out of rotation only if unavoidable** (a restart will pick the new value —
   `docker compose up -d <svc>` recreates with the new env, since env is not a volume).
2. Change the value in **Vault** (or `.env` for dev) *once*, not per-service.
3. `docker compose up -d` in dependency order: `postgres` → `keycloak` → `minio` → `server`.
   Do **not** rotate postgres's password and then leave keycloak booted against the old one —
   it will fail on restart *later*, silently.
4. Verify (below), then **rotate any other copies**: e.g. if the operator set
   `POSTGRES_PASSWORD` in a shell before it existed in `.env`, the shell history/logs are an
   exposure of the old value — the old value is dead only after every consumer re-reads the new one.

## Special cases

* **Keycloak realm client secret**: not in `.env`. In dev, you can rotate it in the realm via
  `kcadm update clients/<id> -s secret=…` and set the server's `KEYCLOAK_CLIENT_SECRET`-shaped env
  to match; in prod, Vault → env → server restart. Never put the secret in the realm JSON file.
* **`KC_BOOTSTRAP_ADMIN_PASSWORD`**: only matters on first boot of an empty DB. Rotating it with a
  *populated* DB does nothing (and the import flag won't re-run) — that is expected: bootstrap is
  for bootstrap, admin password rotation in prod goes through Keycloak's own admin console /
  `kcadm` and is *not* an env change.

## Verification

* `docker compose config` shows no literal secret anywhere (`grep -iE 'password|secret|key'` on
  the rendered output yields only `${VAR}` references).
* `docker compose exec postgres sh -c 'psql -U albaraka -d albaraka_ai -c "SELECT 1"'` works with
  the new value; keycloak `KC_DB_PASSWORD` follows; server health is `UP`.
* `.env` is git-ignored (`.gitignore`), `.env.example` contains no real value; a pre-commit
  `gitleaks` run on the diff is clean.

## Notes

* Rotation on suspicion = rotate **all** of the above, plus the Keycloak signing key material
  (`kcadm update keys` path), plus any session/token caches — a single leftover copy defeats it.
* Record the rotation in the incident/change log with `audit_event` `reason_code` (the operator
  access itself is break-glass tracked).
