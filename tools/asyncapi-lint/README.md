# `tools/asyncapi-lint`

Executable checks over [`specs/asyncapi.yaml`](../../specs/asyncapi.yaml) — the event contract of the
assistant. Run before every commit that touches the spec, and in CI on every pull request.

```bash
npm install
npm run verify      # lint, then prove the linter can fail (mutation self-test)
```

Node ≥ 20. One dependency, `js-yaml`. The document is also validated against the official
`@asyncapi/parser` (3.x) locally during development — it parses clean with zero diagnostics.

## Why this exists

An event contract is the place where a one-word change disconnects a consumer with no compiler to
complain. The AsyncAPI file has **three authorities**, and the linter derives its expectations from
them rather than restating them:

| Expectation | Derived from |
|---|---|
| SSE frame set, order and terminal rules | `docs/08-api-design.md` §3.1 (the normative example + the alternative-terminals block) |
| SSE payload fields, request fields and enums (`stage`, `locale`, `dir`, `refusalCode`) | `specs/openapi.yaml` `Sse*` schemas and the `Locale`/`Direction`/`RefusalCode` enums |
| Internal event catalog, emitters and consumer groups | `docs/08-api-design.md` §6 (the table — this tool added the `Emitted by` column there) |
| Payload property names, derived flags and enum values | `specs/db/schema.sql` tables and `CREATE TYPE` enums |

Change the document, the OpenAPI file or the schema and the linter's demands change with it.

## Check groups

| Group | What it asserts |
|---|---|
| `G` | AsyncAPI 3.1.0; every channel and operation `$ref` resolves; an operation's messages belong to **its own** channel; exactly one `send` and one `receive` operation per channel — the in-process bus is documented by both halves, not by one |
| `S` | the eight SSE frames in the documented order (`accepted` first, `sources` before the first `token`, exactly one terminal of `answer`/`refusal`/`error`, `done` last); `x-sse-rules` agree with docs/08 §3.1 (30 s idle timeout, no `Last-Event-ID` resume); payload property sets and enums equal their openapi.yaml authorities; `SendMessageRequest` mirrors openapi exactly |
| `E` | the internal catalog is exactly docs/08 §6; per event one emitter and the documented consumer groups; `x-table-ref` names real tables; every payload property is a column of one of them (camelCase → snake_case), an **explicitly** `x-derived` computed field, or the aggregate `id`; a derived flag on a real column is stale and fails; `type` is constrained to the event name; the envelope keeps its four mandated fields |
| `P` | no internal event payload carries content-bearing or contact fields (`question*`, `answer*`, `comment`, `body`, `text`, `contact`, phone/email/address/CIN/IBAN…) and no SSE payload does either — events are references, the database is the content store |

`ERROR` fails the build. `WARN` never does, and is used for judgements a human should make.

## The rule it exists to enforce

**Internal events are references, not content.** A `fatwa.request.opened` event carries the request
`ref`, the locale and the SLA — never the question. A `feedback.received` event carries the rating
and an id — never the comment. The consumers that need the text re-read it from the database; the
event itself is logged, traced and possibly shipped to the outbox, so content must not ride along.

## Self-test

`self-test.mjs` applies **28 defects + 3 negative controls** to a throwaway copy and asserts the
expected check id appears:

```
31 mutations · 31 detected · 0 MISSED · 0 BROKEN
```

The mutations reproduce the failure modes of this kind of file: an internal event renamed (its
consumers silently never fire), an SSE payload field added or dropped against openapi.yaml, a frame
moved after the first token (citations would render after prose), an event fact with no column, a
stale `x-derived` flag, an enum value the database cannot store, `questionAr` smuggled into an
internal event, and a `contact*` field streamed to the client. The negative controls prove the
linter does not fire on harmless edits — property order, an unknown `x-` extension, a copy change.

## What the linter caught while it was being written

* **`review.decided` carried `decidedBy`**, but the column is `decision_by` — a fact with no
  storage dressed as a column. The payload now names the column.
* **`guardrail.blocked` duplicated `correlationId`** from the envelope. The envelope guarantees one
  per event; a second definition is ambiguity about which one the outbox stores.
* **`review_decision` in schema.sql is `('APPROVE','REQUEST_CHANGES','REJECT')`** — the first draft
  of the spec used `CHANGES_REQUESTED`. The enum-membership check caught a name the database cannot
  hold before any code referenced it.
* **`decision` in `guardrail.blocked` was unconstrained**; the event only fires on BLOCK, so the
  schema now says so.
* **`model_config` has no `activated_at`/`activated_by`** (unlike `prompt_version`,
  `retrieval_config` and `guardrail_policy`). `model.activated` therefore carries `updatedAt` and
  uses the `updated_at` column. Closing that schema asymmetry is a reviewed Phase 1 schema change.

## Related

* `specs/openapi.yaml` — the REST contract the SSE payloads mirror
* `docs/08-api-design.md` — §3.1 the stream, §6 the event catalog (the authority of this tool)
* `specs/db/schema.sql` — the storage grounding
* `tools/realm-lint`, `tools/config-lint` — the same derive-don't-copy discipline elsewhere
