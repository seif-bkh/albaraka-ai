# tools/prompt-lint — executable proof for the prompt library

`specs/prompts/` is configuration that administrators change at runtime, by design
([docs/09](../../docs/09-backoffice-spec.md)). That is precisely why its structural invariants cannot be
left to review discipline alone. This tool checks them mechanically, and its own checks are checked.

```bash
cd tools/prompt-lint
npm install
npm run verify        # lint the library, then prove the linter can fail
```

| Script | What it does |
|---|---|
| `npm run lint` | Validates `specs/prompts/`. Exit 0 = clean, exit 1 = at least one ERROR. |
| `npm run self-test` | Copies the library to a temp dir, introduces **one** known violation at a time (33 mutations), and asserts the linter reports it. A mutation that goes undetected means that check is vacuous. |
| `npm run verify` | Both, in order. This is the CI gate. |

The baseline is linted before any mutation runs. If the unmutated library is not clean, the
self-test aborts rather than reporting 33 successes for the wrong reason.

## What `lint.mjs` checks

| Group | Invariant | Why it is load-bearing |
|---|---|---|
| **A** | Front matter of every `specs/prompts/*.md` parses as YAML and carries `code`, `locale`, `version`, `state`, `model_role`, `requires_sharia_approval`, `protected_clauses`, `variables` | The importer reads configuration from it; a missing key means a silent default |
| **B** | Every `⟦PROTECTED:ID⟧ … ⟦/PROTECTED⟧` block is balanced, non-empty (≥80 chars) and uses a known clause id; declared clauses appear in the body and body clauses are declared | This is what makes `GOVERNANCE.PROTECTED_CLAUSE_REMOVED` (HTTP 422) enforceable at all. Without it, "an admin cannot delete the no-fatwa clause" is a sentence, not a control |
| **C** | Every `{{variable}}` used is declared, and every declared variable is used | An undeclared variable renders as a literal `{{x}}` in a production prompt; an unused one is a stale contract |
| **D** | All three locales of `SYSTEM_ASSISTANT` exist and carry **identical** protected-clause sets and variable sets; the JSON answer contract and the `no_answer_reason` enum are complete in each | A locale that drifts is a locale that silently stops enforcing a rule. Arabic or English customers would get weaker guarantees than French ones |
| **E** | No prompt recommends an interest-based product outside a prohibition context | The prompts themselves must satisfy the rule they state |
| **F** | `templates.refusals.yaml`: 6 templates × 3 locales, R1–R8 (no religious verdict, no interest-based product, no disclosure of internals, ≤60-word body / ≤8-word title, a next step for every refusal, Arabic copy free of Latin letters), placeholders declared and all used, disclaimers and follow-up pools complete | Refusals are the most-read compliance artefact in the product and the easiest to regress |
| **G** | Every `prompt_code` in the DB enum (`specs/db/schema.sql`) is defined by some spec file; utility prompts run at temperature 0; `GUARDRAIL_JUDGE` documents a fail-safe contract and a ≤500 ms budget; `EVAL_JUDGE` documents fail-closed behaviour | The enum and the library must not drift apart. A deterministic function at temperature 0.7 is not a function |

Two checks deserve a note because a naive implementation of them is vacuous:

* **The `no_answer_reason` enum** is checked inside a window around the *last* mention of
  `NOT_IN_KB`, not across the whole file. `RELIGIOUS_RULING` and `PERSONAL_DATA` also occur inside
  the protected clauses that mandate them, so a whole-file scan passes even when the enumeration is
  truncated — mutation **M10** exists to prove the window works.
* **The interest-term lexicon** skips protected-clause bodies and any line carrying a negation. The
  `NO_CONVENTIONAL_PRODUCTS` clause must name interest-based products in order to rule them out, and
  `REF-02` must be able to say "we do not offer interest-based operations". Mutation **M20** checks
  that an *affirmative* mention is still caught.

## The 33 mutations

| Id | Violation introduced |
|---|---|
| M01 | Protected clause deleted from the body but still declared — the HTTP 422 case |
| M02 | Protected clause deleted from the front matter but still in the body |
| M03 | Closing `⟦/PROTECTED⟧` marker removed (unbalanced) |
| M04 | Clause content replaced by `ok` (non-empty but vacuous) |
| M05 | One locale loses a clause the other two keep |
| M06 | An entire locale file deleted |
| M07 | `{{secret_new_var}}` used without being declared |
| M08 | A variable declared and never used |
| M09 | `needs_human` dropped from the JSON answer contract |
| M10 | A `no_answer_reason` value dropped from the enumeration |
| M11 | Variable sets drift between two locales |
| M12 | `requires_sharia_approval` switched off on the system prompt |
| M13 | A utility prompt moved to temperature 0.7 |
| M14 | The guardrail judge's fail-safe contract reworded to "best-effort" |
| M15 | Guardrail judge latency budget raised to 1200 ms |
| M16 | `EVAL_JUDGE` no longer documented as fail-closed |
| M17 | `EVAL_JUDGE` renamed, leaving a DB enum value unspecified |
| M18 | The per-prompt fallback table removed |
| M19 | A refusal template issues a religious verdict (R1) |
| M20 | A refusal names an interest-based product affirmatively (R2) |
| M21 | A refusal discloses that a guardrail exists (R3) |
| M22 | A refusal body grown past 60 words (R5) |
| M23 | A refusal title grown past 8 words (R5) |
| M24 | A refusal left with no next step (R6) |
| M25 | Latin letters injected into Arabic copy (R8) |
| M26 | A whole locale removed from one template |
| M27 | An undeclared placeholder introduced |
| M28 | `REF-01` given a CTA — an attack must not earn a human channel |
| M29 | A template dropped from the file |
| M30 | The customer-facing `REF-05.technical` variant leaks internals |
| M31 | A disclaimer pointing at a refusal code that does not exist |
| M32 | A follow-up pool losing a locale |
| M33 | Refusal templates de-flagged from Sharia approval |

Markdown mutations are textual. YAML mutations are structural (`load → change → dump`) so a test
never passes or fails because of indentation luck. Every mutation asserts that its anchor string
still exists: if the copy drifts, the mutation reports `BROKEN` and fails the run instead of
silently testing nothing.

## Scope — what this tool does *not* check

It validates structure and governance metadata. It cannot judge whether a prompt is *good*: that is
the job of the golden set, the red-team suite and the Sharia-officer review recorded on
`prompt_version.reviewed_by` ([docs/11](../../docs/11-quality-evaluation.md)). Test **RT-REF-10** in
`templates.refusals.yaml` is explicitly a human check for that reason.
