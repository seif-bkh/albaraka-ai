# RUNBOOK — restore-from-backup

| | |
|---|---|
| **Scenario** | Full-site failure, corrupted DB volume, destructive migration, or auditor-requested restore drill |
| **RTO / RPO** | ≤ 4 h / ≤ 15 min (docs/12 §8) |
| **Source of truth** | docs/12 §5 (DB operations), deploy/docker-compose.yml, specs/db/schema.sql (UTF8, `shared_preload_libraries`, keycloak DB), docs/13 Phase 5 (backup/PITR) |

## What must be in the backup (and why)

1. **`albaraka_ai` database** — everything the assistant is (chunks, embeddings, traces, audit
   chain, configs). `pg_dump -Fc` (or PITR/WAL for prod).
2. **`keycloak` database** — users, roles, client secrets (references), MFA state. Same cluster,
   must be dumped too.
3. **MinIO** (`albaraka-ai-originals`, `albaraka-ai-artifacts`) — the evidence base is "re-fetchable"
   per docs/12 §8, but the *artifacts* (parsed/normalized derivatives) and any object-lock
   considerations justify a consistent snapshot; a full restore must also verify the
   `document.original_object_key` → object mapping.
4. **Realm JSON** — already in source control (`specs/keycloak/albaraka-realm.json`), not in backup.

## Restore steps

1. **Stop the stack** (so nothing writes during restore): `docker compose --profile app down`
   (data plane: `docker compose stop`, keep volumes).
2. **restore the Postgres cluster** (fresh volume or same volume after the failure — never
   re-init over a corrupt cluster without acknowledging you are keeping the corruption):
   ```bash
   # fresh cluster is created by the entrypoint with --encoding=UTF8 --locale=C.UTF-8
   docker compose up -d postgres
   # wait for healthy, then:
   docker compose exec -T postgres sh -c \
     'psql -U albaraka -d albaraka_ai < /backup/albaraka_ai.dump.sql'   # or pg_restore -Fc
   docker compose exec -T postgres sh -c \
     'psql -U albaraka -d keycloak < /backup/keycloak.dump.sql'
   ```
   The order matters: the entrypoint init script (`deploy/postgres/init/10-keycloak-db.sql`)
   creates the `keycloak` DB on a *fresh* volume — if the volume already had it, skip that step.
3. **restore MinIO**: `mc mirror` the backup bucket tree back into
   `local/albaraka-ai-originals` + `local/albaraka-ai-artifacts`; re-enable versioning and verify
   the object-lock posture is still "none locally" (`application-dev.yaml` §storage) — an
   over-conservative restore that turns on `COMPLIANCE` retention on a single-node server will
   block the internal delete path.
4. **rebuild derived state** that is *not* in the backup by design:
   * pgvector HNSW indexes: `CREATE INDEX` again if the dump excluded them (indexes are
     rebuildable; the data is the backup);
   * `albaraka_fts` config is in `schema.sql` (`CREATE TEXT SEARCH CONFIGURATION`) — restore
     `schema.sql` on a fresh cluster via Flyway `V1__`, **then** the dump's data (or the dump
     includes it — document which; a "fresh cluster + data dump" restore is the drill path).
5. **re-import the realm** (`keycloak-realm-restore.md`) — the Keycloak DB was restored, but the
   drill must prove the realm-import path works, and the `--import-realm` first-boot import only
   runs on an empty DB.
6. **re-run the eval gate** (docs/11 §4) before reopening — this is the only proof the restored
   KB is the KB, not a slightly older twin.

## Verification (gate checklist)

- [ ] `node tools/db-verify/verify.mjs`-equivalent asserts: G1–G7 (schema), G5–G7 (seeds), audit
      chain contiguous (`audit-chain-repair.md` checker)
- [ ] `chunk_embedding`: 0 `STALE`, all rows `EMBEDDED` with the variant in
      `retrieval_config.embedding_variant`
- [ ] golden-set scorecard meets release thresholds
- [ ] a known question returns its known citation (spot check from `specs/eval/golden-set.jsonl`)

## Notes

* Drill cadence: quarterly restore drill (docs/12 §9) — the RPO clock starts at the documented
  restore *start*, and the ≤ 4 h budget includes the eval gate, so practice the gate too.
* `keycloakdata` volume holds only the *imported realm file*; deleting it does not restore the
  realm's database, and keeping it does not restore users — the Keycloak DB is in postgres.
