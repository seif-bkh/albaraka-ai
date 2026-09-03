# Architecture Decision Records

Lightweight ADRs (MADR-style): *Context → Decision → Alternatives → Consequences*. Once accepted, an
ADR is only changed by a new ADR that supersedes it — never edited in place. The `docs/` set always
references the current decision.

| ADR | Title | Status | Date |
|---|---|---|---|
| [001](ADR-001-record-architecture-decisions.md) | Record architecture decisions | Accepted | 2026-09-03 |
| [002](ADR-002-llm-groq-embeddings-google.md) | LLM on Groq, embeddings on Google, behind a pluggable provider layer | Accepted | 2026-09-03 |
| [003](ADR-003-vector-store-pgvector-hybrid.md) | PostgreSQL + pgvector with hybrid retrieval and LLM reranking | Accepted | 2026-09-03 |
| [004](ADR-004-iam-keycloak-oidc.md) | Keycloak as the identity provider (OIDC + PKCE) | Accepted | 2026-09-03 |
| [005](ADR-005-modular-monolith.md) | Modular monolith instead of microservices | Accepted | 2026-09-03 |
| [006](ADR-006-sharia-review-gate.md) | Sharia control as a gate on content reachability, not only an output filter | Accepted | 2026-09-03 |
| [007](ADR-007-trilingual-retrieval-strategy.md) | One multilingual embedding space plus per-chunk renderings and Derja normalisation | Accepted | 2026-09-03 |
| [008](ADR-008-platform-versions.md) | Platform baseline: Spring Boot 4 + Spring AI 2, Angular 22, Keycloak ≥ 26.6.3, PostgreSQL 17 + pgvector 0.8.1 | Accepted | 2026-09-03 |

## Conventions

* **Accepted** — the decision stands and the design follows it.
* **Superseded by ADR-xxx** — replaced; kept for history.
* **Deprecated** — no longer applies.
* Decisions that are *reversible with configuration* are marked **soft**; those requiring a migration
  or a rewrite are marked **hard**. Revisit hard decisions only with a new ADR.

| ADR | Reversibility |
|---|---|
| 002 | soft (provider interface) except embedding dimension change → hard (re-index) |
| 003 | soft for the reranker; hard for the vector store (data migration) |
| 004 | soft if the replacement is OIDC-conformant |
| 005 | soft per module (extraction path documented) |
| 006 | hard — this is a control, not a preference |
| 007 | hard (index and content strategy) |
| 008 | soft within a major line; hard across majors |
