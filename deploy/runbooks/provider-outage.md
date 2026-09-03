# RUNBOOK — provider-outage (Groq / Google)

| | |
|---|---|
| **Scenario** | Groq chat/guard API unresponsive or rate-limited; Google GenAI embeddings unresponsive |
| **RTO / RPO** | 0 (degraded) / 0 (answers that only need cached content keep flowing) |
| **Source of truth** | docs/12 §8, docs/01 §7.2 (degradation ladder), docs/04 §6 |

## When to trigger

* Groq: `5xx`, elevated 4xx (429/400 on `max_tokens`), or TTFT P95 > 3× baseline for 5 min.
* Google: `5xx` on `gemini-embedding-001` or batch failures on the ingestion queue.

## Immediate containment — Groq

The degradation ladder is **automatic** and must not be fought by a human: it steps down
`llama-3.3-70b-versatile` → fast model → cached/retrieval-only as latency/errors rise. Do not
increase `retries` in `model_config` beyond the configured `2` — that multiplies a dead provider's
timeout.

1. Confirm the provider is the cause, not the budget: read `token_usage_daily` and the
   `llm_call_log` error column for the last hour.
2. Keep `state = 'ACTIVE'` on the *primary* `model_config` row (never deactivate it — that is a
   config change, not an outage measure; deactivation needs `state` + `activated_by` and a
   `sharia_review` for `T2`+ content).
3. If the incident is expected to last > 30 min (per provider status page), switch the active
   generation config to the `ONPREM` row if one exists (`provider_code = 'ONPREM'`), recording the
   `reason_code` on the change. Otherwise leave the ladder to degrade.
4. Page the AI engineer. The 80 %/100 % budget page and the provider alert share the same channel.

## Immediate containment — Google

Retrieval is unaffected (vectors are stored in `chunk_embedding`); **ingestion pauses and queues**.

1. Stop scheduling new `INGEST_DOCUMENT` jobs (`ingestion_job`), leave `QUEUED` rows queued.
2. Do **not** change `embedding_variant` (`retrieval_config`) — this is an outage, not a model
   change (see `reindex-embedding-model-change.md`).
3. When Google recovers, resume ingestion; verify `embedding_status` transitions `PENDING → EMBEDDED`.

## Verification

* `GET /actuator/health` (server) is `UP` with the provider component `DOWN` — degraded, not dead.
* A cached question still streams an answer with `cached: true` in `SseAnswer`.
* `llm_call_log` stops accumulating `PROVIDER_UNAVAILABLE` within 3× normal intervals.

## Notes

* The user-visible error for an unavailable provider is `503 PROVIDER.UNAVAILABLE` (docs/08 §2.2).
* After recovery, a canary round on the golden set (docs/11 §4 thresholds) is mandatory before
  declaring the ladder is back at full strength — a half-degraded generator that produces answers
  *without* signals is worse than a clean 503.
* This runbook is exercised in every quarterly restore/DR drill.
