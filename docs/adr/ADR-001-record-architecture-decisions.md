# ADR-001 — Record architecture decisions

**Status**: Accepted · **Date**: 2026-09-03 · **Reversibility**: n/a

## Context

This system mixes three domains that rarely share a vocabulary: Islamic banking governance, RAG
engineering and enterprise platform architecture. Decisions here have long-lived consequences
(embedding dimension, vector store, Sharia control model) and will be questioned by auditors, the
Sharia committee, Compliance and future engineers — often years after the people who took them have
left. Tribal knowledge and chat threads are not an acceptable record in a regulated bank.

## Decision

We record every architecturally significant decision as an ADR in `docs/adr/`, following
Context → Decision → Alternatives → Consequences, with a status, a date and an explicit
reversibility classification (soft/hard).

Rules:
1. An ADR is **immutable once accepted**. Changing a decision means writing a new ADR that supersedes
   it and updating the status of the old one.
2. The `docs/` narrative always references the current ADR; it never contradicts it.
3. ADRs are reviewed in the same pull request as the code that implements them — a decision without
   an implementation path is not a decision.
4. Anything that changes the Sharia control model, the data-residency posture or the audit trail
   **requires** an ADR plus Compliance/Sharia-committee acknowledgement.

## Alternatives considered

| Option | Why not |
|---|---|
| A single large design document | Loses the history of *why*; edits silently rewrite the past |
| Wiki / Confluence only | Not versioned with the code, not reviewable in a PR, drifts |
| Commit messages as the record | Unsearchable, no structure, no status |
| No records ("the code is the documentation") | Unacceptable for a regulated institution with external audit |

## Consequences

**Positive**: decisions are traceable and auditable; onboarding is faster; reversals are explicit
rather than accidental; the committee and Compliance can review *choices*, not just code.

**Negative**: a small writing overhead per decision; risk of ADR inflation for trivial choices
(mitigated by the "architecturally significant" bar: does it constrain future options, cost money,
or affect conformity/security?).

**Follow-ups**: this ADR set is seeded with ADR-002…008 covering the decisions taken during Phase 0.
