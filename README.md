# Al Baraka AI — Trilingual Sharia-Compliant RAG Assistant

**Al-Mouchir** (المشير) — a Retrieval-Augmented Generation assistant for **Al Baraka Bank Tunisia**,
serving customers in **French, Arabic and English**, grounded exclusively in **Sharia-approved**
bank knowledge, with two facades:

| Facade | Audience | Purpose |
|---|---|---|
| **Frontoffice** | Customers, prospects, branch agents | Trilingual conversational assistant (web app + embeddable widget), cited answers, human hand-off |
| **Backoffice** | KB editors, Sharia officers, AI engineers, compliance, support | Knowledge-base lifecycle, prompt & model studio, Sharia review board, guardrails, retrieval lab, QA loop, analytics, audit |

The assistant is **admin-upgradeable at runtime**: knowledge, prompts, retrieval parameters,
guardrail policies and model routing are all versioned data, not code. Changing the assistant's
behaviour does not require a deployment.

---

## Current state

> **Phase 0 — Architecture & Specification (this deliverable).**
> This repository currently contains the complete design: architecture, data model, API contract,
> RAG pipeline, Sharia-governance workflow, i18n/RTL strategy, security & Tunisian regulatory
> mapping, evaluation framework, deployment topology and a phased delivery plan — plus the
> machine-readable artifacts that Phase 1 will build against (`specs/`).
>
> Application code (`server/`, `apps/`) is intentionally **not** present yet. The roadmap in
> [`docs/13-roadmap-delivery-plan.md`](docs/13-roadmap-delivery-plan.md) defines the build order.

## Document map

### Design
| # | Document | What it answers |
|---|---|---|
| 00 | [Executive summary](docs/00-executive-summary.md) | What we build, why, decisions taken, risks |
| 01 | [System architecture](docs/01-system-architecture.md) | Context/container/component views, runtime flows, module boundaries |
| 02 | [Repository layout](docs/02-repository-layout.md) | Monorepo structure, build topology, naming conventions |
| 03 | [Data model](docs/03-data-model.md) | Entities, relationships, vector storage, lifecycle states, retention |
| 04 | [RAG pipeline](docs/04-rag-pipeline.md) | Query understanding → hybrid retrieval → rerank → grounded generation → output guardrails |
| 05 | [Sharia governance](docs/05-sharia-governance.md) | Review board workflow, two-eyes rule, prohibited-content policy, fatwa routing, auditability |
| 06 | [Trilingual & RTL](docs/06-i18n-trilingual-rtl.md) | FR/AR/EN locale strategy, RTL/Bidi, Tunisian Derja, terminology glossary |
| 07 | [Security, IAM & compliance](docs/07-security-iam-compliance.md) | Keycloak/OIDC, RBAC, data protection (Loi 2004-63, banking secrecy), cross-border data risk |
| 08 | [API design](docs/08-api-design.md) | REST conventions, SSE streaming contract, error model, versioning |
| 09 | [Backoffice specification](docs/09-backoffice-spec.md) | Screen-by-screen functional spec for admins |
| 10 | [Frontoffice specification](docs/10-frontoffice-spec.md) | Chat UX, widget embedding, accessibility, hand-off |
| 11 | [Quality & evaluation](docs/11-quality-evaluation.md) | Golden set, RAG metrics, Sharia-specific metrics, CI release gates |
| 12 | [Deployment & observability](docs/12-deployment-observability.md) | Environments, topology, tracing, cost/token accounting, DR |
| 13 | [Roadmap & delivery plan](docs/13-roadmap-delivery-plan.md) | 6 phases, milestones, team, acceptance criteria |
| — | [Trilingual glossary](docs/glossary-trilingual.md) | Canonical FR/AR/EN Islamic-finance terminology |
| — | [Architecture Decision Records](docs/adr/README.md) | ADR-001 … ADR-008 |

### Machine-readable specifications (`specs/`)
| Artifact | Purpose |
|---|---|
| [`specs/openapi.yaml`](specs/openapi.yaml) | Full API contract for both facades (source of truth; TS + Java clients are generated from it) |
| [`specs/db/schema.sql`](specs/db/schema.sql) | PostgreSQL 17 + pgvector DDL: tables, indexes, triggers, hash-chained audit |
| [`specs/keycloak/albaraka-realm.json`](specs/keycloak/albaraka-realm.json) | Realm, clients, roles, groups, MFA policy |
| [`specs/prompts/`](specs/prompts/) | Versioned system prompts (FR/AR/EN), Sharia guardrail clauses, refusal templates |
| [`specs/eval/golden-set.jsonl`](specs/eval/golden-set.jsonl) | Seed evaluation set: trilingual QA pairs with expected citations & refusals |
| [`specs/config/`](specs/config/) | Reference Spring configuration per environment/profile |
| [`deploy/docker-compose.yml`](deploy/docker-compose.yml) | Target-state local/dev topology |
| [`tools/spike/`](tools/spike/) | Dependency smoke test for the Groq + Google embedding + pgvector path |

## Technology decisions (summary)

| Concern | Decision | ADR |
|---|---|---|
| Backend | Java 21 · Spring Boot 4.1.x · Spring AI 2.0.x · Maven multi-module **modular monolith** | [ADR-005](docs/adr/ADR-005-modular-monolith.md) · [ADR-008](docs/adr/ADR-008-platform-versions.md) |
| Frontend | Angular 22 (standalone, signals, zoneless) · two apps + shared UI lib | [ADR-008](docs/adr/ADR-008-platform-versions.md) |
| LLM | **Groq** (OpenAI-compatible) — `llama-3.3-70b-versatile` primary, `llama-3.1-8b-instant` for utility tasks, `llama-guard-4-12b` + `llama-prompt-guard-2-86m` for moderation | [ADR-002](docs/adr/ADR-002-llm-groq-embeddings-google.md) |
| Embeddings | **Google** `gemini-embedding-001` @ 1536 dims (Matryoshka), `taskType` split query/document | [ADR-002](docs/adr/ADR-002-llm-groq-embeddings-google.md) |
| Vector store | **PostgreSQL 17 + pgvector 0.8.1**, HNSW on `halfvec`, hybrid dense + FTS + trigram, RRF fusion | [ADR-003](docs/adr/ADR-003-vector-store-pgvector-hybrid.md) |
| Identity | **Keycloak 26.6.3+**, OIDC, PKCE, realm roles → Spring authorization, MFA for backoffice | [ADR-004](docs/adr/ADR-004-iam-keycloak-oidc.md) |
| Cross-lingual retrieval | One multilingual embedding space + per-chunk FR/AR/EN renderings + Derja→MSA normalisation | [ADR-007](docs/adr/ADR-007-trilingual-retrieval-strategy.md) |
| Sharia control | Content lifecycle gate + two-eyes approval + output policy classifier + no-fatwa rule | [ADR-006](docs/adr/ADR-006-sharia-review-gate.md) |

## Regulatory anchors (Tunisia)

* **Loi n° 2016-48 du 11 juillet 2016** relative aux banques et aux établissements financiers —
  defines *opérations bancaires islamiques* (Mourabaha, Ijara avec option d'acquisition, Moudaraba,
  Moucharaka, Istisna'a, Salam…), places conformity control of those operations with the **BCT**
  against international standards (AAOIFI, CIBAFI), and provides for the
  **comité de contrôle de conformité des normes bancaires islamiques** (art. 53–54).
* **Circulaire BCT n° 2021-05 du 19 août 2021** — governance of banks and financial institutions,
  including the chapter specific to Islamic banking operations and the
  **auditeur des opérations bancaires islamiques**.
* **Loi organique n° 2004-63 du 27 juillet 2004** — protection of personal data (INPDP).
* **AAOIFI Sharia standards** — substantive reference for product conformity.

Every control derived from these texts is traced in
[`docs/07-security-iam-compliance.md`](docs/07-security-iam-compliance.md) and
[`docs/05-sharia-governance.md`](docs/05-sharia-governance.md). Items still to be confirmed with
Al Baraka's Compliance function are explicitly flagged `⚠ TO CONFIRM` rather than assumed.

## Non-goals (v1)

* No access to core-banking account data (balances, statements) — the assistant answers from the
  approved knowledge base only. Account servicing is a later phase behind a dedicated, scoped adapter.
* No autonomous religious rulings. The assistant never issues a fatwa; it routes ruling requests
  to the Sharia committee.
* No voice/video, no outbound marketing, no payment initiation.

---

## Licence & confidentiality

Internal design documentation prepared for Al Baraka Bank Tunisia. Contains no customer data.
