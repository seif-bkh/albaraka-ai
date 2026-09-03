# tools/db-verify — executable proof for the reference DDL

`specs/db/schema.sql` is not a sketch: it **executes** against a real PostgreSQL server, and the
guarantees the architecture depends on are **tested**, not asserted in prose.

## What it does

1. Boots a throwaway PostgreSQL cluster (`embedded-postgres`, no Docker, no root).
2. Executes [`specs/db/schema.sql`](../../specs/db/schema.sql) statement by statement.
3. Executes [`specs/db/tests/schema_test.sql`](../../specs/db/tests/schema_test.sql), which asserts the
   three hard guarantees of [ADR-006](../../docs/adr/ADR-006-sharia-review-gate.md).
4. Prints an object inventory and exits non-zero on any failure — so it can run as a CI gate.

```bash
cd tools/db-verify
npm install
npm run verify
```

## What is asserted

| Id | Guarantee |
|---|---|
| **G1a** | A `DRAFT` chunk is not searchable — unapproved content is unreachable |
| **G1b** | Embedding a chunk without approval does not publish anything |
| **G1c** | Publishing an approved version opens the gate for its chunks, in one update |
| **G1d** | A machine translation cannot be Sharia-approved without human verification |
| **G1e** | Emergency withdrawal removes content from retrieval immediately |
| **G1f** | Expired validity closes the gate inline (sweeper is the backstop) |
| **G2a/b** | `audit_event` rejects `UPDATE` and `DELETE` |
| **G2c** | The audit hash chain verifies end to end |
| **G2d** | Every audit event links to its predecessor's hash |
| **G3a** | A submitter cannot approve their own submission (`GOVERNANCE.SELF_APPROVAL`) |
| **G3b** | A T3 subject cannot be approved without the Sharia-officer **and** compliance quorum |
| **G3c** | A quorate T3 review can be approved |
| **G3d** | A recorded rejection blocks approval |
| **C1** | Exactly one `ACTIVE` prompt version per `(code, locale)` |
| **C2** | `CONFIDENTIAL` content cannot be addressed to a `PUBLIC` audience |
| **V1/V2** | The governance KPI and reporting views are queryable |

## pgvector caveat

The embedded PostgreSQL distribution ships the standard contrib modules we use (`pg_trgm`,
`unaccent`, `pgcrypto`) but **not** `pgvector`, so the verifier stubs `vector(1536)` /
`halfvec(1536)` as `real[]` and skips the HNSW index. Everything else runs verbatim — enums, tables,
monthly partitions, generated `tsvector` columns, triggers, functions, views and all constraints.

Before a release, run the **unstubbed** schema against the pgvector-enabled container:

```bash
make dev                     # docker compose up postgres (pgvector/pgvector:pg17)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f specs/db/schema.sql -f specs/db/tests/schema_test.sql
```

## Verified state (Phase 0)

Executed against PostgreSQL 18.4 on 2026-09-03:

```
statements  : 238 executed · 238 succeeded · 0 failed
inventory   : 58 tables · 96 partitions · 4 views · 35 enums · 180 indexes
              25 triggers · 84 functions · 730 constraints
assertions  : 18 passed · 0 failed
```

Two real defects were found and fixed by this harness before the schema was committed:
`coalesce(uuid, '')` inside the audit hash function (invalid cast), and a vacuous assertion on a
zero-row `UPDATE` that a `BEFORE ROW` trigger would never have seen.
