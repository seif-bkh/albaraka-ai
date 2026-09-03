# ADR-005 — Modular monolith instead of microservices

**Status**: Accepted · **Date**: 2026-09-03 · **Reversibility**: soft per module (extraction path is
documented and kept open by the dependency rules)

## Context

The system contains ten identifiable concerns (API, identity, RAG, knowledge, ingestion, governance,
guardrails, analytics, audit, infrastructure adapters). The team is small (peak ≈ 7 vendor FTE), the
deployment target is a bank datacentre or a modest cloud tenancy, and the hardest invariant in the
product is transactional:

> *A chunk becomes retrievable only if, in the same transaction, its governance state is approved,
> its vector is indexed, the cache epoch is bumped and the audit row is written.*

Distributing that invariant across services converts a one-line `@Transactional` into a saga with
compensation — for no v1 benefit.

## Decision

Build a **modular monolith**: one Spring Boot deployable composed of ten Maven modules, with
hexagonal layering inside each module and machine-enforced boundaries.

1. Module layout: `api` / `application` / `domain` / `infrastructure` inside each module; modules talk
   only through their published SPI (`tn.albaraka.ai.<module>.spi`).
2. **ArchUnit rules run in CI and fail the build**: `domain` depends on nothing but the JDK;
   `api` never imports `infrastructure`; no module imports another module's `domain` or
   `infrastructure`; all outbound HTTP goes through `assistant-infra`.
3. One Spring context, one datasource, one transaction manager.
4. **Ingestion/embedding run as workers in the same image** with `--spring.profiles.active=prod,worker`
   — independently scalable, no separate build or deployment pipeline, sharing the DB-backed queue
   (`FOR UPDATE SKIP LOCKED`). No message broker in v1.
5. **Two Angular applications** (frontoffice, backoffice) sharing three libraries
   (`shared-ui`, `shared-contracts`, `shared-i18n`) — separate deployables because they have different
   audiences, security policies and release cadences.
6. **Extraction seams are pre-planned**, in the order they would actually be needed:
   (a) ingestion worker → separate deployment (profile change only);
   (b) `rag-core` → a retrieval service if latency isolation is needed;
   (c) `analytics` → a separate read model over a replica. Each seam is a module boundary already, so
   extraction is a wiring change, not a refactor.

## Alternatives considered

| Option | Why not |
|---|---|
| Microservices from day 1 | Distributed transactions across the Sharia gate, N deployment pipelines for a small team, tracing overhead before there is anything to trace |
| Single-module monolith ("big ball of mud") | Boundaries erode in weeks; the ArchUnit rules are what make the governance model enforceable |
| Serverless / functions | Long-lived SSE streams, warm caches and DB-backed queues fit poorly; bank runtime support for FaaS is usually limited |
| Separate services for frontoffice and backoffice APIs | They share 90 % of the domain; splitting duplicates DTOs and authorization logic |

## Consequences

**Positive**: transactional integrity of the governance gate; one deployable to secure, monitor and
upgrade; trivial local development; a single trace per answer; module boundaries make the code
reviewable by the Sharia auditor's technical adviser; extraction stays possible.

**Negative / risks and mitigations**:

| Risk | Mitigation |
|---|---|
| Boundaries erode under deadline pressure | ArchUnit in CI, code review checklist, `spi` packages as the only legal import surface |
| One deployable = correlated failure | HA with ≥ 2 pods, health probes, graceful drain of SSE streams, workers separated by profile, kill switch |
| Scaling is coarse | HPA on the API pods; worker pods scale on queue depth; Postgres reads offloaded to a replica |
| Slow build as modules grow | Maven parallel builds (`-T1C`), module-level test slicing, build cache |
| Team growth beyond ~12 engineers | Revisit: extract the worker and `rag-core` first, per the pre-planned seams |

**Follow-ups**: add the ArchUnit rule set in Phase 1 (it is cheaper to start with the rules than to
retrofit them); record a future ADR if any module is extracted.
