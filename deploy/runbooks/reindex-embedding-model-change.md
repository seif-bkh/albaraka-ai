# RUNBOOK — reindex-embedding-model-change

| | |
|---|---|
| **Scenario** | `embedding_variant` changes (or `model_config`/adapter changed the embedding model); existing vectors are now in the wrong space |
| **RTO / RPO** | n/a — planned operation; retrieval must not serve mixed-space vectors in the interim |
| **Source of truth** | schema.sql `chunk_embedding` (`embedding_status`), `retrieval_config.embedding_variant`, `ingestion_job` (`job_type = 'REINDEX_MODEL_CHANGE'`, `REEMBED`), docs/04 §4, specs/eval |

## Why this is a runbook, not a job

`chunk_embedding` rows embed the *variant* that produced them. Mixing `gemini-embedding-001@768`
with `gemini-embedding-001@1536` (or a future `-002`) in one vector index is silent garbage:
cosine similarity across spaces is meaningless, and the system will produce confident but wrong
answers. `retrieval_config.embedding_variant = 'gemini-embedding-001@1536'` is the authority that
*validates* rows (the linter/gate assert config ↔ embeddings consistency).

## Steps

1. **Freeze writes.** Stop ingestion (`ingestion_job` `QUEUED` rows hold), or new chunks will be
   embedded in the new space while the index is still old. (Docs/04: ingestion pauses and queues on
   Google outage — same mechanism.)
2. **Create the new `retrieval_config` row** (DRAFT) with the new `embedding_variant`, `canary_percent`
   = 0 initially, through the normal review path (`state = 'IN_REVIEW'`, `review_id` set — a
   `retrieval_config` change for `T2`+ requires the Sharia review per docs/05).
3. **Launch the re-embed job**: enqueue `job_type = 'REINDEX_MODEL_CHANGE'` over all
   `chunk` ids; the runner re-embeds and upserts `chunk_embedding` with `embedding_status =
   'EMBEDDED'`, new variant tag, and `embedding_dim` from the new config.
4. **Monitor** with the job progress + `embedding_status` dashboard:
   `SELECT embedding_status, embedding_variant, count(*) FROM chunk_embedding GROUP BY 1,2;`
   Failure is `FAILED` — never treat the old vectors as "convertible".

## Activation (the actual switch)

1. All rows `EMBEDDED` with the new variant; 0 `STALE`/`PENDING`.
2. `retrieval_config` activated (`state = 'ACTIVE'`, `activated_at`, `activated_by`); the active-row
   unique index (`uq_retrieval_config_active`) enforces one per channel.
3. Canary ramp: `canary_percent` 10 → 50 → 100; the eval gate runs on the golden set at each step
   (docs/11 §4). Rollback at any point = re-activate the previous config row (old variant),
   *then* re-embed back — never serve the two spaces together.

## Verification

* A known "embedding-sensitive" query set from `specs/eval/red-team.jsonl` (e.g. Derja → French
  cross-lingual) still retrieves its expected chunks.
* `retrieval_trace` rows carry the new `embedding_variant`; the retrieval lab shows the variant.
* Golden set: faithfulness ≥ 0.85, citation accuracy ≥ 0.9 (docs/13 Phase 2 acceptance references).

## Notes

* Never edit the active `retrieval_config` row in place. Versioned activation + canary is the
  contract; a hacked row is an audit finding.
* Google outage during a re-embed: the job pauses and queues (same as ingestion) — do not
  "finish it by hand".
