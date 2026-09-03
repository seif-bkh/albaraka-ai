# ADR-007 — One multilingual embedding space plus per-chunk renderings and Derja normalisation

**Status**: Accepted · **Date**: 2026-09-03 · **Reversibility**: hard (changes the index and the
content strategy)

## Context

Tunisian banking reality is not "three monolingual corpora":

* Most authoritative bank documentation is written in **French**.
* Customers ask in **Arabic** — MSA, Tunisian Derja, or Derja written in Latin script (arabizi:
  `chnowa`, `bch`, `9addéch`).
* Religious vocabulary is **Arabic** even inside French sentences («la Mourabaha (المرابحة)»).
* Corporate/expat users ask in **English**.
* Mixed-language messages are the norm, not the exception.

So the highest-value retrieval path is **cross-lingual**: an Arabic question must find a
French-authored product sheet, and the answer must be produced in Arabic.

## Decision

1. **A single multilingual embedding space** — `gemini-embedding-001` (100+ languages, Arabic and
   French evaluated) at 1536 dimensions — indexes all content regardless of language. Cross-lingual
   similarity is therefore native, not a translation step.
2. **Per-chunk renderings**: each logical chunk may exist in up to three aligned renderings
   (`chunk_translation`, linked by `source_chunk_id`). Renderings are deduplicated at fusion time so
   the customer sees **one** source, in their language where a rendering exists.
3. **Answer language = question language**, decided per message and independent of the source language.
   A French UI with an Arabic question gets an Arabic answer.
4. **Query-side normalisation** (never applied to display text): Arabic diacritic/tatweel stripping,
   alef/teh-marbuta/alef-maksura folding, light stemming, French `unaccent`, and a
   **Derja → MSA mapping** including arabizi transliteration, all before embedding and FTS.
5. **Glossary-driven query expansion only**: synonyms come from `term_glossary`, never from free-form
   LLM generation. An LLM inventing a synonym for a religious term is a governance incident, not a
   retrieval trick.
6. **Cross-lingual expansion as a fallback**: FR/AR/EN query variants are issued only when the first
   pass returns fewer than `cross_lingual_fallback_min_hits` (default 3) candidates above τ — keeping
   cost down while protecting recall on hard queries.
7. **Machine translation is never published unverified** for Sharia content, product descriptions or
   anything tier T3; for T1 content, MT + automated glossary check + 10 % sampling audit is allowed.
   Reviewers see source and rendering side by side in a bidi-aware diff.
8. **Frontend and backend share one normalisation implementation**, generated from
   `specs/i18n/normalization.json` and tested with identical fixtures in both stacks, so the UI's
   "what the model sees" preview matches reality.

## Alternatives considered

| Option | Why not |
|---|---|
| Three monolingual indexes (fr/ar/en) + a translation step at query time | Adds a translation call to the critical path (latency, cost, a new failure mode), and translation errors become retrieval errors |
| Translate every document into all three languages and index only translations | Enormous review burden on the Sharia committee; loses the authoritative source text; a mistranslation becomes the *only* version |
| Index only the source language and answer cross-lingually | Works for dense retrieval but destroys exact-term FTS matching in the user's language |
| Rely on the LLM to translate at generation time | Unverifiable terminology, no governance, and it can silently alter a religious term |
| Ignore Derja | Would miss a large share of real customer input; the golden set includes a dedicated Derja slice |

## Consequences

**Positive**: cross-lingual recall without a translation hop; one index to operate; sources stay
authoritative in their original language while customers read their own; terminology controlled by the
committee through the glossary; Derja and arabizi handled deterministically and extensibly by
administrators; answer-language correctness is a measured metric, not a hope.

**Negative / risks and mitigations**:

| Risk | Mitigation |
|---|---|
| Rendering coverage is uneven (most content FR-only initially) | Cross-lingual dense retrieval still works; the coverage dashboard ranks documents lacking AR/EN renderings; translation is a prioritised KB task |
| Light stemming over- or under-stems Arabic | 200-case unit suite + golden-set slices; stemming parameters are per-collection tunable |
| Derja map never complete | The backoffice proposes new mappings from real mis-retrieved queries; growth is measured |
| Machine-translated religious content reaching customers | Hard rule: T3 content requires human verification; the `is_translation` + `machine` flags make it queryable and auditable |
| Multilingual embedding model change | Blue-green re-index (doc 03 §9); per-chunk model/dim provenance |
| Language detection errors on short mixed inputs | Script-based heuristic first, LLM fallback, and `WRONG_LANGUAGE` feedback as a monitored metric |

**Follow-ups**: measure cross-lingual vs monolingual recall on the golden set in Phase 2 and report the
delta; decide whether EN renderings are needed for all products or only corporate ones.
