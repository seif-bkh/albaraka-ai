# `specs/i18n/` — language and dialect handling

Two machine-readable specs that the backend loads at startup. Everything here is a **decision record
with executable consequences**: each file is checked by `tools/i18n-lint` against `specs/db/schema.sql`,
`docs/03` §8, `docs/06` §7 and `specs/config/application.yaml`, so a spec that drifts from the schema or
from the prose fails the build.

| File | What it is | Consumed by |
|---|---|---|
| `normalization.json` | The eight-stage normalisation pipeline, the PostgreSQL FTS parser mapping, and the number/currency/date formats | `TextNormalizer`, the Flyway migration that creates `albaraka_fts`, the answer formatter |
| `derja-msa.json` | The Tunisian Derja → MSA seed map for `derja_msa_map` | Flyway `V903`, the glossary admin screen, the dialect stage |

## The rules that are easy to get wrong

**Normalisation feeds retrieval only.** It writes `chunk.normalized_text` and `chunk.tsv`. It never
touches `document_version.body_text`, `answer_markdown`, `citation.text` or any `display_*` column. A
Sharia-reviewed sentence is quoted exactly as approved; if the folder rewrote it, the quote would no
longer match the source of record. `document_version` deliberately has **no** normalised column —
storing a second, rewritable copy of approved content would create two sources of truth.

**Index and query use the same stages, in the same order.** `stageOrder` is not documentation; the
runtime reads it. If query-time normalisation drifted from index-time, Arabic retrieval would degrade
silently and present as "the model is weak", not as a bug.

**Two orderings are load-bearing:**

1. `fold` → `dialect_map` → `stem`. Running the dialect map after the stemmer makes keys unreachable
   and can collide with a *different* key: `معلومات` stems to `معلوم` (itself an entry meaning "fee"),
   and `الجاب` stems to `جاب` ("he brought"). Nothing errors — the mapping just stops happening.
2. `arabizi_transliterate` → `language_detect`. Transliteration is how `9addéch` becomes Arabic text,
   which is how the detector recognises it as Arabic at all.

**Derja is input-only.** Users may write Derja or arabizi; answers are always MSA. Religious content
is never mapped to Derja in either direction, because a fatwa must read as MSA.

**The map is gated on detection**, not applied to every Arabic query: several Derja forms are also
valid MSA words with a different meaning (`نعمل`/`تعمل`/`عملت` = do/make in Derja, work in MSA).
Entries that are valid MSA with a conflicting sense are pruned outright rather than gated — see
`prunedEntries`, which records each removal with a reason so nobody re-adds it.

**`confidence` means different things depending on the row.** For a plain entry it is the probability
the mapping is correct wherever the form appears. For an entry with `contextRequired` it is
conditional on `contextWhen` holding — which is why such an entry may carry 0.90 but never 1.00.

## Contents at a glance

`normalization.json`
- 8 stages, each with `$comment` explaining *why* (including the three folds and the five suffixes that
  go beyond docs/03 §8's minimum list, and the reason `ى` is deliberately **not** folded to `ي`)
- `postgresTextSearch` — mirrors `schema.sql` exactly: 19 of 23 parser token types mapped, 4 excluded
  with reasons, `utf8` required, `uint`/`version` mapped because the corpus is full of legal years
- `knownDocumentDivergences` — three places where `docs/03` §8 disagrees with the validated schema,
  each naming the source of truth (`schema.sql`)
- `knownLimitation` — hyphens split: `loi n° 2016-48` indexes as `2016` and `48`, and `-48` cannot be
  quoted (proved by test G4e)
- `formatting` — TND at three decimals, dates, times, numbers

`derja-msa.json`
- `mappings` (366) — seeded into `derja_msa_map`, above the ~350 target in docs/06 §7; each row carries
  the table's columns plus declared metadata (`category`, `contextRequired`/`contextWhen`, `note`)
- `sharedVocabulary` (289) — identical in Derja and MSA, so nothing to map; kept out of the seed table
  and out of the mining queue (a suggestion like "نظام = نظام" would waste a reviewer's attention)
- 11 homographs gated on context, each with the predicate that decides them (`وقف` = stop or waqf?,
  `حوش` = house or courtyard?, `عالجاري` = current or running account?)
- `prunedEntries` — six rows covering the 11 entries removed, each with a written reason: 6
  fold-redundant, 2 fold-colliding, 3 chained or MSA-colliding

## Known divergences from the prose

`docs/03` §8 was written before the schema was validated. Where they disagree, `schema.sql` wins and
`normalization.json.knownDocumentDivergences` records the disagreement. The three are: the FTS config
now maps numeric token types (`uint` was omitted, which dropped every integer — amounts, dates, article
numbers); `arabic_word` is not a real parser token type (Arabic arrives as `word`, provided the
database is UTF8); and the stem affix lists are supersets of the documented minimum.

`docs/06` §7's example `دار/منزل → عقار` maps the property sense; the seed maps the everyday sense
(`دار → منزل`) and leaves property to the glossary, because a blind `دار → عقار` would rewrite every
question about home. The entry carries a note and the linter warns so the difference stays visible.

## Verifying

```bash
node tools/i18n-lint/lint.mjs        # 24 groups · 0 errors · 5 advisory warnings
node tools/i18n-lint/self-test.mjs   # 77 mutations, each must trip exactly one check
```

The warnings that remain are intentional: four single-character pairs the linter asks a human to
confirm are dialect pairs rather than misspellings (`وين/أين`, `اثنين/اثنان`, `عشرين/عشرون`, `اللي/الذي`),
and the `دار` divergence above. The self-test mutates the authority documents too — raising the seed
target in `docs/06`, dropping `uint` from `schema.sql`, changing decimals in `specs/config` — which is
the evidence that expectations are derived rather than copied.

## Extending

New mappings are added by administrators at runtime (`source = ADMIN`) and by the mining queue
(`source = MINED`), not by editing this file; `V903` seeds it once. This file is the **seed of record**:
edit it only to correct a seed defect, and run the linter afterwards. A mapping is rejected by the
linter if it duplicates a fold, collides with another key once folded, chains into another mapping, or
rewrites a word that is valid MSA with a different meaning.
