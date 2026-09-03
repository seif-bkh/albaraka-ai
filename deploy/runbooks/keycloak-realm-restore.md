# RUNBOOK — keycloak-realm-restore

| | |
|---|---|
| **Scenario** | Realm lost/corrupted (volume reset, failed upgrade, bad import), tokens no longer valid, or login broken |
| **RTO / RPO** | ≤ 30 min for the realm itself (docs/12 §8 "Full site failure" covers the combined restore: ≤ 4 h / ≤ 15 min) |
| **Source of truth** | specs/keycloak/README.md, deploy/docker-compose.yml (entrypoint sed), docs/07 (IAM), ADR-008 (Keycloak 26.x) |

## Ground rules

* **The realm is the *source-controlled* spec** (`specs/keycloak/albaraka-realm.json`, validated by
  `tools/realm-lint`: 5 clients, 9 governance roles, structural MFA). It contains **no secrets** —
  the service account secret comes from Vault at deploy time.
* The File has **five `${…}` placeholders**: `FRONTOFFICE_URL`, `BACKOFFICE_URL`,
  `BANK_PUBLIC_URL`, `WIDGET_REDIRECT_URI` (in the file) and `KC_HOSTNAME` (container env).
  Keycloak does **not** resolve `redirectUris`/`webOrigins`/`rootUrl` for you.

## Steps

1. **Re-create from source (the normal path).**
   ```bash
   docker compose exec keycloak \
     /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080 \
       --realm master --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"
   docker compose exec keycloak \
     /opt/keycloak/bin/kcadm.sh create realms -s realm=albaraka -s enabled=true
   # imports the whole realm JSON, preserving clients/roles/MFA:
   docker compose exec keycloak \
     /opt/keycloak/bin/kcadm.sh import --file /tmp/albaraka-realm-import.json
   ```
   The import file must be the **substituted** realm JSON: run the sed substitution from the
   compose entrypoint on a copy (the entrypoint's exact `sed -e 's|$${…}|…|g'` lines), or use
   `envsubst` if present on the host.
2. **Verify what matters for the backend:**
   * `GET /realms/albaraka/.well-known/openid-configuration` → `issuer` =
     `http://localhost:8080/realms/albaraka` (this is what the resource server checks);
   * client `frontoffice` redirect URIs include `/chat/*` + `/chat/silent-refresh.html`;
     `backoffice` `/*`; widget includes `${WIDGET_REDIRECT_URI}`;
   * JWK fetch works from inside the network: `docker compose exec server
     curl -fsS http://keycloak:8080/realms/albaraka/protocol/openid-connect/certs`.
3. **Rotate the realm's client secret** (it is not in the repo): Vault → server env
   (`KEYCLOAK_CLIENT_SECRET`-shaped) → restart server. See `secret-rotation.md`.

## If the *database* is the loss (not the realm file)

The Keycloak DB (`keycloak` database in the same postgres cluster) is restored from the same
backup as `albaraka_ai` (`restore-from-backup.md`). A fresh cluster **without** a backup means
import the realm from source; users/roles were never in the source file — that is exactly why the
quarterly restore drill (docs/12 §9) must run the realm-import path and record what had to be
re-created.

## Verification checklist

- [ ] OIDC discovery OK, issuer matches the resource server's `issuer-uri`
- [ ] `tools/realm-lint` passes against the imported realm (`npm run verify` in tools/realm-lint)
- [ ] a login with MFA works end-to-end (frontoffice + backoffice)
- [ ] anonymous chat still works *without* Keycloak (by design, docs/12 §8) — this is a regression
      check, not the goal

## Notes

* `--import-realm` on boot only imports on an **empty** database; a partial realm on an existing
  DB is a manual `kcadm` job. Do not "fix" it by deleting `keycloakdata` while the postgres volume
  still holds the realm's data.
