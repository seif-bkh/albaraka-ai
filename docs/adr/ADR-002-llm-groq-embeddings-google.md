# ADR-002 — LLM on Groq, embeddings on Google, behind a pluggable provider layer

**Status**: Accepted · **Date**: 2026-09-03 · **Reversibility**: soft (provider swap by configuration);
hard for the embedding dimension (requires a full re-index)

## Context

The project owner specified **Groq for generation** and **Google for embeddings**. Both are
US-hosted SaaS. A Tunisian bank must additionally consider:

* Groq exposes an **OpenAI-compatible** endpoint but offers **no embeddings API** — hence the split.
* Groq hosts models that are directly useful for governance: `meta-llama/llama-guard-4-12b`
  (content safety) and `meta-llama/llama-prompt-guard-2-86m` (injection detection), plus
  `whisper-large-v3-turbo` for a future voice channel.
* Groq is extremely fast (LPU inference) — which matters because our pipeline makes 4–6 model calls
  per answer (intent, guards, rerank, generation, judge).
* Groq's free/low tiers are tightly limited (≈1 000 requests/day on `llama-3.3-70b-versatile`), so
  production requires a paid commitment.
* Google's `gemini-embedding-001` supports 100+ languages including Arabic and French, is
  Matryoshka-scalable (3072 → 1536 → 768 dims) and priced ≈ $0.15 / 1 M tokens. Input limit
  2 048 tokens, and asymmetric `taskType` (`RETRIEVAL_QUERY` vs `RETRIEVAL_DOCUMENT`) materially
  affects retrieval quality.
* Cross-border transfer of personal data is constrained (Loi organique 2004-63 / INPDP), and the BCT
  outsourcing provisions apply ⚠ *exact circular to confirm with Compliance*.

## Decision

1. **Generation** via Groq's OpenAI-compatible endpoint (`https://api.groq.com/openai/v1`), consumed
   through Spring AI's OpenAI model starter with a `GroqChatOptionsSanitizer` that strips parameters
   Groq rejects or ignores (no multimodal, no `n>1`, no `logprobs`).
2. **Named model roles**, each an independent bean with its own timeout, retry, circuit breaker and
   budget: `CHAT_PRIMARY` = `llama-3.3-70b-versatile`, `CHAT_FAST` = `llama-3.1-8b-instant`
   (intent, rewrite, rerank, judge), `GUARD_SAFETY` = `meta-llama/llama-guard-4-12b`,
   `GUARD_INJECTION` = `meta-llama/llama-prompt-guard-2-86m`, `CHAT_FALLBACK` =
   `openai/gpt-oss-120b`.
3. **Embeddings** via Google GenAI `gemini-embedding-001`, `outputDimensionality = 1536`,
   `taskType = RETRIEVAL_DOCUMENT` (+ `title` = heading path) at index time and
   `RETRIEVAL_QUERY` at query time, batched ≤ 100 texts.
4. **Everything behind interfaces**: `ChatProvider`, `EmbeddingProvider`, `ModerationProvider`,
   `Reranker`. Spring AI's abstractions are used where they fit; where they don't (Groq option
   quirks, task types, batch semantics) we wrap them. No module outside `assistant-infra` may perform
   an outbound HTTP call.
5. **An `ONPREM` profile** implementing the same interfaces with vLLM/Ollama (generation) and a local
   multilingual embedding model (e.g. `bge-m3`), kept compilable and integration-tested from Phase 2
   even though it is not the production default. This is the exit ramp for data-residency concerns and
   the fallback in a provider outage.
6. **A single egress choke point** (`EgressGuard`) enforcing classification, PII redaction, budget and
   logging for every provider call.
7. **1536 dimensions** as the default: ~50 % storage and index cost versus 3072 with negligible recall
   difference for a KB of this size; `embedding_model` and `embedding_dim` are stored per chunk so any
   change is a governed blue-green re-index (doc 03 §9).

## Alternatives considered

| Option | Why not chosen |
|---|---|
| OpenAI / Azure OpenAI for generation | Owner's decision was Groq; Azure remains a credible later profile (same OpenAI-compatible adapter) |
| Groq for everything | No embeddings API |
| A single provider for embeddings + generation (e.g. Gemini for both) | Loses Groq's latency and its on-platform moderation models, which are a genuine governance advantage |
| On-prem from day 1 | GPU procurement and model-ops effort would dominate Phase 1–2; kept as a ready profile instead |
| `text-multilingual-embedding-002` (768 dims) | Cheaper but superseded by `gemini-embedding-001`, which unifies and outperforms it |
| 3072 dimensions | Storage/index cost and slower ANN with no measured benefit at our scale |

## Consequences

**Positive**: fastest available inference for a multi-call pipeline; moderation models co-located with
generation (one vendor, one budget, one egress path); strong multilingual embeddings including Arabic;
a clean interface means a provider change is configuration plus a re-index, not a rewrite.

**Negative / risks and mitigations**:

| Risk | Mitigation |
|---|---|
| Cross-border data transfer | v1 carries no personal data; PII redaction before egress; classification hard-block; DPAs; `ONPREM` exit ramp |
| Groq rate limits / outage | Paid tier, per-role budgets, semantic cache, degradation ladder (doc 01 §7.2), circuit breakers |
| Groq–OpenAI incompatibilities | Option sanitiser + contract tests against recorded fixtures |
| Embedding model change forces re-index | Blue-green re-index procedure, per-chunk model/dim provenance |
| Vendor lock-in | Provider interfaces + the `ONPREM` profile kept green in CI |
| Cost growth | Budget guard with automatic degradation at 80 % / 100 %, cost per answer tracked and alerted |

**Follow-ups**: negotiate DPAs and a "no training on customer data" clause; obtain paid-tier quotas
before Phase 2 load testing; have Compliance rule on the residency question in writing (doc 00 §9.1).
