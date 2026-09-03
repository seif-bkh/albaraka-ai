# 13 — Roadmap & Delivery Plan

> **Scope adjustment (2026-09-03):** this plan now covers **Phase 0 only**. Phases 1–6 (Foundations,
> RAG core, Governance & backoffice, Quality/guardrails/safety, Scale/integration/go-live,
> Extensions) were struck from the plan together with their timeline, team, milestone, go-live
> readiness, post-go-live and budget sections. Nothing in the removed content is binding anymore.
> The full prior text remains in the repository history (before commit `d15a654`). Files that the
> struck phases would have produced stay marked **← Phase 1 / Phase 5** in `docs/02 §1` as planned
> paths; they are no longer part of any committed plan.

## 1. Guiding principles

1. **Governance before generation.** The Sharia gate, audit trail and two-eyes workflow land *with*
   the first customer-facing answer, not after it. An ungoverned assistant that is later constrained
   has to be re-reviewed from scratch.
2. **Vertical slices, not horizontal layers.** Every delivered slice ends with something a business
   person can click and judge.
3. **Measure from day one.** The golden set and the eval harness exist before the backoffice does —
   otherwise there is no way to know whether a change helped.
4. **No personal data until Compliance says so.** v1 is knowledge-only; account servicing is a
   separately governed effort.
5. **Every provider call has a fallback.** The bank must not be one Groq outage away from a broken
   customer experience.

## 2. Phase 0 — Architecture & specification ✅ *(this deliverable)*

| | |
|---|---|
| **Scope** | Design docs 00–13, ADRs, glossary, OpenAPI contract, AsyncAPI event contract, PostgreSQL DDL, Keycloak realm, prompt sources, golden-set seed, docker-compose topology, runbooks, dependency smoke test |
| **Deliverables** | Everything under `docs/`, `specs/`, `deploy/`, `tools/spike/` |
| **Acceptance** | Walkthrough accepted by Architecture; Compliance confirms the data-flow and residency analysis; Sharia committee chair confirms the review workflow and tiering; the two provider keys validated by `tools/spike` |
| **Effort** | ~12 person-days (done) |
| **Exit risk** | Open questions in doc 00 §9 must be closed in the sign-off walkthrough before Phase 0 is claimed complete — nothing else blocks it |

Every artifact is kept honest by a gate in `tools/` (each linter ships a mutation self-test proving
it can fail); see `docs/02 §1` and §6 for the run list.

## 3. Definition of Done (every artifact)

* Reviewed by one peer (or, for generated/spec artifacts: the corresponding `tools/` gate with its
  mutation self-test); CI green (build, unit, integration, ArchUnit, lint, contract diff, SAST,
  secrets, image scan).
* Tests: unit for domain logic, integration for anything touching Postgres/pgvector, no live provider
  calls in PR tests.
* Trilingual: any user-visible string exists in FR/AR/EN and renders correctly in RTL (dictionary
  completeness check is part of CI).
* Accessibility: axe clean for new UI; keyboard operable.
* Audit: any state change emits an audit event.
* Security: no new endpoint without a role annotation; no new egress path without the `EgressGuard`.
* Documentation: OpenAPI updated, CHANGELOG entry, runbook touched if operational behaviour changed.
* Evaluation: if prompts, retrieval, guardrails or KB changed → the PR eval gate ran and passed.

## 4. What was struck from this plan

| Removed (2026-09-03) | Original content | Status |
|---|---|---|
| Phase 1 — Foundations (3 weeks) | Monorepo scaffold, CI pipeline, docker-compose, Flyway `V1__`, realm import + MFA, resource server, codegen, Angular shells, mock SSE, actuator skeleton | struck |
| Phase 2 — RAG core (4 weeks) | Groq/Google adapters, pgvector hybrid retrieval, FTS/Derja, chunker, ingestion, RRF/rerank, generator, citations, guardrails v1, semantic cache, eval module | struck |
| Phase 3 — Governance & backoffice (4 weeks) | Document library, review board, fatwa queue, glossary/Derja managers, prompt studio, retrieval lab, budget panel, hash-chain viewer, RBAC hardening | struck |
| Phase 4 — Quality, guardrails & safety (3 weeks) | Moderation models, Sharia classifier, hallucination check, CSP/rate limiting, 400-case golden set + red team, CI eval gate, canary rollback, load test | struck |
| Phase 5 — Scale, integration & go-live (3 weeks) | K8s/Helm, HA Postgres/Keycloak, nginx edge + WAF, observability, backup/PITR, DR, widget, UAT, production readiness, hypercare | struck |
| Phase 6 — Extensions (post-launch) | Agent assist, account servicing, voice, on-prem inference, notifications, cross-entity sharing, fine-tuned models | struck |
| §3 Timeline (≈19-week gantt, soft launch, GA milestone) | schedule for Phases 1–5 | struck |
| §4 Team (≈7 FTE vendor + 3 FTE bank-side at peak) | staffing per phase | struck |
| §6 Milestone demos (M1–M6, GA) | phase-end demos | struck |
| §7 Production readiness review | go-live checklist for Phase 5 | struck |
| §8 First 90 days after go-live | hypercare, KPIs, success criteria | struck |
| §9 Budget outline (indicative) | 19-week delivery cost model | struck |
| §10 What would change this plan | phase-dependent triggers (ONPREM swap, account servicing, IdP reuse, volume 10×) | struck |

If any of the struck phases are ever re-scoped, the plan must be re-written from a clean section
listing ADRs and open doc 00 §9 questions first — not revived by un-striking this file.
