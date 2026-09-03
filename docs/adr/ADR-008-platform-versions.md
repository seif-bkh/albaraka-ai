# ADR-008 — Platform baseline (September 2026)

**Status**: Accepted · **Date**: 2026-09-03 · **Reversibility**: soft within a major line; hard across
majors

## Context

A greenfield build starting September 2026 must choose versions with an eye on **support windows**,
because two EOL events landed recently and they couple our choices:

* **Spring Boot 3.5 reached end of OSS support on 30 June 2026.** Spring Boot 4.x is the only
  OSS-supported line (4.1.1 at the time of writing).
* **Spring AI 1.x aligns to Boot 3.5; Spring AI 2.0 (GA 12 June 2026) requires Boot 4.** The two
  migrations are therefore coupled — you cannot take Spring AI 2.0 on Boot 3.x, and staying on
  Spring AI 1.x means staying on an EOL platform.
* **Angular 22** was released 3 June 2026 (stable Signal Forms, stable Angular ARIA); Angular 21 is in
  LTS until May 2027; Angular 20's LTS ends November 2026.
* **Keycloak 26.6.3** (June 2026) is a security release fixing 16 CVEs.
* **pgvector 0.8.x** brought iterative index scans and improved cost estimation for filtered ANN —
  both essential to our filtered hybrid retrieval (ADR-003).

Banks also care about *boring*: every version here is a GA release on a supported line, with no
milestone or release-candidate dependencies.

## Decision

| Layer | Version | Rationale |
|---|---|---|
| Java | **21 (LTS)** | Boot 4 baseline is 17; 21 gives virtual threads (useful for the many concurrent provider calls per answer) and a longer support horizon |
| Spring Boot | **4.1.x** | Only OSS-supported line; Spring Framework 7, Jackson 3, JSpecify null-safety |
| Spring AI | **2.0.x** | Required by Boot 4; mature `VectorStore`, Advisor and RAG abstractions; keep patched (CVE-2026-22729/22730 affected 1.0.x/1.1.x) |
| Build | **Maven 3.9+**, multi-module, wrapper committed | Reproducible builds; Gradle offers nothing decisive here and Maven is more familiar to bank teams |
| Angular | **22.x** | Current stable, longest support window (LTS to Dec 2027), stable Signal Forms and Angular ARIA (accessibility is a hard requirement) |
| TypeScript / Node | 5.9+ / **22 LTS** | Matches Angular 22 support matrix |
| UI kit | **Angular Material + Angular ARIA** | Accessible headless primitives, RTL-aware, themable to the bank palette |
| Keycloak | **≥ 26.6.3** | Security floor (ADR-004) |
| PostgreSQL | **17** | Current supported major; required for pgvector 0.8.x behaviour we rely on |
| pgvector | **0.8.1** | Iterative index scans for filtered ANN; `halfvec`; `sparsevec` available for a future learned-sparse strategy |
| Extensions | `pg_trgm`, `unaccent` | Typo tolerance and French accent folding |
| Redis | **7.x** | Cache, rate limiting, pub/sub cache invalidation |
| Object storage | **S3-compatible** (MinIO in dev) | Document originals, WORM audit head |
| Migrations | **Flyway 11.x** | Versioned, reviewed, rollback-scripted |
| Observability | **OpenTelemetry** + Prometheus + Loki + Tempo + Grafana | Vendor-neutral; Keycloak 26.1+ also supports OTel tracing |
| Testing | JUnit 5, **Testcontainers**, WireMock, ArchUnit, **Vitest**, Playwright, axe | Vitest is Angular 21+'s default runner (Karma is gone) |
| Container base | `eclipse-temurin:21-jre` / `nginx:alpine` | Non-root, scanned, signed |

## Alternatives considered

| Option | Why not |
|---|---|
| Spring Boot 3.5 + Spring AI 1.1 | Platform is EOL for OSS since 30 June 2026; starting a new bank system on an unpatched line is indefensible |
| Kotlin instead of Java | Excellent with Spring, but adds a skill requirement for the bank's team and for future maintainers; no functional gain here |
| Gradle | Fine, but Maven's ubiquity in Tunisian/French banking IT wins for handover |
| Angular 21 (LTS) | Angular 22's LTS window runs to Dec 2027 vs May 2027, and Signal Forms/ARIA are stable rather than experimental |
| React/Vue | The owner specified Angular |
| Qdrant/ES instead of pgvector | See ADR-003 |
| LangChain4j | Framework-agnostic and Java-17 friendly, but we are already on Boot 4 and Spring AI's Spring-native integration, MCP support and vector-store abstraction fit better |
| Bleeding-edge (Boot 4.2 / Angular 23 when they land) | Quarterly upgrade cadence instead; pinned minors with a two-week upgrade buffer |

## Consequences

**Positive**: every component is on a supported, patched line; Spring AI 2.0 gives first-class RAG
abstractions that match our design (VectorStore, Advisors, structured output); Angular 22 gives stable
accessibility primitives and Signal Forms for the heavy backoffice forms; pgvector 0.8 makes filtered
hybrid retrieval correct rather than approximately correct; Java 21 virtual threads suit a
fan-out/fan-in pipeline of provider calls.

**Negative / risks and mitigations**:

| Risk | Mitigation |
|---|---|
| Boot 4 / Spring AI 2 / Jackson 3 are new; ecosystem tutorials are mostly Boot 3 | Pin exact versions, keep the provider layer thin, recorded-fixture tests, and budget a two-week upgrade window per quarter |
| Jackson 3 migration surprises (serialisation changes) | DTOs are records with explicit annotations; contract tests generated from OpenAPI |
| Angular 22 breaking changes vs 21-era code samples | Rely on official docs; `ng update` per minor; lint rules ban removed APIs |
| Spring AI CVEs in a fast-moving project | Dependency gate blocks promotion on CRITICAL/HIGH; subscribe to advisories; the adapter layer limits blast radius |
| Team familiarity | Phase 1 includes a spike week; the `tools/spike` harness validates provider integration before any feature work |

**Follow-ups**: re-verify the exact Spring AI 2.0.x patch level at Phase 1 kickoff; confirm
`spring-ai-starter-model-google-genai` supports `outputDimensionality` on the pinned version (if not,
the embedding adapter calls the GenAI REST API directly — still behind `EmbeddingProvider`).
