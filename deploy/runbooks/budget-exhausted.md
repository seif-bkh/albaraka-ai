# RUNBOOK — budget-exhausted

| | |
|---|---|
| **Scenario** | Daily provider spend limit reached; generation degrading to cache/retrieval-only |
| **RTO / RPO** | n/a — a *deliberate* hard control, not an outage |
| **Source of truth** | docs/12 §10 (budget guard), specs/db/schema.sql `model_config.daily_budget_usd`, `token_usage_daily`, specs/config/application.yaml `albaraka.budget` |

## The control, exactly

`daily_budget_usd` is on the active `model_config` row(s) (`code = 'PRIMARY'` + guards where
configured). The guard is evaluated server-side against `token_usage_daily`:

| Usage | Behaviour |
|---|---|
| ≥ 80 % | shift generation to the fast model (`llama-3.1-8b-instant`) |
| ≥ 100 % | cached/retrieval-only answers (`SseAnswer.cached` or `refusal` with `degradationStep`) |
| both thresholds | page the AI engineer |

It is a **hard control**: a runaway loop must never produce a five-figure invoice.

## Steps

1. **Confirm, don't panic.** `SELECT * FROM token_usage_daily ORDER BY usage_date DESC LIMIT 14;`
   — the guard is working as designed if the daily row sits at/above the cap.
2. **Find the run away.** `llm_call_log` grouped by `model_id`, `provider`, `intent_code` + the
   `retrieval_trace` join for the offending conversations. Two usual causes:
   * a promptstudio/prompt change that removed a caching invariant (semantic-cache key drift);
   * an ingestion/re-embedding job re-embedding chunks unnecessarily.
3. **Stop the bleeding.**
   * runaway ingestion → cancel the `ingestion_job` rows (`status = 'CANCELLED'`) and fix the
     trigger; do **not** raise the budget to keep a bad job running;
   * runaway generation → raise the outage (`provider-outage.md` is *not* this, but the same
     first question applies: is the provider slow or is the *call pattern* wrong?).
4. **Reconcile the number.** `token_usage_daily` is the accounting source; provider invoices are
   the external truth. If they disagree, the integration bug is in the usage accounting path —
   treat as an incident (`incident` table, `severity_level`), not as a rounding question.
5. **Only now, deliberately**: adjust `daily_budget_usd` to the reviewed monthly projection
   (docs/12 §10 ≈ $1 700–2 300/month at 10 k answers/day) — via the normal `model_config` review
   path (DRAFT → IN_REVIEW → ACTIVE), never by editing the active row in place.

## Verification

* With the cap at a known value, a load that exceeds it produces `SseRefusal`/cached answers and
  the page fires once, not in a loop (alert deduplication is part of this test).
* `docker compose logs server | grep -i budget` shows the threshold transition only once.

## Notes

* `ALBARAKA_DAILY_BUDGET_USD` in `.env` / compose is the **dev** default (5.00). Production is an
  `assistant_config`/`model_config` value, not an env var — see specs/config/README.md.
* Raising the limit to "see what happens" without a reviewed change is a finding.
