# 01 — System Architecture

## 1. Context (C4 level 1)

```mermaid
flowchart TB
    CUST([Customer / prospect<br/>FR · AR · EN])
    AGENT([Branch agent / call-centre])
    ADMIN([Backoffice users<br/>KB editor · Sharia officer · AI engineer · compliance])
    SYS[[Al-Mouchir<br/>Trilingual RAG Assistant]]
    KC[Keycloak IdP]
    CORE[Core banking system<br/>— out of scope v1]
    WEB[albaraka.com.tn<br/>widget host]
    GROQ[Groq API]
    GOOG[Google GenAI API]
    MAIL[SMTP / ticketing]

    CUST -->|asks a question| SYS
    AGENT -->|assists a customer| SYS
    ADMIN -->|curates knowledge, prompts, policies| SYS
    WEB -->|embeds| SYS
    SYS -->|authenticates via| KC
    SYS -->|generates answers| GROQ
    SYS -->|embeds text| GOOG
    SYS -->|routes fatwa requests & escalations| MAIL
    SYS -.->|Phase 6, scoped adapter| CORE
```

**Trust boundaries**: everything left of the dashed line is bank-controlled. Groq and Google calls
cross the boundary and therefore pass through the **egress PII gate** (§7.4) — no personal data,
no account data, no credentials.

## 2. Container view (C4 level 2)

```mermaid
flowchart LR
    subgraph FE["Frontend tier (Angular 22)"]
        FO[frontoffice-web<br/>SPA + embeddable widget]
        BO[backoffice-web<br/>admin SPA]
        SH[(shared-ui<br/>shared-contracts libs)]
    end
    subgraph EDGE["Edge"]
        NG[Nginx / API gateway<br/>TLS · WAF · rate limit · CORS]
    end
    subgraph APP["Application tier — one Spring Boot deployable"]
        BOOT[assistant-boot<br/>composition root]
        M1[assistant-api]
        M2[rag-core]
        M3[knowledge]
        M4[ingestion]
        M5[governance]
        M6[guardrails]
        M7[identity]
        M8[analytics]
        M9[audit]
        M10[assistant-infra<br/>LLM/embedding/vector adapters]
    end
    subgraph DATA["Data tier"]
        PG[(PostgreSQL 17<br/>pgvector · FTS · audit)]
        RD[(Redis<br/>cache · rate-limit · locks)]
        S3[(S3 / MinIO<br/>document originals)]
    end
    subgraph EXT["External"]
        KC[Keycloak]
        GQ[Groq]
        GG[Google GenAI]
        OTEL[OTel collector → Tempo/Prometheus/Loki/Grafana]
    end

    FO --> NG
    BO --> NG
    NG --> BOOT
    BOOT --> M1 --> M2 --> M6
    M1 --> M8
    M2 --> M10
    M3 --> M10
    M4 --> M10
    M5 --> M3
    M10 --> PG
    M10 --> GQ
    M10 --> GG
    M4 --> S3
    M1 --> RD
    M7 --> KC
    BOOT --> OTEL
    M9 --> PG
```

**Deployment units**: 2 static SPA bundles (frontoffice, backoffice) + 1 Spring Boot jar + Postgres
+ Redis + object storage + Keycloak. That is deliberately few moving parts. Ingestion runs as an
**async worker inside the same deployable** (Spring `@Async` + a DB-backed job queue) with a
profile to split it out later if volume requires it.

## 3. Module boundaries (component view)

Maven modules; each is a hexagonal slice (`api` / `application` / `domain` / `infrastructure`).
Modules communicate through **published interfaces only** — enforced by
[ArchUnit](https://www.archunit.org/) tests in CI (see §9).

| Module | Responsibility | Owns tables | Must NOT |
|---|---|---|---|
| `assistant-api` | REST controllers, SSE endpoints, request validation, DTO mapping | — | Contain business rules or SQL |
| `assistant-identity` | JWT validation, claims→authorities mapping, tenant/locale resolution | `user_preference` | Talk to Keycloak admin API from request threads |
| `rag-core` | Query understanding, retrieval orchestration, reranking, context assembly, grounded generation | `retrieval_config`, `retrieval_trace`, `retrieval_candidate` | Read documents directly (goes through `knowledge`) |
| `knowledge` | Documents, versions, chunks, translations, glossary, collections, publication state | `document`, `document_version`, `chunk`, `chunk_translation`, `term_glossary`, `collection` | Call an LLM |
| `ingestion` | Connectors, parsing, chunking, normalisation, translation, embedding jobs, re-indexing | `ingestion_job`, `embedding_job` | Be invoked synchronously from a user request |
| `governance` | Sharia review workflow, approvals, two-eyes enforcement, fatwa-request routing | `review_task`, `sharia_review`, `fatwa_request` | Publish content itself (it flips state, `knowledge` reacts) |
| `guardrails` | Input/output moderation, injection detection, prohibited-topic policy, PII redaction, refusal taxonomy | `guardrail_policy`, `guardrail_event` | Be bypassable — every call path passes through it |
| `analytics` | Metrics aggregation, feedback, QA queues, cost/token accounting, dashboards API | `feedback`, `conversation_metric`, `token_usage`, `eval_run` | Mutate knowledge |
| `audit` | Append-only hash-chained event log, export for regulators/committee | `audit_event` | Update or delete a row (DB trigger forbids it) |
| `assistant-infra` | Adapters: Groq chat, Google embeddings, pgvector store, object storage, cache, mail | — | Contain domain concepts |

### 3.1 Why a modular monolith

See [ADR-005](adr/ADR-005-modular-monolith.md). Short version: one team, one deployable, one
transaction boundary for "publish chunk + index vector + write audit" — which is exactly the
invariant the Sharia gate depends on. Splitting into services would turn that invariant into a
distributed-transaction problem for no v1 benefit.

## 4. Runtime flows

### 4.1 Frontoffice — ask a question (happy path)

```mermaid
sequenceDiagram
    autonumber
    participant U as Customer (AR)
    participant FE as frontoffice-web
    participant GW as Gateway
    participant API as assistant-api
    participant GU as guardrails
    participant RAG as rag-core
    participant PG as Postgres/pgvector
    participant EMB as Google embeddings
    participant LLM as Groq (Llama 3.3 70B)

    U->>FE: «شنيا الفرق بين المرابحة والإجارة؟»
    FE->>GW: POST /api/v1/assistant/conversations/{id}/messages (SSE)
    GW->>API: JWT (optional for anonymous) + locale=ar-TN
    API->>GU: preFilter(text)
    GU->>LLM: prompt-guard-2-86m (injection) + llama-guard-4-12b (safety)
    LLM-->>GU: safe
    GU-->>API: PASS (+ normalised text)
    API->>RAG: answer(query, context)
    RAG->>RAG: detect language → ar; classify intent → PRODUCT_COMPARISON
    RAG->>RAG: normalise Derja→MSA, strip diacritics, expand glossary synonyms
    RAG->>EMB: embed(query, taskType=RETRIEVAL_QUERY, dim=1536)
    EMB-->>RAG: vector
    RAG->>PG: hybrid search — HNSW cosine + FTS tsquery + trigram, filtered by<br/>status=PUBLISHED AND sharia_approved AND audience IN (PUBLIC,AGENT)
    PG-->>RAG: 40 candidates with scores
    RAG->>LLM: listwise rerank (llama-3.1-8b-instant, JSON output)
    LLM-->>RAG: ordered top-8
    RAG->>RAG: assemble context ≤ token budget, dedupe, attach citation ids [S1..S8]
    RAG->>LLM: chat completion, stream=true, structured answer contract
    LLM-->>RAG: tokens…
    RAG->>GU: postFilter(answer, sources)
    GU->>GU: grounding check · Sharia policy classifier · numeric-claim validator · PII scan
    GU-->>RAG: PASS
    RAG-->>API: answer + citations + confidence + disclaimer
    API-->>FE: SSE events: token*, sources, done
    FE-->>U: RTL-rendered answer with clickable sources
    API->>PG: persist conversation, message, retrieval_trace, token_usage
```

**Latency budget** (P95): guard pre-filter 250 ms · embedding 200 ms · hybrid search 60 ms ·
rerank 400 ms · first token 700 ms · full answer 2.5 s → **< 3 s perceived**. Cached questions
(short-TTL semantic cache) skip embedding+retrieval and answer in < 800 ms.

### 4.2 Refusal / out-of-scope path

```mermaid
flowchart TD
    Q[Incoming message] --> PF{Pre-filter}
    PF -->|injection / abuse| B1[Refuse: template REF-01<br/>log guardrail_event]
    PF -->|prohibited topic<br/>alcohol, gambling, riba-based product| B2[Refuse: template REF-02<br/>explain the bank does not offer it]
    PF -->|religious ruling request<br/>«هل هذا حلال؟»| B3[No-fatwa response: template REF-03<br/>offer to open a request for the Sharia committee]
    PF -->|personal / account data request| B4[Scope refusal: template REF-04<br/>direct to authenticated channel]
    PF -->|pass| R[Retrieval]
    R --> SC{Best score ≥ τ_retrieve?}
    SC -->|no| B5[Honest ignorance: template REF-05<br/>no invented answer + suggest agent/handoff]
    SC -->|yes| GEN[Generate]
    GEN --> POST{Grounding & policy OK?}
    POST -->|no| B6[Suppress answer, retry once with stricter prompt,<br/>else REF-05 + flag for QA]
    POST -->|yes| OK[Answer with citations]
    B3 --> T[Create fatwa_request ticket]
    B6 --> Q2[Add to QA triage queue]
```

The refusal taxonomy (codes, trilingual templates, when each applies) is data in
`guardrail_policy` and editable in the backoffice — see [`09-backoffice-spec.md`](09-backoffice-spec.md) §6.

### 4.3 Backoffice — publish new knowledge (the "polish" loop)

```mermaid
sequenceDiagram
    autonumber
    participant ED as KB editor
    participant BO as backoffice-web
    participant API as admin-api
    participant KN as knowledge
    participant IN as ingestion
    participant GG as Google embeddings
    participant SO as Sharia officer
    participant AU as audit

    ED->>BO: upload product sheet (PDF, FR)
    BO->>API: POST /admin/documents (multipart)
    API->>KN: create document v1 (state=DRAFT)
    KN->>IN: enqueue ingestion_job
    IN->>IN: parse → clean → chunk (semantic, 400-700 tokens, 15% overlap)
    IN->>IN: normalise + light-stem (AR/FR) → tsv tokens
    IN->>GG: embed chunks (RETRIEVAL_DOCUMENT, title=heading)
    GG-->>IN: vectors
    IN->>GG: translate/align renderings AR + EN (LLM-assisted, human-verified)
    IN->>KN: persist chunks + translations + vectors (not retrievable yet)
    ED->>BO: submit for review
    BO->>API: POST /admin/reviews
    API->>SO: assign review_task (SLA 5 business days)
    SO->>BO: approve / request changes (per chunk possible)
    BO->>API: POST /admin/reviews/{id}/decision
    API->>KN: state → SHARIA_APPROVED → PUBLISHED
    API->>AU: audit_event (hash-chained, actor, before/after, decision reason)
    Note over KN: chunks become visible to retrieval atomically<br/>(single transaction: state + index flag)
    API-->>BO: run evaluation gate on affected intents
```

**Two-eyes rule**: the submitter can never be the approver (enforced in `governance`, not in the UI).

### 4.4 Prompt / model change (runtime upgrade, no deploy)

```mermaid
flowchart LR
    A[AI engineer edits prompt v(n+1)<br/>in Prompt Studio] --> B[Retrieval Lab:<br/>replay 20 sample queries<br/>diff answers & citations]
    B --> C[Save as DRAFT version]
    C --> D{Touches religious<br/>wording or policy?}
    D -->|yes| E[SHARIA_OFFICER approval]
    D -->|no| F[Second AI_ENGINEER / ADMIN approval]
    E --> G[Activate: canary 10% traffic]
    F --> G
    G --> H[Evaluation gate on golden set<br/>faithfulness · policy violation rate]
    H -->|green| I[Promote to 100%]
    H -->|red| J[Auto-rollback to v(n)<br/>incident recorded]
```

## 5. Backend layering (package convention)

```
tn.albaraka.ai.<module>
├── api            ← controllers, DTOs, mappers (inbound adapters)
├── application    ← use cases / services, transactions, ports
├── domain         ← entities, value objects, invariants (no Spring, no JPA)
└── infrastructure ← JPA repositories, LLM clients, caches (outbound adapters)
```

Rules enforced by ArchUnit:
* `domain` depends on nothing but the JDK and `jakarta.validation`.
* `api` never touches `infrastructure`.
* No module imports another module's `infrastructure` or `domain` — only its `api` interfaces
  (exposed as `tn.albaraka.ai.<module>.spi`).
* All outbound HTTP goes through `assistant-infra` clients (so egress logging, PII gate, retries,
  circuit breakers and cost accounting are in exactly one place).

## 6. Frontend architecture

Two Angular applications sharing two libraries:

```
apps/frontoffice-web   ← chat experience, widget entry point, public KB search
apps/backoffice-web    ← admin console (lazy-loaded feature routes)
libs/shared-ui         ← chat bubble, source card, locale switcher, RTL layout shell,
                          accessible data table, approval stepper
libs/shared-contracts  ← TypeScript types generated from specs/openapi.yaml (+ Api client)
```

* **Standalone components only**, signal-based state, `OnPush`/zoneless (Angular 22 default).
* **State**: signals + a thin store per feature; RxJS only for HTTP/SSE streams.
* **SSE**: `fetch` + `ReadableStream` (native `EventSource` cannot POST) wrapped in a
  `ChatStreamService` exposing a signal of partial tokens.
* **i18n**: runtime locale loading with `dir` switching through Angular CDK `BidiModule`
  (see [`06-i18n-trilingual-rtl.md`](06-i18n-trilingual-rtl.md)).
* **Auth**: `angular-auth-oidc-client`-style PKCE flow against Keycloak; frontoffice allows
  anonymous use with an ephemeral device id, backoffice requires authentication + MFA.
* **Design system**: Angular Material + Angular ARIA (stable in v22) with an Al Baraka theme
  (green/gold palette, Arabic-first typography).

## 7. Cross-cutting concerns

### 7.1 Configuration
`application.yaml` + profile overlays (`dev`, `test`, `uat`, `prod`). **Runtime** behaviour
(prompts, models, retrieval, policies) lives in the database, not in YAML — YAML only holds
infrastructure coordinates. Reference configs: [`specs/config/`](../specs/config).

### 7.2 Resilience
Every external call: timeout, retry with jitter (idempotent only), circuit breaker, bulkhead.
Degradation ladder for generation:

1. `llama-3.3-70b-versatile` (primary)
2. `openai/gpt-oss-120b` or `llama-3.1-8b-instant` (fallback on 429/5xx)
3. Cached answer for a semantically equivalent question (similarity ≥ 0.95, ≤ 24 h old)
4. Retrieval-only response: "here are the 3 most relevant approved sources" (no generation)
5. Static trilingual fallback: contact the bank / nearest branch

The ladder step used is recorded in `retrieval_trace` and surfaced in analytics — a spike in
step 4/5 is an alert.

### 7.3 Idempotency & concurrency
* Message POST carries `Idempotency-Key` (client-generated UUID) → duplicate submits are no-ops.
* Ingestion jobs use `SELECT … FOR UPDATE SKIP LOCKED` on the job table (no external broker in v1).
* Optimistic locking (`@Version`) on `document_version`, `prompt_version`, `retrieval_config`.

### 7.4 Egress data-protection gate (single choke point)
All outbound calls to Groq/Google pass `EgressGuard`:
1. PII detection (regex + NER for CIN, phone, RIB/IBAN, account numbers, email, address, name patterns).
2. Redaction with reversible tokens (`⟦PII_1⟧`) kept only in server memory for the request duration.
3. Payload size and content-class check (`PUBLIC` / `INTERNAL` only — never `CONFIDENTIAL`).
4. Full request/response logging **with the redacted payload** to `llm_call_log` for cost & audit.
5. Kill switch: a single config flag routes everything to the on-prem profile (§ ADR-002) or to
   the degradation ladder.

### 7.5 Internationalisation of the backend
Error messages, refusal templates and validation messages are keyed
(`error.retrieval.no_result`) and resolved from `message_bundle` rows (DB-driven, admin-editable)
with fallback to `messages_{fr,ar,en}.properties`. Never hard-code a language in a controller.

## 8. Environments

| Env | Purpose | Data | Models |
|---|---|---|---|
| `local` | Developer machine, docker-compose | Synthetic KB | Groq/Google with personal keys, or `mock` profile |
| `dev` | Integration | Anonymised KB | Same as prod, separate keys, low budget |
| `uat` | Sharia committee + business acceptance | **Real** approved KB copy | Prod models, prod-like limits |
| `prod` | Live | Real | Prod |

`uat` holds a **byte-identical copy of the approved knowledge base** so the Sharia committee
reviews what customers will actually see. Promotion dev→uat→prod carries the KB delta, the prompt
version and the model config together as a **release bundle** (see [`12-deployment-observability.md`](12-deployment-observability.md) §6).

## 9. Verification strategy

| Layer | Tooling | Gate |
|---|---|---|
| Domain unit | JUnit 5, AssertJ | ≥ 80 % line coverage on `domain` + `application` |
| Architecture | ArchUnit | module dependency rules; build fails on violation |
| Integration | Testcontainers (Postgres+pgvector, Redis) | every PR |
| Contract | OpenAPI diff (`oasdiff`) | breaking change ⇒ major version bump required |
| LLM adapters | WireMock-recorded fixtures | tests never call paid APIs |
| RAG quality | Eval harness on golden set | faithfulness ≥ 0.85, policy-violation ≤ 1 % |
| Frontend | Vitest + Angular Testing Library, Playwright e2e | a11y (axe) + RTL snapshot tests |
| Security | OWASP dependency-check, Trivy, ZAP baseline | no HIGH unpatched |

## 10. Non-functional targets

| Attribute | Target |
|---|---|
| Availability | 99.5 % during banking hours (07:30–18:00 TZ), 99.0 % off-hours |
| Latency | P95 first token < 1.2 s; full answer < 3 s; admin screens < 400 ms |
| Throughput | 50 concurrent conversations; 200 msg/min peak; ingestion 5 000 chunks/h |
| Retention | Conversations 24 months (anonymisable); audit 10 years; originals indefinite |
| Data classification | `PUBLIC` / `INTERNAL` / `CONFIDENTIAL` / `RESTRICTED` on every document; only the first two may reach a model provider |
| Accessibility | WCAG 2.2 AA, full RTL, screen-reader labelled citations |
| Localisation | FR, AR (ar-TN), EN; adding a 4th language = data, not code |
