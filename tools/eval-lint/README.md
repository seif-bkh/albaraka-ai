# tools/eval-lint — executable proof for the benchmark

The benchmark decides which releases ship. If the benchmark is internally inconsistent, it fails good
releases and passes bad ones, and the failures look like model regressions — so nobody suspects the
test data. This tool makes the benchmark itself a checked artefact.

```bash
cd tools/eval-lint
npm install
npm run verify      # lint specs/eval/, then prove the linter can fail
```

| Script | What it does |
|---|---|
| `npm run lint` | Validates the manifest, the golden set and the red-team suite. Exit 0 = clean. |
| `npm run self-test` | 39 mutations, each breaking exactly one thing in a temp copy, asserting the linter reports it. Includes 3 **negative controls** that must keep passing. |
| `npm run verify` | Both. This is the CI gate. |

## Check groups

| Group | Invariant |
|---|---|
| **K** manifest | Unique chunk ids; `lang`, `classification`, `state`, `tier`, `documentType` inside the DB enum domains; `shariaApproved` ⇄ `shariaApprovalRef`; every `T3_HIGH` chunk approved; `RETIRED` carries `validTo`; nothing `PUBLISHED` with an expired `validTo`; token count inside the 50–1200 chunking window; non-empty `topics` and a `summary` long enough to serve as a retrieval field |
| **S** schema | One JSON object per line; unique ids; all required fields; `questionLang`/`expectedAnswerLang`/intents/refusal codes inside the enum domains; `weight` an integer 1–5; non-empty `tags`; ISO `addedAt` |
| **X** cross-reference | Every cited chunk exists; **must-cite chunks are actually reachable** (state `PUBLISHED` and inside their validity window) — a case pointing at a retired chunk can never pass; no must-cite chunk at a non-`PUBLIC` classification; no chunk both must-cite and must-not-cite |
| **C** consistency | No term both required and forbidden, **including substring collisions in either direction**; patterns are valid regexes; `questionLang == expectedAnswerLang`; refusals made of static template copy carry no citation requirement; answer cases carry a reference answer long enough to anchor the judge |
| **P** composition | Language and topic shares recomputed against docs/11 §2.2, failing outside ±8 pp; every `TARIFF` case pins a figure; every `AR_DERJA` case asserts the user's own dialect or arabizi wording is forbidden in the answer; no front-office case cites an `INTERNAL` chunk |
| **R** red team | RT-01…RT-15 all present and matching docs/05 §6; one family per case; `severity` in S1–S4; every case names its `guardrailLayers` as `<stage>:<POLICY>`; S1 cases forbid at least one term and carry `weight ≥ 4`; `detectionPoint` and a substantive `expectedBehaviour` present; no case asserts nothing |

## Cross-spec coupling

Which refusals may require citations is **derived at run time** from
[`specs/prompts/templates.refusals.yaml`](../../specs/prompts/templates.refusals.yaml): a refusal
whose body embeds `{{alternative_block}}`, `{{documentation_block}}` or `{{top_sources}}` is
grounded in retrieved content and may therefore be asserted against a chunk. Today that is `REF-02`,
`REF-03` and `REF-05`. Adding a grounded placeholder to `REF-06` relaxes the rule for `REF-06` cases
automatically; hard-coding the list would not.

The enum domains mirror `specs/db/schema.sql` (`locale_code`, `intent_code`, `refusal_code`,
`classification`, `risk_tier`). If the schema enum changes, this file must change with it — the
mutation suite will not catch that drift, so it is worth a review line in any schema PR touching
those types.

## The 39 mutations

Negative controls first, because they are the ones that keep the rules honest:

| Id | Change | Expected |
|---|---|---|
| **N1** | A `REF-02` case gains a second grounded citation requirement | **must still pass** |
| **N2b** | A `REF-03` case requires the grounded documentation block | **must still pass** |
| **N3** | A `REF-05` case keeps its grounded top-sources requirement | **must still pass** |

| Id | Violation |
|---|---|
| M01–M08 | Unknown chunk reference; must-cite a `RETIRED` / `QUARANTINED` / `INTERNAL` chunk; a chunk both must-cite and must-not-cite; duplicate id; id shared across the two suites; malformed JSONL line |
| M09–M13 | Unknown intent, refusal code or locale; `weight` out of range; empty `expectedIntents` |
| M14–M21 | `questionLang ≠ expectedAnswerLang`; a required term that is also forbidden; a forbidden term that is a substring of a required one; invalid regex; a static-copy refusal required to cite; an answer case with no reference answer; a `TARIFF` case pinning no figure; non-ISO `addedAt` |
| M22–M28 | A documented RT case deleted; two cases sharing an attack family; an S1 case forbidding no term; an S1 case down-weighted; a malformed `guardrailLayers` entry; no `detectionPoint`; a case asserting nothing |
| M29–M34 | Sharia approval without a reference; `PUBLISHED` past its validity; `RETIRED` without `validTo`; a `T3` chunk unapproved; duplicate chunk id; token count out of range |
| M35–M36 | The French slice collapsing below target; every tariff case deleted |

Mutations are structural (parse → change → re-serialise), never textual surgery on JSONL, so no test
depends on key order or spacing. Each mutation asserts its anchor still exists: if the data drifts,
the mutation reports `BROKEN` and fails the run instead of silently testing nothing.
