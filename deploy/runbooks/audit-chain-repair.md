# RUNBOOK — audit-chain-repair

| | |
|---|---|
| **Scenario** | `audit_event` hash chain verification fails: a row was modified/deleted, a partition gap exists, or a failover lost the tail |
| **RTO / RPO** | ≤ 1 h to *diagnose and contain*; the chain itself is append-only and **never edited** |
| **Source of truth** | specs/db/schema.sql §HARD GUARANTEE 2 (`fn_audit_append_only`, `fn_audit_hash_chain`), docs/12 §8, docs/07 (evidence pack) |

## The invariant

`audit_event` is append-only and hash-chained:
`hash(seq) = sha256(prev_hash || row)`, `prev_hash` of row N = `hash` of row N−1 (computed in
`fn_audit_hash_chain`). Updates/deletes raise `AUDIT.IMMUTABLE`. A verification finding is a
**security/governance incident**, not a data-quality ticket — the first question an auditor asks
is "when did you know, and what did you do first?".

## Steps

1. **Verify (confirm it's real, and where).** The checker (`tools/db-verify` G2 audit chain
   assertion; production equivalent is the dedicated verifier over the partitions):
   ```sql
   WITH rec AS (
     SELECT seq, prev_hash, hash,
            lag(hash) OVER (ORDER BY seq, created_at) AS expected_prev
     FROM audit_event
   )
   SELECT seq, created_at FROM rec
   WHERE prev_hash IS DISTINCT FROM expected_prev
      OR expected_prev IS NULL AND seq <> 1;
   ```
   A **single** mismatch at the tail (last rows of the newest partition missing) is the
   failover/restore signature. A **middle** mismatch is tampering or a manual `INSERT` with a
   forged `prev_hash`.
2. **Contain, don't "fix".**
   * a mid-chain mismatch: stop writes to the affected services, preserve the volume/partition
     files as evidence (`pg_dump` of `audit_event` + copy of WAL), **do not** rewrite rows;
   * a tail loss from failover: the lost tail is declared (RPO ≤ 15 min / observed gap), restored
     from WAL/backup per `restore-from-backup.md`, and documented — the chain resumes from a
     **new** `prev_hash` that references the last *preserved* row, via an app-level "chain
     continuation" event (audited) — never by renumbering `seq`.
3. **Establish the evidence pack.** `seq`, `hash`, `prev_hash`, `occurred_at`, `actor`, `action`,
   `after_json` for the broken segment; export via the evidence-pack mechanism (docs/07).
4. **Root cause.** Was it:
   * restore order (backup older than WAL)? → fix the drill (`restore-from-backup.md`);
   * a manual SQL `INSERT` with `prev_hash` forged? → find who (postgres `pg_stat`/`log`,
     connection source) — this is the tampering case and the Compliance/security incident;
   * partition maintenance dropping/rewriting a partition? → fix the lifecycle job (docs/12 §5):
     partitions are `RANGE (created_at)`, and **archival may copy, never move** a partition.
5. **Recover with authority.** Only `audit` role + the documented repair procedure may touch the
   chain; every repair step is itself an `audit_event` row (the continuation event), which is
   precisely what keeps the *repair* auditable.

## What repair does NOT mean

* `UPDATE audit_event SET hash=…` — impossible by design (trigger) and would be the worse crime;
* deleting a partition to "fix" an FK/sequence issue (the `seq` is a sequence, partitions share
  it — deleting the newest partition creates a gap in *time*, not in the chain);
* "the chain was broken before we deployed" — if true, the pre-chain rows need a documented
  bootstrap (hash over the imported rows) recorded in the evidence pack.

## Verification

* the verifier above returns 0 rows;
* `audit_event` counts by partition are monotonic in time: no partition contains rows before the
  previous partition's `min(created_at)`;
* the incident log (incident table severity S1 for tampering) and the evidence pack hash match.
