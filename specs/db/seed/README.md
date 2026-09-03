# `specs/db/seed/` — the Flyway content migrations

**These files are generated. Do not edit them by hand.** Edit the source document and run
`node tools/seed-gen/generate.mjs`; CI runs `--check` and fails if the committed SQL does not match
what the sources imply.

| Migration | Seeds | Rows | Generated from |
|---|---|---|---|
| `V900__seed_glossary.sql` | `collection`, `term_glossary` | 9 + 97 | `docs/glossary-trilingual.md` §1–§5, `specs/eval/kb-manifest.jsonl`, `docs/04` §15 |
| `V901__seed_prompts.sql` | `prompt_template`, `prompt_version` | 10 + 10 | `specs/prompts/*.md` |
| `V902__seed_policies.sql` | `guardrail_policy`, `message_bundle`, `assistant_config` | 10 + 99 + 6 | `docs/07` §6.1, `specs/config/application.yaml`, `specs/prompts/templates.refusals.yaml`, `docs/glossary-trilingual.md` §6 |
| `V903__seed_dialect.sql` | `derja_msa_map` | 366 | `specs/i18n/derja-msa.json` |

## The two rules that decide what goes in a migration

**Everything is seeded `DRAFT`.** `specs/config/README.md`: *first boot ──► seed rows created as DRAFT
──► review ──► ACTIVE ──► runtime reads the database*. A prompt file, a policy register or a glossary
document cannot grant itself activation — that is a governance act with a named approver. So
`prompt_version.state` and `guardrail_policy.state` are `DRAFT` here whatever their source files say,
and `seed_test.sql` G6b and G7a fail if that ever changes. `retrieval_config` and `model_config` follow
the same rule through the runner rather than through a migration. The two exceptions
are reference data with no governance dimension: `term_glossary.status` and `derja_msa_map.status`,
which are `ACTIVE` because a glossary term is not a policy.

**`model_config` and `retrieval_config` are seeded by nobody here.** They belong to
`SeedOnEmptyDatabaseRunner`, which reads `albaraka.seed` from `application.yaml` once, on an empty
database. Two writers for one row is two truths, and which one wins depends on the environment and the
deploy order. `tools/seed-gen` audits this boundary and fails the build if a migration writes those
tables.

## Verifying

```bash
node tools/seed-gen/generate.mjs --check     # not stale, and the boundary audit passes
cd tools/db-verify && npm run verify:seed    # schema + all four seeds + seed_test.sql
```

`verify:seed` executes everything against a throwaway UTF8 PostgreSQL cluster: **319 statements, 23
assertions**. The assertions test the seeded *data*, which `schema_test.sql` cannot reach — the schema
can be perfect and the seed still wrong, and a wrong seed fails as bad answers rather than as an error.

| Group | Protects |
|---|---|
| G5a–G5h | glossary and dialect map: no term forbids its own rendering, no mapping chains, Arabic round-trips byte-exact, chunking policies name a strategy the pipeline implements |
| G6a–G6f | prompt library: every `prompt_code` seeded, nothing ACTIVE, the nine protected clauses present as markers in the stored body, no undeclared `{{placeholder}}`, no truncated body |
| G7a–G7h | policies: every guardrail code seeded once and DRAFT, no CRITICAL policy weaker than BLOCK, no policy with empty params, every refusal complete in all three locales, every placeholder resolvable, referenced message keys seeded or tracked |

Run `generate.mjs --check` **before** `verify:seed`. The seed tests prove the SQL is well-formed and
obeys its invariants; only the staleness check proves the SQL is the SQL the documents imply.

## Known gap, tracked rather than papered over

The REF-03 Sharia-referral flow in `templates.refusals.yaml` refers to three message keys whose text is
not authored anywhere:

* `consent.REF-03.referral` — the opt-in prompt before a question is forwarded to the Committee
* `notification.REF-03.referral_created`
* `notification.REF-03.referral_declined`

Writing them is a content decision, not a generator decision: refusal copy is bound by rules R1–R8 in
the source header, including R7 (Arabic written natively, never machine-translated from the French).
So the keys are recorded under `referencedMessagesNotAuthored` in the `refusal.policy` register, where
the backoffice can show them, and G7h fails if a new reference is added without being either seeded or
tracked. The alternative — a null or a raw key in front of a customer who just asked a religious
question — is the failure mode this repository is built to avoid.

## Adding a migration

1. Author the **source** (a document, a spec file), not the SQL.
2. Add a builder to `tools/seed-gen/generate.mjs` and register it in `BUILDERS`. Derive every value;
   where a value genuinely has no source, say so in the file header the way V900 does for the
   collection names.
3. Validate in the builder: enum membership against `schema.sql`, completeness across locales,
   references that resolve. A generator that transcribes is a photocopier; one that validates is a
   gate.
4. Add assertions to `specs/db/tests/seed_test.sql`. Give it a fixture guard so it cannot pass on an
   empty table, and prove it is not vacuous.
5. `generate.mjs`, then `verify:seed`, then update the tree in `docs/02` §1.
