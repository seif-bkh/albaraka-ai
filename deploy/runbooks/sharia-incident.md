# RUNBOOK — sharia-incident

| | |
|---|---|
| **Scenario** | A published answer contradicts a Sharia ruling, misquotes a fatwa, classifies a product wrong, or a review workflow was bypassed |
| **RTO / RPO** | Contain ≤ 1 h (kill switch optional; withdrawal mandatory), committee decision before re-open |
| **Source of truth** | docs/05 (sharia governance, tiering, quorum, two-eyes), schema.sql (`sharia_review`, `review_task`, `fatwa_request`, `guardrail_event`, `incident`), docs/08 §2.2 (REF-03) |

## What counts as a Sharia incident

* an answer to a religious ruling question that should have been `REF-03` (`no fatwa` / handoff)
  but was answered directly;
* a published `document`/`document_version` of `risk_tier` `T2_MEDIUM`/`T3_HIGH` that reached
  `PUBLIC`/`AGENT` without the tier's quorum (`review_decision` chain missing or
  `sharia_review.approved_by` absent);
* output that contradicts the approved Sharia basis of a product tariff.

## Steps

1. **Contain.** `kill-switch.md` to `READ_ONLY` at minimum (refusals only) until the offending
   rows are withdrawn. A Sharia error is never "metadata" — treat every affected answer as if it
   were live client advice.
2. **Withdraw the source.** `content-withdrawal.md` with the `sharia_review` decision `REJECT` +
   trilingual reason, `reason_code` referencing the incident. Bump `kb_epoch`, flush cache.
3. **Open the governance record.** `incident` row (`severity_level`, likely `S1`), joined by
   `correlation_id` to the `retrieval_trace` of the offending answers, and the `guardrail_event`
   rows: did the Sharia classifier judge (`guardrail.sharia.judge`) pass it? If the policy
   classifier passed a `T2/T3` contract without the judge, that is a **policy** defect
   (`guardrail_policy`), and the fix is a policy change through the review flow, not a one-off.
4. **Committee review.** The incident is closed only after the Sharia committee chair confirms:
   - the ruling content is corrected (via the normal publish flow: `T2` needs two reviewers,
     `T3` quorum — `sharia_review` rows with `review_decision` and `approved_by`);
   - the affected question family is added to `eval_case`/`golden-set` as a regression case;
   - the red-team suite (`specs/eval/red-team.jsonl`) is extended if the bypass was a specific
     phrasing family.

## Re-open sequence

1. corrected content published through the full workflow;
2. `eval_run` green on the new regression cases (docs/11 §4 thresholds);
3. cache flushed, `kb_epoch` bumped, kill switch back to `NORMAL` with the `audit_event` trail.

## Verification

* `SELECT * FROM sharia_review WHERE document_id = :doc ORDER BY created_at;` shows the full
  decision chain with distinct reviewers where quorum is required.
* A fresh ask of the offending question returns the corrected answer with the correct citation, or
  `REF-03` with a `fatwa_request` created (`fatwa_state = 'OPEN'`).
* The regression case fails on the *previous* bundle and passes on the new one (that is the gate
  doing its job).

## Notes

* No release can ship with a known-open Sharia incident: the eval gate (`docs/11`) is the
  enforcement point — "we fixed it in prod" is not an accepted state.
