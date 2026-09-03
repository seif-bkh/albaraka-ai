# RUNBOOK — db-failover

| | |
|---|---|
| **Scenario** | PostgreSQL primary unusable (crash, disk full, host failure, corrupted cluster) |
| **RTO / RPO** | ≤ 15 min / ≤ 5 min |
| **Source of truth** | docs/12 §8, deploy/docker-compose.yml, specs/db/schema.sql (audit chain), docs/12 §5 |

## Dev / single-node (this compose file)

There is no replica in the local topology — "failover" here means **recover in place**:

1. Check what broke:
   ```bash
   docker compose ps postgres
   docker compose logs --tail=100 postgres
   docker volume inspect albaraka-ai_pgdata | grep Mountpoint
   ```
2. If the *volume* is intact (container crash): `docker compose up -d postgres` and let the
   healthcheck + restart policy recover it. Verify (below).
3. If the volume is corrupt or deleted: follow `restore-from-backup.md` — never `docker compose
   down -v` and re-create from scratch without saying so loudly: the `albaraka_ai` schema and the
   `keycloak` database **both live in this one cluster** (`deploy/postgres/init` creates the
   latter), and `keycloakdata` holds only the realm import, not the database.
4. After any recovery: `node tools/db-verify/verify.mjs`-class assertions — equivalent in prod is
   the G1–G7 gate set of `specs/db/tests/schema_test.sql` — plus the audit chain check below.

## Prod / HA (Patroni or managed)

1. Promote the replica per the Patroni/managed procedure; repoint all connections
   (`DATABASE_URL`), wait for `pg_isready`, run `SELECT 1`.
2. **Verify the audit chain before reopening** — this is the one failure mode that must *not*
   silently pass: a failover can lose the tail of `audit_event`, and the chain is part of the
   Compliance evidence. The hash-chain verifier (`audit-chain-repair.md`) must report a contiguous
   chain; if it does not, declare a data incident *before* serving traffic and follow that runbook.
3. Re-verify the replication lag back to the recovered primary (< 5 min, matching RPO).

## Verification (both)

```sql
SELECT count(*) FROM audit_event;                       -- tail exists
SELECT count(*) FROM chunk_embedding WHERE embedding_status = 'STALE';  -- 0 expected
SELECT count(*) FROM retrieval_config WHERE state = 'ACTIVE';
```

## Notes

* RPO ≤ 5 min means: if the tail is beyond WAL replay, some answers' `retrieval_trace` may be
  missing — that is an observable, declared gap (log the incident), not an invisible one.
* Never restart postgres with `--encoding` changes: the container's `POSTGRES_INITDB_ARGS` only
  applies to a **fresh** data directory.
