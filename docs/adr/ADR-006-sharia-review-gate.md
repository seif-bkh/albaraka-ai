# ADR-006 — Sharia control as a gate on content reachability, not only an output filter

**Status**: Accepted · **Date**: 2026-09-03 · **Reversibility**: hard — this is a control, not a
preference; relaxing it requires a new ADR plus Sharia-committee and Compliance acknowledgement

## Context

An Islamic bank deploying an LLM faces a question no generic RAG design answers: *what makes an
answer religiously acceptable?* The intuitive engineering answer — "filter the model's output" — is
the weakest available control: it is probabilistic, it depends on a lexicon that is always incomplete,
and it fails silently.

The Tunisian framework shapes the rest: **loi n° 2016-48** enumerates Islamic banking operations and
places conformity control with the **BCT** against international standards (AAOIFI, CIBAFI); it
provides for a **comité de contrôle de conformité des normes bancaires islamiques** attached to the
board (art. 53–54), whose members are appointed by the AGO, may not sit on more than one such
committee, and whose appointment the BCT must be notified of without delay. **Circulaire BCT
n° 2021-05** adds governance detail, including an **auditeur des opérations bancaires islamiques**.
Conformity is therefore an *institutional, evidenced, attributable* process — not a runtime heuristic.

## Decision

**Primary control: reachability.** Content can only be retrieved by the assistant if it is
`PUBLISHED`, `sharia_approved`, within its temporal validity window, and within the requester's
audience/classification scope. This is expressed as a **materialised, indexed `searchable` boolean**
on `chunk`, recomputed by a database trigger, flipped inside the same transaction as the governance
state change, cache-epoch bump and audit row. Retrieval SQL always filters on it.

Consequences of making this the primary control:

1. **Unapproved content cannot leak, even if application code has a bug** — the predicate is in the
   database and in every retrieval query.
2. **Approval is attributable**: a `sharia_review` with `review_task` rows records who decided, when,
   in which language, with what reason, under which risk tier.
3. **Two-eyes is enforced by trigger**, not by UI convention: a submitter cannot approve their own
   submission; T3 requires a Sharia-officer *and* a Compliance decision.
4. **Risk tiering** (T1 auto-approve with sampling / T2 single Sharia officer / T3 dual approval) keeps
   the committee's workload survivable — the most likely practical failure of a governance-heavy design.
5. **Emergency withdrawal** is a first-class action (`WITHDRAWN`) that removes content from retrieval
   immediately, without a review cycle, and opens an incident.

**Secondary controls (defence in depth)**, none of which may substitute for the gate:

* The **no-fatwa rule**: the assistant never determines halal/haram, enforced by intent classification,
  a lexicon, and an output judge; ruling requests become `fatwa_request` tickets for the committee.
* The **output Sharia policy classifier** (lexicon + LLM judge with a versioned, T3-approved rubric).
* **Terminology governance**: `term_glossary` with forbidden renderings, injected into prompts and
  checked deterministically at output.
* **Server-appended disclaimers** — the model cannot forget what it never writes.
* **Grounding and numeric validators** — an unsupported number is suppressed even if religiously
  harmless, because a wrong tariff harms customers too.
* **Hash-chained audit** with a daily head published to WORM storage, and an **evidence pack** export
  for the committee and the BCT.

The guardrail policies, the judge prompt and the refusal templates are themselves subject to the same
governance: the instrument that polices Sharia wording is under Sharia governance.

## Alternatives considered

| Option | Why not |
|---|---|
| Output filtering only (blocklist + classifier) | Probabilistic, silently failing, unauditable, and it would let non-approved content be *retrieved* and nearly-served |
| Query-time evaluation of the approval predicate (no materialised flag) | Correct but fragile: one forgotten `WHERE` clause in one repository method leaks content; and it complicates index usage |
| Human review of every generated answer | Does not scale, and delays customer experience to minutes |
| Trusting the model with a "be Sharia-compliant" instruction | Not a control |
| Restricting the assistant to a hard-coded FAQ | Loses the entire value of RAG; still needs governance for the FAQ itself |

## Consequences

**Positive**: the strongest available guarantee — a conformity property enforced by the database and
verifiable by an auditor; clear accountability mapping onto the statutory committee; a survivable
review workload thanks to tiering; the assistant's religious scope shrinks to *reporting approved
content*, which is both defensible and useful; the evidence pack makes regulatory reporting a report,
not a project.

**Negative / risks and mitigations**:

| Risk | Mitigation |
|---|---|
| Committee bandwidth becomes the launch bottleneck | T1 auto-approval for already-published bank content; bulk review of the initial corpus; SLA tracking and escalation in the backoffice |
| Content staleness when review is slow | Temporal validity (`valid_to`) makes outdated content unreachable automatically; weekly overdue-review report |
| Over-refusal (a timid assistant that answers nothing) | Refusal-rate and coverage-gap dashboards; the "publish as KB article" loop turns refusals into coverage; per-topic refusal trends reviewed monthly |
| False sense of security from the gate alone | The secondary controls are mandatory, not optional; the red-team suite tests both layers |
| Governance overhead for trivial UI copy | T1 tier with sampling audit keeps microcopy fast |

**Follow-ups**: the committee chair must confirm the tiering, the SLAs and whether committee minutes
are required before a T3 activation is valid (doc 00 §9.2, doc 05 §1).
