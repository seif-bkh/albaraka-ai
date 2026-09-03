# 09 — Backoffice Specification (admin facade)

**Users**: KB editors, Sharia officers, Sharia auditor, compliance, AI engineers, analysts, platform
admins, branch agents (limited). **Language**: French primary with Arabic and English available —
administrators are bank staff, and the Sharia committee works in Arabic. Full RTL support.

**Principle**: everything that shapes the assistant's behaviour is reachable from here, is versioned,
requires the approvals defined in [doc 05](05-sharia-governance.md), and is reversible in one click.

## 1. Information architecture

```
┌ Dashboard                        ← governance & quality KPIs, alerts, my queue
├ Knowledge
│  ├ Library                       ← documents, filters, lifecycle states
│  ├ Document detail               ← versions, chunks, translations, retrieval preview
│  ├ Upload / import               ← connectors, bulk import, ingestion jobs
│  └ Collections & products        ← taxonomy management
├ Governance
│  ├ Review board (my queue)       ← review workspace, decisions
│  ├ Fatwa requests                ← committee queue, answers, publish-as-KB
│  ├ Glossary                      ← canonical FR/AR/EN terms, forbidden renderings
│  ├ Derja map                     ← dialect → MSA mappings
│  └ Evidence pack                 ← committee/BCT exports
├ Assistant tuning
│  ├ Prompt studio                 ← versions, diff, preview, canary activation
│  ├ Retrieval lab                 ← query playground, strategy breakdown, config A/B
│  ├ Models & providers            ← model configs, budgets, fallback ladder, health
│  ├ Guardrails                    ← policies, lexicons, refusal templates, events
│  └ Experiments                   ← A/B tests
├ Quality
│  ├ Feedback triage               ← ratings, reasons, resolution links
│  ├ QA queue                      ← ungrounded answers, blocked outputs, gaps
│  ├ Golden set                    ← eval cases (trilingual)
│  ├ Eval runs                     ← scorecards, diffs, release gates
│  └ Red team                      ← adversarial suite results
├ Conversations                    ← search, replay with full trace, redaction, handoffs
├ Analytics                        ← usage, intents, languages, refusals, cost, coverage
├ Audit & rights                   ← audit log, chain verification, erasure requests
└ Operations                       ← kill switch, caches, provider health, release bundles
```

## 2. Dashboard

| Zone | Content |
|---|---|
| **Alerts** | S1/S2 incidents, guardrail-block spikes, provider degradation active, budget > 80 %, audit-chain verification failure, eval gate red |
| **My queue** | Reviews assigned to me (with SLA countdown), fatwa requests (Sharia officers), feedback triage (KB editors) |
| **Governance KPIs** | Policy-violation rate, no-fatwa refusal rate, approval SLA adherence, review backlog age, ungrounded-answer rate, withdrawal events (doc 05 §12) |
| **Quality KPIs** | Faithfulness, answer relevancy, context precision/recall on the last eval run, 📈 trend vs previous bundle |
| **Usage** | Conversations/day by language & channel, top intents, top refused topics, P95 latency, cost/day |
| **Active versions** | Prompt v, model config v, retrieval config v, guardrail policy v, KB epoch — each a link to its history |

## 3. Knowledge — Library

Filters: collection, lifecycle state, product codes, language, audience, classification, owner,
validity window, "contains forbidden rendering", "review overdue".
Bulk actions: submit for review, deprecate, withdraw (with reason), re-index, export.

```
┌ Library ───────────────────────────────────────────────────────────────[+ New document]┐
│ [Search…]  Collection ▾  State ▾  Product ▾  Lang ▾  Validity ▾        ⚙ columns       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ▢ Title                     Coll.        Prod.      Lang  State        Valid    Rev.   │
│ ▢ Mourabaha — particuliers  PRODUCTS_RET MOURABAHA  fr    PUBLISHED    →31/12   v3     │
│ ▢ المرابحة — الأفراد        PRODUCTS_RET MOURABAHA  ar    PUBLISHED    →31/12   v3     │
│ ▢ Conditions de banque 2026 TARIFFS      *          fr    IN_REVIEW    01/01→   v1 ⏳  │
│ ▢ Ijara — financement auto  PRODUCTS_RET IJARA      fr    DRAFT        —        v2     │
│ ▢ Norme AAOIFI n° 8         SHARIA_PRIN  *          ar    SHARIA_APPR  —        v1     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ 137 documents · 4 812 chunks · 3 overdue reviews        ⚠ 2 documents expire in 30 d  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

## 4. Knowledge — Document detail

Tabs:

1. **Overview** — metadata (collection, products, audience, classification, validity, owner, external
   ref, sha256), lifecycle state with the state-machine actions available to *this* user, review history.
2. **Versions** — side-by-side diff (bidi-aware, per-paragraph), change summary in FR/AR/EN, author,
   state, "restore this version" (creates v+1, never mutates).
3. **Chunks** — the editable heart:

```
┌ Chunks (v3) ─────────────────────────────── [Re-chunk] [Re-embed] [+ Add chunk] ────────┐
│ #  Heading path                 Lang  Tokens  Embedding   Review     Searchable  Actions │
│ 1  Mourabaha › Définition       fr    412     EMBEDDED    approved   ✔           ✎ ⧉ ▸  │
│ 2  Mourabaha › Éligibilité      fr    288     EMBEDDED    approved   ✔           ✎ ⧉ ▸  │
│ 3  Mourabaha › Marge & durée    fr    196     EMBEDDED    approved   ✔           ✎ ⧉ ▸  │
│ 4  المرابحة › التعريف          ar    389     EMBEDDED    approved   ✔           ✎ ⧉ ▸  │
│ 5  Murabaha › Definition        en    401     STALE       —          ✘           ✎ ⧉ ▸  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
  ⧉ = show as the model sees it (normalised + contextual header)
  ▸ = "test retrieval with this chunk" → opens the Retrieval Lab pre-filtered
```

   Editing a chunk creates a new document version and re-enters review — **no silent edits**.
   The chunk editor shows: raw content, normalised form, `tsv` tokens, forbidden-rendering warnings,
   translation alignment (source ↔ AR ↔ EN), embedding status, and the last 5 answers that cited it.
4. **Translations** — alignment matrix, "generate rendering" (LLM-assisted, marked `machine=true`),
   glossary-consistency check result, human verification checkbox (mandatory for T3).
5. **Retrieval preview** — the top 20 queries from real traffic that retrieve this document, with
   scores; and the queries that *should* retrieve it but don't (coverage gap).
6. **Usage & citations** — how often cited, thumbs-up/down on answers citing it, linked feedback.
7. **Audit** — every action on this document.

**Upload / import**: drag-drop (PDF, DOCX, XLSX, MD, HTML, TXT), or connectors (S3 bucket, website
crawl of `albaraka.com.tn` pages with an allowlist, DB export for agencies/tariffs). Shows the
ingestion job progress per stage (parse → clean → chunk → normalise → translate → embed) with the
chunking policy selector and a preview before commit. Virus scan result and forbidden-content
prescan (Prompt Guard on chunks) are displayed — a poisoned document is quarantined with the reason.

## 5. Governance — Review board

Two views: **My queue** (tasks assigned to me, SLA countdown, tier badge) and **All reviews**
(admin/auditor).

The **review workspace** is the most important screen in the backoffice:

```
┌ Review R-2026-0143 · T3 HIGH · due in 2 d ───────────────────────────────────────────────┐
│ Subject: Document version «Norme AAOIFI n° 8 — extraits» v2 · submitted by A. Ben Salah   │
│ Risk factors: sharia_sensitive terms (3) · collection SHARIA_PRINCIPLES · new content      │
├──────────────────────────────────┬─────────────────────────────────────────────────────────┤
│ Source (fr)                      │ Rendering (ar)                                          │
│ ─ La marge bénéficiaire est      │ ─ هامش الربح يُحدَّد مسبقا بالاتفاق بين الطرفين        │
│   déterminée d'avance…           │   …                                                     │
│ ⚠ forbidden rendering detected   │ ✔ glossary-consistent                                   │
│   in chunk 4: "taux d'intérêt"   │                                                         │
├──────────────────────────────────┴─────────────────────────────────────────────────────────┤
│ Assistant preview: [Q: «ما هو هامش الربح في المرابحة؟»] → generated answer with citations  │
│                    (uses THIS draft content, watermarked «IN REVIEW — not live»)          │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│ Decision (per chunk or global):  ( ) Approve  ( ) Request changes  ( ) Reject              │
│ Refer to the full committee:     [ ] escalate (adds committee_ref, pauses SLA)             │
│ Reason — required, trilingual:   FR [………………………………]  AR [………………………………]  EN [………………]      │
│                                        [ Submit decision ]   ⓘ You cannot approve your own │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

Key behaviours:
* **Two-eyes enforcement in the UI and the API and the DB** (three layers, doc 05 §6).
* Chunk-level decisions: approve 11 of 12 chunks, request changes on one → the document cannot be
  published until all chunks are decided.
* The preview answers with the *draft* content so the reviewer judges the real customer experience.
* Keyboard-driven (`a` approve, `r` request changes, `j/k` navigate) — reviewers process hundreds of items.
* SLA breaches escalate by email and appear on the dashboard.

**Fatwa requests**: queue with origin (chat ref, admin, committee), question in FR/AR/EN, linked
conversation excerpt, assignment to a committee member, answer editor, and **"publish as KB article"**
which pre-fills a new document (collection `SHARIA_PRINCIPLES`, tier T3) from the answer — closing the
loop from refusal to coverage.

**Glossary**: CRUD on terms with the trilingual fields, transliteration, definitions, forbidden
renderings, `sharia_sensitive` flag, status. Shows usage counts (how many chunks/answers use the term)
and a "scan published content" action listing violations.

## 6. Assistant tuning

### 6.1 Prompt studio

* List of prompt codes (`SYSTEM_ASSISTANT`, `SYSTEM_RERANKER`, `QUERY_REWRITE`, `INTENT_CLASSIFIER`,
  `GUARDRAIL_JUDGE`, `ANSWER_CONTRACT`, `SUMMARIZER`) × locale, each with its ACTIVE version, history
  and eval snapshot.
* Editor: syntax highlighting, variable palette (`{{answer_lang}}`, `{{glossary_block}}`,
  `{{context_block}}`, `{{history}}`, `{{question}}`, `{{disclaimer_hint}}`), token counter, and a
  **policy clause library** (reusable blocks such as the no-fatwa clause, the numeric-claims clause)
  so critical wording cannot be accidentally deleted — removing a protected clause requires a
  SHARIA_OFFICER approval.
* Diff view (word-level, trilingual side-by-side) between any two versions.
* **Preview / replay**: pick sample queries (or "the last 20 real queries for this intent") and see the
  answers produced by the draft version vs the active one, side by side, with citations and guardrail
  results. This is the "polish" experience.
* Activation: canary % (5/10/25/50/100), required approvals, mandatory attached eval run for T3,
  automatic rollback if the eval gate regresses or the block rate spikes.

### 6.2 Retrieval lab

The engineer's workbench — see [doc 08 §5.2](08-api-design.md) for the contract.

* Query playground with locale, audience, channel, "include in-review content" toggle.
* Visualisation: three columns (dense / FTS / trigram) with scores, the RRF fusion, the reranker
  output with `reason_code`, and the final selected context with token budget usage bar.
* Parameter sliders that **re-run live** (top-k, weights, τ, MMR λ, HyDE, cross-lingual) — no saving
  required to experiment; "save as config version" when satisfied.
* **A/B compare**: two configs, same query set, side-by-side answers + metrics delta.
* Per-query "why was this chunk not selected?" explanation (score below τ, filtered by audience,
  excluded by validity, dropped by reranker, deduped as a translation).
* Bulk mode: run a CSV/JSONL of queries (or the golden set) and export a report.

### 6.3 Models & providers

* Provider cards (Groq, Google, ONPREM) with health, latency P95, error rate, quota usage today.
* Model configs per purpose (chat primary, chat fast, reranker, guard safety, guard injection,
  embedding), with parameters, timeouts, retries, **fallback chain editor** (drag-and-drop ladder),
  rate limits and daily budget.
* "Test connection" runs a canned prompt and shows tokens/latency/cost.
* Budget panel: spend today/this month by model and purpose, projection, threshold alerts.
* Kill-switch per provider (route everything to the fallback).

### 6.4 Guardrails

* Policies list with severity (`BLOCK/WARN/LOG`), scope (`INPUT/OUTPUT/BOTH`), version, approver,
  enabled flag.
* **Lexicon editor**: trilingual entries, transliterations, Derja variants, import/export CSV,
  "test this phrase" box showing which policies fire.
* **Refusal templates**: REF-01…REF-06 in FR/AR/EN with preview and variable substitution; T3 approval.
* **Events monitor**: live feed of blocks with evidence snippets, filters by policy/severity/intent,
  "convert to QA task", "convert to red-team case" (so every real attack becomes a regression test).

### 6.5 Experiments

Create an A/B (prompt version, retrieval config, model config) with traffic split, target metrics
(faithfulness, 👍 rate, refusal rate, cost), guardrail metrics as automatic stop conditions, duration,
and significance readout. Promotion is a governed action.

## 7. Quality

### 7.1 Feedback triage
Inbox of ratings with reason codes, the full answer, the citations, and the trace. Actions:
**fix KB** (opens the document at the offending chunk), **fix prompt**, **add to golden set**
(one click turns a bad answer into a regression case — the single most valuable button in the product),
**dismiss with reason**, **escalate to Sharia officer** (automatic for `SHARIA_CONCERN`).

### 7.2 QA queue
Automatically populated: ungrounded answers, blocked outputs, numeric-claim failures, wrong-language
answers, `no_answer` cases clustered by topic (→ **coverage gaps**), Derja queries that mis-retrieved
(→ propose new Derja mappings), stale-content answers.

### 7.3 Golden set & eval runs
* Case editor: `id`, `question` (in one language), `expected_answer_lang`, `expected_intents`,
  `must_cite_chunks` / `must_not_cite`, `must_contain_terms`, `must_not_contain_terms`,
  `expect_refusal_code`, `tags` (`AR_DERJA`, `TARIFF`, `SHARIA`, `ADVERSARIAL`), weight.
* Run an eval against a **release bundle** (KB epoch + prompt version + retrieval config + model
  config) → scorecard: faithfulness, answer relevancy, context precision/recall, citation accuracy,
  language correctness, terminology compliance, refusal correctness, policy-violation rate, latency,
  cost — each with a threshold and pass/fail. See [doc 11](11-quality-evaluation.md).
* Diff two runs case-by-case (what regressed, what improved).

### 7.4 Red team
The adversarial suite (doc 05 §11) with results per case, last-run date, and "add case from a real
guardrail event".

## 8. Conversations

Search by language, channel, intent, refusal code, rating, date, agent, "contains a blocked output".
The **replay view** shows the whole trace: normalisation, intent, guardrail decisions, expanded
queries, candidates with scores, selected context, prompt version, raw model output, post-filter
result, rendered answer — and a "re-run with today's config" button that shows how the same question
would be answered now (invaluable after a KB or prompt change).

Personal-data handling: raw content visible only to roles with a **reason code** prompt (logged);
a `Redact` action permanently masks content (reversible only by ADMIN with COMPLIANCE approval, itself
audited).

## 9. Analytics

| Report | Dimensions | Purpose |
|---|---|---|
| Usage | day, channel, locale, authenticated/anon | adoption |
| Intents | intent × outcome (answered/refused/escalated) | where the assistant fails |
| Languages | FR/AR/EN share, Derja share, wrong-language rate | localisation quality |
| Refusals | code × topic clusters | coverage roadmap |
| Coverage gaps | refused topics with no approved content, ranked by frequency | **the KB to-do list** |
| Cost | model × purpose × day, cache hit rate, cost per answer | budget control |
| Governance | all KPIs of doc 05 §12 | committee reporting |
| Content performance | most/least cited documents, documents never retrieved | KB pruning |
| Agent assist | handoff rate, resolution time | branch impact |

All reports export CSV/XLSX and are embeddable (read-only token) for management dashboards.

## 10. Audit & rights

* **Audit log viewer**: filter by actor, action, subject type/id, period; each row expandable to the
  before/after JSON; export signed PDF/CSV.
* **Chain verification**: recompute the hash chain for a period, show the head, compare with the WORM
  copy — the tamper-evidence proof.
* **Evidence pack**: build the committee/BCT export (doc 05 §14).
* **Erasure requests**: queue with subject reference, scope, legal-hold check, execution log.

## 11. Operations

* **Kill switch**: three positions — `ON` (all channels), `AGENTS_ONLY`, `OFF` — with mandatory reason,
  immediate effect (≤ 5 s, gateway-enforced), automatic incident record, and a "restore" that requires
  a second approver.
* **Caches**: inspect/flush semantic cache, embedding cache, dictionaries; shows `kb_epoch`.
* **Provider health**: live status, circuit-breaker states, degradation-step distribution.
* **Release bundles**: promote a bundle (KB epoch + prompt + config + model versions) dev → uat → prod
  with the attached eval scorecard and approval list.
* **Jobs**: ingestion/embedding queue depth, failures, retry, re-index wizard (blue-green).

## 12. Non-functional requirements for the backoffice

| Requirement | Detail |
|---|---|
| Accessibility | WCAG 2.2 AA; the review workspace must be fully keyboard-operable |
| RTL | Complete; reviewers may work in Arabic with French content side by side (bidi-aware panes) |
| Performance | Lists < 400 ms with server-side pagination; diff rendering < 1 s for 10 000-word documents |
| Safety | Destructive actions require typed confirmation; no bulk action without a preview |
| Session | 30 min idle timeout with a warning; unsaved editor content preserved in local draft storage |
| Auditability | Every click that changes state produces an audit event, including failed attempts |
| Offline tolerance | Optimistic-lock conflicts (someone else edited) shown as a merge dialog, never a silent overwrite |

## 13. Screen-level permission map

| Screen | kb-editor | sharia-officer | sharia-auditor | compliance | ai-engineer | analyst | admin |
|---|---|---|---|---|---|---|---|
| Dashboard | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Library / document edit | ✔ | read | read | read | read | read | ✔ |
| Publish / withdraw | — | ✔ | — | ✔ | — | — | ✔ |
| Review board | ✔ (T1 peer) | ✔ | read | ✔ (policy) | ✔ (technical) | — | ✔ (technical) |
| Fatwa requests | — | ✔ | read | read | — | — | read |
| Glossary | ✔ (non-sensitive) | ✔ | read | ✔ | read | read | ✔ |
| Prompt studio | — | ✔ (religious) | read | ✔ (policy) | ✔ | read | ✔ |
| Retrieval lab | — | read | read | read | ✔ | read | ✔ |
| Models & providers | — | — | read | read | ✔ | read | ✔ |
| Guardrails | — | ✔ | read | ✔ | read | read | ✔ |
| Feedback / QA | ✔ | ✔ | read | ✔ | ✔ | ✔ | ✔ |
| Golden set / evals | read | read | ✔ | read | ✔ | read | ✔ |
| Conversations (raw) | — | ✔ | ✔ | ✔ | masked | reason code | ✔ |
| Analytics | KB KPIs | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Audit log | — | ✔ | ✔ | ✔ | — | — | ✔ |
| Kill switch | — | ✔ | — | ✔ | — | — | ✔ |
| Erasure requests | — | — | read | ✔ | — | — | ✔ |
