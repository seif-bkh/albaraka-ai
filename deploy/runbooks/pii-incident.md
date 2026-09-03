# RUNBOOK — pii-incident

| | |
|---|---|
| **Scenario** | Personal data (name, CIN, IBAN, phone, email, address…) observed in a prompt, context, answer, log, trace, or embedding |
| **RTO / RPO** | Contain ≤ 1 h; evidence preserved (audit chain is append-only); no *silent* deletion |
| **Source of truth** | docs/07 (PII policy, data residency, erasure), specs/db/schema.sql (`erasure_request`, `audit_event`, `guardrail_event`), docs/08 §2.2 (REF-04) |

## First questions (answer them in the incident, in writing)

1. **Where is it?** prompt message (`message`/`message_bundle`), RAG context (`retrieval_trace`),
   generated answer (transient, unless cached — check semantic cache), `llm_call_log` payload,
   guardrail event, or **embedding/vector** (`chunk_embedding` — PII inside an embedded chunk is a
   *model-level* leak: you cannot selectively delete one vector without re-embedding).
2. **Was it sent offshore?** Providers are GROQ/GOOGLE (docs/12: providers-allowed-offshore) —
   the *provider call* itself triggers the data-residency notification and the Compliance
   double-check. If the call carried conversational PII, that is the DPIA/notification scope, not
   just the PII-in-answer scope.
3. **Who can see it?** admin, agent desk, widget, public.

## Containment (in order)

1. **Kill switch to `NO_GENERATION`** (`kill-switch.md`) if generation is the leak path. Fast,
   auditable, reversible.
2. **Purge from reachable surfaces:**
   * the offending `conversation` rows are **not deleted** — they are the evidence and are subject
     to `erasure_request`. Mark `conversation_state = 'ESCALATED'` and stop serving them;
   * drop the semantic-cache entries containing the answer (`cache-flush.md`, targeted prefix
     scan), and the offending `message_bundle`/response if `cached: true` is possible;
   * the *embedding* case: quarantine the document (`content-withdrawal.md`), plan a re-embed of
     the affected chunks.
3. **Open `erasure_request`** (`subject_ref`, `scope`, `legal_hold`) — the delete is
   procedure-driven and Compliance-approved; it must be the *only* mechanism that removes rows.
4. **Log it properly.** A PII incident is `incident` + `audit_event` with reasons; the
   `guardrail_event` rows (if the PII guardrail fired) are the evidence the finding must cite.

## Root-cause check

The PII guardrail is `guardrail_policy` `code = 'PII_*'`-class with input/output scope. A leak
past a **PASS** guardrail is a policy-tuning failure (threshold/pattern too weak) and belongs in
`guardrail_policy` review — not "the model sometimes says it". If it fired `WARN` and the answer
flowed, the severity policy is the defect: docs/08 §2.2 maps PII leakage to `REF-04`, and the
`guardrail` decision for PII on output is `BLOCK` by default.

## Verification

* The leaked value returns nothing across: chat, retrieval trace admin view, logs (grep router),
  and is absent from newly generated answers.
* `erasure_request` row is `EXECUTED` with `evidence` JSON and `executed_at`.
* KV-level check: `SELECT count(*) FROM message_bundle WHERE text ILIKE '%<value>%'` → 0 for the
  scope; note that `llm_call_log` may legitimately retain the input hash — the **retention policy**
  in docs/07 governs what stays.

## Notes

* Never `DELETE FROM message …` ad hoc: `trg_audit_append_only` protects `audit_event`, but the
  content tables are protected by **process**, not by trigger — and process is exactly what a
  runbook is for.
* The incident is a Compliance event, not an engineering ticket. The `reason_code` for the
  break-glass access during investigation (if any) must be recorded in `audit_event`.
