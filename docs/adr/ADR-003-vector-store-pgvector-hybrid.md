# ADR-003 — PostgreSQL + pgvector with hybrid retrieval and LLM reranking

**Status**: Accepted · **Date**: 2026-09-03 · **Reversibility**: soft for the reranker and retrieval
parameters; hard for the vector store (data migration)

## Context

The owner left the vector-store choice to us. Requirements:

* A knowledge base of 10⁴–10⁶ chunks, trilingual, with **metadata filtering** on governance state
  (`searchable`), audience, classification, product codes, language and temporal validity.
* **Exact-term matching** matters as much as semantics: product names (*Mourabaha*, *مرابحة*),
  standard numbers (AAOIFI n° 8), legal references (loi 2016-48 art. 54), tariff line items.
* **Typo and transliteration tolerance** (`mourabhah`, `مرابحه`, arabizi).
* Bank-grade operations: backups, PITR, access control, auditability, a technology the DBA team can
  defend to the regulator.
* Retrieval must be *explainable* to administrators — the backoffice Retrieval Lab has to show why a
  chunk was or was not selected.

## Decision

1. **PostgreSQL 17 + pgvector 0.8.1** as the single store for relational data, vectors, full-text
   search and the audit trail. No separate vector database in v1.
2. **`halfvec(1536)`** column with an **HNSW** index (`m=16`, `ef_construction=128`,
   `halfvec_cosine_ops`), and `SET hnsw.iterative_scan = relaxed_order` per session so that
   **filtered** ANN queries still return k results (pgvector 0.8's iterative index scans). Without
   this, a query filtered by `searchable AND audience AND lang` returns far fewer candidates than
   requested — a silent, hard-to-diagnose recall bug.
3. **Three-way hybrid retrieval** in one SQL statement: dense (HNSW cosine), keyword
   (`tsvector`/`tsquery` over an app-normalised `albaraka_fts` configuration), and trigram
   (`pg_trgm` similarity) for typo tolerance.
4. **Reciprocal Rank Fusion** (k = 60) with per-strategy weights (dense 1.0 / FTS 0.85 / trigram 0.45)
   as defaults, all runtime-tunable.
5. **Deduplication by `source_chunk_id`** so translations of one logical chunk collapse into a single
   source, keeping the `answer_lang` rendering when available.
6. **Reranking**: v1 uses an LLM listwise reranker on `llama-3.1-8b-instant` returning structured
   JSON with a `reason_code` per passage (cheap, ~300 ms, and it doubles as an off-topic detector).
   A `Reranker` port exists from day 1; v2 may swap in an on-premises cross-encoder
   (`bge-reranker-v2-m3`, strong on Arabic + French) served via ONNX in-JVM or a sidecar — zero data
   egress, lower marginal cost.
7. **Arabic/French analysis in the application, not in exotic extensions**: normalisation,
   diacritic/tatweel stripping, alef folding, light stemming and Derja→MSA mapping happen in
   `assistant-knowledge` before `to_tsvector('albaraka_fts', …)`. Stock Postgres has no Arabic
   stemmer, and depending on a rarely maintained extension in a bank is not acceptable.
8. **Partitioning** of high-volume tables (`message`, `retrieval_candidate`, `guardrail_event`,
   `llm_call_log`, `audit_event`) by month, with an archival job.

## Alternatives considered

| Option | Why not chosen (for v1) |
|---|---|
| **Qdrant** | Excellent payload filtering and scale, but a second stateful system to secure, back up, monitor and defend to the regulator; hybrid sparse search is younger than Postgres FTS |
| **Elasticsearch / OpenSearch** | Best-in-class BM25 and Arabic analysis plugins, but heavy to operate, and licensing/ops cost is hard to justify at 10⁵ chunks |
| **Milvus / Weaviate / Pinecone** | Scale we don't have; Pinecone adds a third cross-border SaaS dependency |
| **Pure dense retrieval** | Fails on exact terms, references and numbers — precisely the highest-risk answers (tariffs) |
| **Pure BM25** | Fails on paraphrase and cross-lingual queries (Arabic question → French document) |
| **pgvector without iterative scans** | Filtered recall collapse; rejected on correctness grounds |
| **Cross-encoder reranking from day 1** | Adds a Python/ONNX runtime to the stack before the value is proven; kept as the v2 upgrade behind the same port |

## Consequences

**Positive**: one database to operate, back up, secure and audit; transactional consistency between
the governance gate (`searchable`) and the vectors — a chunk cannot become retrievable without its
vector and its audit row in the same commit; explainable retrieval (three score columns per
candidate); hybrid recall that handles Arabic morphology and transliteration variance; minimal
operational surface for a bank team.

**Negative / risks and mitigations**:

| Risk | Mitigation |
|---|---|
| Postgres HNSW build time at > 1 M chunks | Parallel build, `ef_construction` tuning, build during a maintenance window, blue-green index |
| Index bloat from churn | Nightly `ANALYZE`, quarterly `REINDEX CONCURRENTLY`, tuned autovacuum on `chunk_embedding` |
| No native Arabic stemmer | Application-side light stemmer with a 200-case unit-test suite; the golden set measures the effect |
| Single-store concentration risk | Streaming replica, PITR (RPO 5 min), quarterly restore drills; the `VectorStore` port allows extraction |
| Scale ceiling | Documented exit path: Qdrant or ES behind the same port, with `retrieval_candidate` traces preserved for parity testing |

**Follow-ups**: benchmark hybrid vs dense-only on the golden set in Phase 2 and publish the delta in
the scorecard; decide the v2 cross-encoder based on measured cost/latency at real volume.
