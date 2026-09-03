# `tools/seed-gen`

Generates the Flyway content migrations in [`specs/db/seed/`](../../specs/db/seed) from their authored
sources, and checks that the committed SQL is not stale.

```bash
npm run generate     # write specs/db/seed/V900…V903
npm run check        # exit 1 if the committed SQL differs from what the sources imply, or if the audit fails
node generate.mjs --only V903
```

Node ≥ 20. One dependency, `js-yaml`.

## Why generated rather than handwritten

Roughly 500 rows across four migrations, with trilingual text, array and jsonb columns, 79 KB of prompt
bodies and 366 Arabic mappings. Handwritten, they drift from the documents the first time anyone edits
a document — and the drift is invisible, because both files still look correct in review. A glossary
term edited in `docs/glossary-trilingual.md` and not in the migration produces a database that
disagrees with the bank's own terminology document, and nothing fails.

`--check` is what makes that impossible: it regenerates in memory and compares bytes.

## Sources and targets

| Source | Target |
|---|---|
| `docs/glossary-trilingual.md` §1–§5 | `term_glossary` (97 terms, trilingual labels, forbidden renderings, 🔒 → `sharia_sensitive`) |
| `specs/eval/kb-manifest.jsonl` | `collection` (the `documentType` values, and the modal classification and tier per type) |
| `docs/04-rag-pipeline.md` §15 | `collection.chunking_policy` (strategy and token window per content type) |
| `specs/prompts/*.md` | `prompt_template`, `prompt_version` (10 rows) |
| `docs/07-security-iam-compliance.md` §6.1 | `guardrail_policy` (scope, severity, decision, tier) |
| `specs/config/application.yaml` | `guardrail_policy.params` (resolved by the path §6.1 names), `assistant.identity` |
| `specs/prompts/templates.refusals.yaml` | `message_bundle` (99 rows), `refusal.policy`, `refusal.fragments`, `disclaimer.wiring` |
| `docs/glossary-trilingual.md` §6 | `guardrail.forbidden_renderings_register` |
| `specs/i18n/derja-msa.json` | `derja_msa_map` (366 rows) |
| `specs/db/schema.sql` | the schema name and every enum domain used above |

`model_config` and `retrieval_config` are deliberately absent: they are written by
`SeedOnEmptyDatabaseRunner` from `albaraka.seed`. Two writers for one row is two truths.

## It validates; it does not transcribe

A generator that copies is a photocopier. Every builder asserts its inputs against the schema and
against the other sources, and refuses to emit on failure:

* every `prompt_code`, `guardrail_policy_code`, `locale_code`, `model_role`, `guardrail_scope`,
  `guardrail_severity`, `guardrail_decision` and `risk_tier` value is checked against the enum in
  `schema.sql` — in both directions, so an enum member with no seed row and a seed row with no enum
  member both fail;
* a prompt file's `protected_clauses` must equal the `⟦PROTECTED:…⟧` markers physically present in its
  body, because two statements of one fact that disagree let the Prompt Studio enforce a clause the
  prompt does not contain;
* a prompt code bound to different model roles for different locales is rejected;
* a `params` path named by the §6.1 register must exist in `application.yaml`, so a policy can never be
  seeded with empty thresholds and still show as enabled;
* every refusal must exist in all three locales, and every follow-up pool a refusal names must be
  defined;
* every generated `message_key` must match a pattern the source file's own header documents, and every
  placeholder in the header must have a declared resolver;
* an agent-variant-only placeholder appearing in customer-facing copy fails the build (rule R3);
* every `kb-manifest.jsonl` `documentType` must resolve to a collection, because
  `document.collection_id` is `NOT NULL`;
* a glossary term missing one of its three `NOT NULL` labels, or a duplicate `canonical_code`, fails.

Three of these found real defects while the generator was being written, all in customer-facing copy:
the refusal bodies interpolated `{{bank_name}}` and nothing supplied it; the REF-05 agent variant used
two placeholders no document declared; and the REF-03 referral flow refers to three message keys whose
text has never been written. The first two are fixed. The third is recorded in the seed under
`referencedMessagesNotAuthored` and asserted by `seed_test.sql` G7h, because inventing bank
customer-facing copy is a content decision that needs the R1–R8 review, not a generator's judgement.

## Deterministic output

Every surrogate key is a **UUIDv5** of the row's natural key under a fixed committed namespace
(`a1ba4a4a-0000-5000-8000-000000000000`), so regeneration is byte-identical and the same row has the
same id in dev, UAT and production — which is what makes an id in a log line mean the same thing
everywhere. Nothing calls `now()` for a stored value; `created_at` is left to the column `DEFAULT`.

Inserts are plain, not `ON CONFLICT DO NOTHING`. A Flyway versioned migration runs exactly once, so a
natural-key collision means a source is wrong; failing at migrate time beats silently seeding one row
fewer.

## The audit

Runs in both modes, over the files on disk when checking (that is what ships):

* each migration sets `search_path` to the schema `schema.sql` actually creates — the first version of
  this generator hardcoded `albaraka` for a schema named `albaraka_ai`, which would have inserted into
  `public` and failed on every table;
* no migration writes a runner-owned table;
* every `INSERT` target exists in `schema.sql`;
* no migration is empty;
* no `.sql` file sits in `specs/db/seed/` that no builder produces, because `--check` cannot tell
  whether a file it does not know about is stale.

Exit codes: `0` clean, `1` stale or audit failure, `2` a builder threw.

## Where the proof lives

`tools/seed-gen` proves the SQL matches its sources. [`tools/db-verify`](../db-verify) proves the SQL
*runs* and that the data obeys its invariants:

```bash
cd tools/db-verify && npm run verify:seed    # 319 statements · 23 assertions (G5, G6, G7)
```

Run `--check` first. The seed tests cannot tell you that a migration is stale; they will happily
validate SQL that no longer reflects any document.
