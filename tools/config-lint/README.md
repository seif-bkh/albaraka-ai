# `tools/config-lint`

Executable checks over `specs/config/`. Run before every commit that touches configuration, and in
CI on every pull request.

```bash
npm run lint      # check specs/config          → exit 1 on any ERROR
npm run verify    # lint, then prove the linter can fail (mutation self-test)
```

Node ≥ 20. One dependency, `js-yaml`.

## Why this exists

Configuration is the artefact in this repository where a plausible-looking mistake is invisible in
review and severe in production. A debug actuator endpoint, a fail-open guardrail, a redaction flag
left `false`, a seeded retrieval parameter quietly outside the range the architecture document
promises — none of these read as wrong in a diff, and all of them are the kind of thing that is
found by an auditor or an incident, not by a reviewer.

So the linter's expectations are **derived, not copied**:

| Expectation | Derived from |
|---|---|
| tunable names, defaults and ranges | `docs/04-rag-pipeline.md` §18 parameter sheet |
| seeded retrieval values | column `DEFAULT`s of `retrieval_config` in `specs/db/schema.sql` |
| model roles | the `model_role` enum |
| providers | the `provider_code` enum |
| channels | the `channel` enum |
| classification ceiling ordering | the `classification` enum |

Change the document or the schema and the linter's demands change with it. The self-test mutates
copies of both to prove that this is true rather than merely intended.

## The rule the whole file layout rests on

`application.yaml` holds **environment wiring and first-boot seeds**. Anything an administrator may
change at runtime lives in the database and is read from there on every request; the
`albaraka.seed.*` block is consumed once, on an empty database, and can never override an `ACTIVE`
row. A tunable that exists in both YAML and the database has two truths, and which one wins depends
on the environment and the deploy order.

The linter enforces the boundary from both sides: `S05` rejects a profile that re-forks the seeded
model list, `C05` rejects a feature flag whose source is not `assistant_config`, and `T03`/`T07`
require every seeded retrieval value to equal the schema `DEFAULT` and to name a column that exists.

## Check groups

| Group | What it asserts |
|---|---|
| `S` | all four files parse; the base declares the required sections; a profile overrides **only** keys the base declares (an undeclared key is a typo that silently does nothing); `albaraka.env` matches its file; the seed block is declared once |
| `X` | no literal credential; no credential carries a fallback default in uat/prod (production must fail to start without the real secret); no key-shaped string (`gsk_…`, `AIza…`, `AKIA…`, `sk-…`, `xox…`) anywhere |
| `P` | production hardening for uat **and** prod: actuator surface, health detail, log redaction, log levels, the MOCK provider, Flyway safety, egress enforcement and budget, kill-switch discipline, the Sharia gate failing closed, object lock in `COMPLIANCE` mode, access logs off, classification ceiling, datasource wiring |
| `D` | every relaxation permitted in dev is asserted **absent** from uat and prod — second approver waived, clear-text logging, autonomous judge, dev-scale rate limits, public health details, object lock off |
| `T` | every documented tunable is seeded, inside its documented range, equal to its schema `DEFAULT`; the seeded embedding variant agrees with the seeded `EMBEDDING` model; the channel exists |
| `M` | seeded roles are exactly the `model_role` enum; providers valid; embeddings never on Groq (it serves none) and always with a dimension and a task type; deterministic roles pinned at temperature 0; fallbacks resolve and are not self-referential; no role out-budgets the platform; guards inside the 2 s latency budget; `CHAT_PRIMARY` has a fallback |
| `C` | values declared in more than one file agree, and the invariants that must hold everywhere do: TND at three decimals, trilingual locales, streaming with sources before the first token, cache keyed on `kb_epoch`, disclaimers appended server-side, retention mandates, Groq embeddings disabled, egress allowlist covering every seeded offshore provider and naming no local host, prod tracing no heavier than uat |

`ERROR` fails the build. `WARN` does not, and is reserved for judgements a human should make —
an embedding model that is not Google, a dimension that is not 1536.

## Environment overrides

```bash
CONFIG_DIR=/tmp/cfg node lint.mjs        # check a copy instead of specs/config
SCHEMA_FILE=/tmp/schema.sql node lint.mjs
DOC04_FILE=/tmp/doc04.md   node lint.mjs
```

The last two exist for the self-test: they are how it demonstrates that a change to `docs/04` or to
`schema.sql` changes what the linter demands.

## Self-test

`self-test.mjs` applies **103 mutations**, one defect at a time, to a throwaway copy of
`specs/config` (or of an authority document) and asserts that the expected check id appears in the
output:

```
103/103 mutations behaved as expected · 0 failure(s)
```

97 are defects — a literal password, `/actuator/env` exposed in production, `flyway clean` enabled,
the Sharia judge passing answers through while unavailable, object lock downgraded to `GOVERNANCE`,
embeddings routed to Groq, the reranker sampling at temperature 0.7, the dinar quoted to two
decimals, cached answers that survive a knowledge-base promotion, `top_k_dense` seeded at 500 against
a documented range of 5–100, a schema `DEFAULT` moved away from the seed.

6 are **negative controls**, which is what stops the suite from passing by flagging everything:
no mutation at all; dev keeping its sanctioned relaxations; production tightening a log level below
the base; UAT running the judge with autonomy off; a rate limit raised within its ceiling; and the
`EMBEDDING` role carrying no temperature, which it must not.

### What the self-test caught while it was being written

* **`albaraka.seed:` as a dotted top-level key.** Spring flattens it to the right property names, so
  the application would have worked — but the parsed YAML has a literal key `"albaraka.seed"`, not
  `albaraka` → `seed`, and the linter read an empty seed block. Every model and tunable check went
  vacuous and reported success. The block is now nested properly. A structure that fools its own
  linter will fool its next reader.
* **T03 only covered the documented tunables.** It looped over the `docs/04` sheet, so the seeded
  values that are *not* runtime tunables — `embedding_variant`, `min_score_fts`, `boost_recent_days`,
  `canary_percent` — never met the schema. Moving the comparison into a loop over the whole seed
  found the gap, and added `T07` for a seeded key that names no column at all.
* **`temperature` was required of every model role**, including `EMBEDDING`, which samples nothing.
  The check was demanding a meaningless field; it now exempts embeddings and instead fails when a
  *sampling* role leaves its temperature unpinned.
* **UAT had `tn.albaraka.ai.governance: DEBUG`**, contradicting both the `P04` rule and the claim in
  the file's own header that UAT is prod-shaped. Real defect in shipped config, caught on first run.
* **A mutation helper returned the sub-document it had edited**, so the harness dumped the wrong
  object and wrote empty files — 68 mutations "failed" at once. The harness now mutates in place and
  ignores return values.

## Related

* `specs/config/README.md` — what belongs in YAML and what belongs in the database
* `tools/db-verify` — proves the schema the seed defaults are read from actually builds
* `tools/realm-lint` — the same derive-don't-copy discipline applied to `specs/keycloak/`
* `tools/prompt-lint`, `tools/eval-lint` — prompts and evaluation corpora
