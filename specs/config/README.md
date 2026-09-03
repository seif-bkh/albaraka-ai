# `specs/config/` — application configuration

Four files, one rule.

```
application.yaml         shared base: wiring + first-boot seeds
application-dev.yaml     local / shared development (docker-compose)
application-uat.yaml     pre-production, prod-shaped
application-prod.yaml    production
```

```bash
cd tools/config-lint && npm run verify    # lint the four files, then prove the linter can fail
```

## What belongs here, and what does not

**Here**: anything that describes *where the application runs* — datasource and pool, Flyway, Redis,
the Keycloak issuer, provider endpoints and timeouts, object storage, egress policy, rate limits,
worker concurrency, retention schedules, log levels, tracing.

**Not here**: anything an administrator may change while the system is live. Prompts, retrieval
parameters, model routing, guardrail thresholds, microcopy and feature flags all live in the database
— `prompt_version`, `retrieval_config`, `model_config`, `guardrail_policy`, `message_bundle`,
`assistant_config` — and are read from there on every request, behind the two-eyes review and the
evaluation gate of docs/05 §5 and docs/09.

That is the whole point of the requirement that the assistant be upgradeable without a release. A
retrieval weight in `application-prod.yaml` can only be changed by a deployment, which means it can
only be changed by an engineer, which means the AI engineer tuning recall against the golden set has
to file a ticket. It also means the value has two homes the moment someone seeds it into the
database, and which one wins depends on the environment and the deploy order.

### The seed block

`albaraka.seed` is the exception, and a narrow one. It is consumed **once**, on an empty database, by
`SeedOnEmptyDatabaseRunner`, to create the first `DRAFT` rows of `model_config` and
`retrieval_config`. It is never read at request time and it can never override an `ACTIVE` row:

```
first boot ──► seed rows created as DRAFT ──► review ──► ACTIVE ──► runtime reads the database
                        ▲
                        └── YAML is never consulted again
```

`SEED_MODE=NEVER` disables even that. Because the seed is the one place a tunable legitimately
appears in YAML, `tools/config-lint` holds it to two constraints: every value must be inside the
range documented in `docs/04` §18, and every seeded retrieval value must equal the column `DEFAULT`
in `specs/db/schema.sql`. A seed that drifts from the schema produces a database whose idea of
"default" differs from the code that seeded it.

## Environment posture

| | dev | uat | prod |
|---|---|---|---|
| Providers | Groq + Google, or `MOCK` fixtures | real providers, synthetic content | real providers |
| Sharia judge autonomy | on | **off** — every `BLOCK` goes to the human queue | off until κ ≥ 0.70 against officer labels |
| Log content redaction | off (developers need the text) | **on** | **on** |
| Trace sampling | off (no collector) | 1.0 | 0.05 |
| Kill-switch second approver | waived | required | required |
| Anonymous rate limit | 60/min | 8/min | 8/min |
| Object lock | off (MinIO single-node) | `COMPLIANCE` | `COMPLIANCE` |
| Daily provider budget | $5 | $25 | $60 |

UAT is deliberately prod-shaped rather than dev-shaped. It differs from production in exactly three
ways — synthetic data, full trace sampling, a lower traffic ceiling — so that a behaviour which
appears only in UAT or only in prod is recognisable as a defect in one of them.

Two controls stay **on** in dev even though they cost latency and money: `EgressGuard` and the full
guardrail stack. A control that only runs in production is a control nobody has ever exercised, and
the first time it meets real traffic is the worst possible time to discover how it fails.

## Fail-closed by construction

Production overrides as little as possible, and where it does, the direction is always the same:

* `egress.pii.fail-closed: true` — a PII detection error blocks the provider call. It never lets the
  call through on the assumption that nothing sensitive was found.
* `guardrails.output.sharia-judge.on-unavailable: REFUSE` — if the judge cannot answer within its
  300 ms retry budget, the customer receives `REF-05` (technical). An unverified answer is never
  delivered, whatever the cost in availability.
* `feature-flags.unknown-flag-default: false` — an unrecognised flag is off, not on.
* `egress.deny-by-default: true` with an explicit two-host allowlist — a new provider is a
  configuration change that someone must approve, not a DNS record.
* `egress.budget.hard-stop: true` — exceeding the daily budget degrades answers to `REF-05` rather
  than overspending.
* `storage.object-lock.mode: COMPLIANCE` — not `GOVERNANCE`, which a privileged user can lift. The
  uploaded originals are the evidence base for Sharia review; they cannot be quietly replaced.
* `flyway.clean-disabled: true`, `out-of-order: false`, classpath-only locations — the migration
  history is immutable, so the checksum set in a release bundle means what it says.

## Secrets

No credential appears as a literal in any file, and `config-lint` fails the build if one does
(`X01`), if a key-shaped string appears anywhere (`X03`), or if a credential in uat/prod carries a
fallback default (`X02`) — `${DATABASE_PASSWORD:changeme}` is a password in git with extra steps.
Production must fail to start when a secret is missing.

Resolution is `${ENV_VAR}`, injected by the platform from Vault (docs/12 §6). The variables are:

| Variable | Used for |
|---|---|
| `DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD` | PostgreSQL + pgvector |
| `KEYCLOAK_URL` | issuer and JWKS of the `albaraka` realm |
| `GROQ_API_KEY`, `GROQ_BASE_URL` | generation, reranking and both guard models |
| `GOOGLE_API_KEY` | `gemini-embedding-001` |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | semantic cache, rate limits, locks |
| `STORAGE_*` | S3/MinIO endpoint, buckets, credentials |
| `ALBARAKA_ENV`, `ALBARAKA_DAILY_BUDGET_USD` | environment label, egress budget |
| `WORKER_ENABLED` | `true` only on the worker deployment (same image, `prod,worker`) |
| `ONPREM_ENABLED`, `ONPREM_LLM_URL`, `ONPREM_EMBEDDING_URL` | the ADR-002 exit ramp |
| `SHARIA_JUDGE_AUTONOMY` | flipped by change request once κ ≥ 0.70 |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SAMPLE_RATE` | collector and sampling |
| `SEED_MODE` | `IF_EMPTY` (default) or `NEVER` |

## Model routing

Seven named roles, each an independent bean with its own timeout, retry, circuit breaker and budget
(ADR-002). Routing is data, so a provider outage or a residency decision is a `model_config`
activation rather than a code change:

| Role | Model | Timeout | Temperature | Notes |
|---|---|---|---|---|
| `CHAT_PRIMARY` | `llama-3.3-70b-versatile` | 30 s | 0.20 | falls back to `CHAT_FALLBACK` |
| `CHAT_FAST` | `llama-3.1-8b-instant` | 4 s | 0.00 | intent, rewrite, contract |
| `CHAT_FALLBACK` | `openai/gpt-oss-120b` | 30 s | 0.20 | degradation, not failure |
| `RERANKER` | `llama-3.1-8b-instant` | 1.2 s | 0.00 | listwise, docs/04 §7 |
| `GUARD_SAFETY` | `meta-llama/llama-guard-4-12b` | 1.5 s | 0.00 | separate connection pool |
| `GUARD_INJECTION` | `meta-llama/llama-prompt-guard-2-86m` | 0.8 s | 0.00 | separate connection pool |
| `EMBEDDING` | `gemini-embedding-001` | 10 s | — | 1536 dims, `RETRIEVAL_DOCUMENT` |

The guard models get their own pool on purpose: a saturated guard path must neither be caused by nor
cause saturation of the answering path. Classification, reranking and guard decisions are pinned at
temperature 0 so that a replayed request reproduces the decision it originally produced — an
audit trail that cannot be reproduced is not evidence.

Groq serves no embeddings endpoint, so `spring.ai.openai.embedding.enabled` is `false` and
`config-lint` fails if it is ever switched on (`C10`).

## Related

* `tools/config-lint` — the checks, and the mutation self-test that proves they can fire
* `docs/04-rag-pipeline.md` §18 — the authoritative tunable sheet
* `docs/07-security-iam-compliance.md` §5 — egress, PII and classification policy
* `docs/12-deployment-observability.md` — Vault, topology and the release bundle
* `specs/db/schema.sql` — the column defaults the seed must match
* `specs/db/seed/` — the V900–V903 content migrations (glossary, prompts, policies, dialect map), generated by `tools/seed-gen`
