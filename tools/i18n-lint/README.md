# `tools/i18n-lint`

Executable checks over `specs/i18n/`. Run before every commit that touches normalisation or the dialect
map, and in CI on every pull request.

```bash
npm run lint      # check specs/i18n        → exit 1 on any ERROR
npm run verify    # lint, then prove the linter can fail (77-mutation self-test)
```

Node ≥ 20. **No dependencies** — it parses the four authority files with targeted readers rather than
pulling in a YAML or SQL parser, because it only ever needs column lists, affix lists, DDL statements
and two scalar values.

## Why this exists

Normalisation and dialect mapping fail in the way that is hardest to notice: nothing throws, nothing
appears in a log, and retrieval quietly gets worse until someone concludes the model is weak. Three
defects in this repository's own history are the reason the linter exists in this shape.

The first was `arabic_word` in `docs/03` §8 — a PostgreSQL parser token type that does not exist, so the
documented DDL raised `ERROR: unrecognized token type` the first time anyone ran it. The second was the
`uint` omission in `albaraka_fts`: a token type with no mapping is *dropped*, which silently removed
every plain integer from the index — `150`, `1500`, `2016`, `2021`. Amounts and legal years stopped
being searchable, and the symptom looked like bad embeddings. The third was the dialect map running
after the stemmer, which made `معلومات` unreachable and rewrote it as `معلوم` — an entry meaning "fee".

All three were invisible in review and provable in five minutes. So the linter's expectations are
**derived, not copied**:

| Expectation | Derived from |
|---|---|
| the FTS token types, their dictionaries, and which are excluded | the `CREATE TEXT SEARCH CONFIGURATION albaraka_fts` DDL in `specs/db/schema.sql` |
| the columns every mapping row must carry | the `derja_msa_map` column list and its `NOT NULL`s |
| which `appliesTo` fields are legal | column names parsed out of `schema.sql` |
| the Unicode strips, the folds, the stem affixes | `docs/03` §8's pipeline table and affix lists |
| the coverage target | the "~350 seed mappings" figure in `docs/06` §7 |
| the dialect examples that must exist | `docs/06` §7's example table |
| the arabizi digits that must be transliterated | the transliteration table in `normalization.json` itself |
| currency decimals and the supported locales | `specs/config/application.yaml` |

Change the document, the schema or the config and the linter's demands change with it. The self-test
mutates copies of all four authorities to prove that is true rather than merely intended — raising the
seed target in `docs/06`, dropping `uint` from `schema.sql`, changing decimals in `application.yaml`.

## What it checks

**N — `normalization.json`**

| Check | Rule |
|---|---|
| N01 | the file is valid JSON with the required top-level keys |
| N02 | `stageOrder` and `stages` name the same set; neither has an orphan |
| N03 | `arabizi_transliterate` precedes `language_detect` — transliteration is *how* `9addéch` is recognised as Arabic |
| N04 | the documented strips exist: tashkīl U+064B–U+0652, tatweel U+0640, NFKC, and lowercasing for `fr_en` |
| N05 | every fold documented in `docs/03` §8 is present with the documented target; any additional fold must be justified in the stage's own `$comment`, where a reader will see it |
| N06 | stem affixes match `docs/03` §8 **as sets** (the document listed `ات` twice, and stemming is not a sequence), one strip per side, `minRootLength` ≥ 3 |
| N07 | the text-search block mirrors `schema.sql` exactly, and every one of the 23 parser token types is either mapped or excluded with a written reason; `arabicStemmingInDatabase` must stay false |
| N08 | `utf8` is required — the encoding is what keeps Arabic out of the `blank` token class |
| N09 | every `appliesTo` field names a `table.column` that exists in `schema.sql` |
| N10 | display text is never modified: the flag is true and the exclusion list still names the answer, citation and display columns |
| N11 | TND, three decimals, western digits |
| N12 | the date, time and number formats agree with the locale table |
| N13 | `fold` → `dialect_map` → `stem`, the only order in which the map is both reachable and unambiguous |

**D — `derja-msa.json`**

| Check | Rule |
|---|---|
| D01 | valid JSON, both lists present, policy present |
| D02 | each row carries exactly the `derja_msa_map` columns plus declared metadata; `NOT NULL` columns are never absent |
| D03 | `derja_ar` is unique across **both** lists — the table has one `UNIQUE(derja_ar)`, so a duplicate is dropped at insert time without an error if the seed uses `ON CONFLICT DO NOTHING` |
| D04 | no identity rows in `mappings`; identical Derja and MSA forms belong in `sharedVocabulary` |
| D05 | sources and targets are Arabic script; `derjaLatin` is Latin script (ASCII plus Latin-1, because Tunisian arabizi is typed on a French keyboard and `é` is legitimate) |
| D06 | `confidence` in (0,1]; seeded rows are `SEED`/`ACTIVE` only |
| D07 | any confidence below 0.80 carries a written reason |
| D08 | `contextRequired` implies a `contextWhen` predicate, and confidence below 1.00 — a mapping that needs context cannot also claim certainty |
| D09 | mapping count meets the target derived from `docs/06` §7, and the declared target agrees with the document |
| D10 | every dialect example documented in `docs/06` §7 exists, and any divergence from the document is recorded in the entry's note |
| D11 | every digit used in an arabizi form is covered by the transliteration stage |
| D12 | categories are declared and no row falls outside them |
| D13 | no chains: a target must not itself be a source, or one pass rewrites twice (`آش → ما → لا` turned "what" into "not") |
| D14 | a single-character difference outside the conjugation prefixes is a misspelling signal, warned not failed — the class of defect that produced `مرابحة → مرابحا`, a non-word |
| D15 | the input-only policy is asserted: Derja in, MSA out, never Derja for religious content |
| D16 | the apply gate is present, and every pruned entry carries a reason and is genuinely absent |
| D17 | no mapping duplicates what the fold stage already does — such an entry is unreachable coverage that only looks like coverage |
| D18 | keys remain distinct once folded; two keys folding to the same string cannot both match |

**C — cross-artefact**

| Check | Rule |
|---|---|
| C01 | `normalization.json`'s dialect stage and `derja-msa.json` describe the same stage, the same file, the same unmatched-input behaviour |
| C02 | the table the file seeds exists in `schema.sql` |
| C03 | glossary expansion names real columns |
| C04 | currency and the supported locales agree with `specs/config/application.yaml` |
| C05 | answer language is decided per message, not per conversation |

## The self-test

`self-test.mjs` applies 77 mutations, one defect each, to throwaway copies — and asserts the expected
check fires. It is the difference between a linter and a linter that has been shown to work.

Seven are negative controls, which is what stops the suite from passing by flagging everything. Two of
them encode decisions that look like defects and are not:

* a high-confidence entry with **no** note — only below 0.80 does a reason become mandatory;
* a single-character pair differing only in the conjugation prefix (`نستظهر`/`أستظهر`) — Derja and MSA
  differ systematically in the first person, and warning on every one of those buries the real signal.

The self-test also found a linter defect that review did not: deleting a `NOT NULL` column made a later
loop throw, so the process died with a stack trace where CI expected findings. Malformed rows are now
skipped by every downstream loop (D02 has already reported them) and an unexpected throw is caught at
the top level, printed as `INTERNAL`, and exits 2 — a linter that crashes must never look like a clean
run.

## Overrides

For the self-test and for CI matrices:

```
I18N_DIR=…  SCHEMA_FILE=…  DOC03_FILE=…  DOC06_FILE=…  CONFIG_FILE=…  node lint.mjs
```

Exit codes: `0` clean (warnings allowed), `1` errors, `2` the linter itself failed.
