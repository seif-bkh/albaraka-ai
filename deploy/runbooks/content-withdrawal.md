# RUNBOOK — content-withdrawal

| | |
|---|---|
| **Scenario** | A published document/chunk is wrong, outdated, poisonous, or must be unpublished (legal, Sharia, compliance) |
| **RTO / RPO** | ≤ 1 h to full withdrawal documented in docs/12 §8 (data corruption/poisoning row) |
| **Source of truth** | docs/03 (document lifecycle, `lifecycle_state`), docs/05 (review workflow), schema.sql `document`/`document_version`/`chunk`, `assistant_config.kb_epoch` |

## Scope of "withdraw"

* **Unpublished-but-retired**: the file is still the evidence base (preserve it), but no chunk of
  it may reach an answer. This is the normal case.
* **Removed**: the document is invalid in whole — originals stay in MinIO (`albaraka-ai-originals`,
  versioned) as evidence; only retrieval is cut.

## Steps

1. **Record the decision.** `sharia_review`/`review_task` row with `review_decision = 'REJECT'`
   (or `APPROVE` + `withdraw`) and the trilingual reason. For a poisoning/incident case, open the
   `incident` first and reference it. Withdrawal is an audited act — `audit_event` records it.
2. **Cut retrieval, not the data.** Set `document_version.state = 'RETIRED'`
   (`lifecycle_state` covers `DRAFT/RETIRED/ARCHIVED`-style states per docs/03) and/or drive the
   retrieval filter from the active `kb_epoch` `assistant_config` value. The design contract:
   `retrieval_candidate`/`chunk` joins must filter on the *currently active* `kb_epoch` — never
   delete `chunk` rows to hide content (the evidence base and the audit chain depend on them).
3. **Bump `kb_epoch`** (`assistant_config`), which invalidates semantic-cache keys, and flush the
   cache (`cache-flush.md`) — a withdrawn chunk inside an old cached answer is the classic leak.
4. **Verify** a sample of the affected question families:
   * a previously-cited answer now returns the three closest *remaining* sources, or `REF-05
     NO_APPROVED_CONTENT` for a family that was fully dependent on the withdrawn document;
   * `retrieval_trace` shows no candidate whose `document_epoch`/version is withdrawn;
   * the golden-set/red-team entries that referenced the withdrawn content are updated and the
     gate re-run (`docs/11 §4`) before reopening.
5. **Long-term:** `content-withdrawal` may become a `content-withdrawal` **policy** case — if the
   withdrawal is a precedent (e.g. a product condition changed), update the KB and the
   `guardrail_policy` so the same defect can't re-enter through ingestion.

## Verification query

```sql
SELECT d.id, dv.state, count(c.id) AS chunks
FROM document d
JOIN document_version dv ON dv.document_id = d.id
JOIN chunk c ON c.document_version_id = dv.id
WHERE d.id = :withdrawn
GROUP BY d.id, dv.state;
```

## Notes

* Never hard-delete: `audit_event` is append-only and the originals are the evidence base —
  "retired" is a state, "deleted" is a future `erasure_request` with its own DPIA path.
* The withdrawal must be visible to users only as a *quality* measure (REF-05 with corrected
  guidance), never as "content removed" — that leaks the incident.
