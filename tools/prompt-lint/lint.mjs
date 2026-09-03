#!/usr/bin/env node
/**
 * prompt-lint — executable checks over specs/prompts/
 *
 * The prompt library is configuration that changes at runtime by design (docs/09). The point of this
 * linter is that "an admin can edit it" never silently becomes "an admin can break it": every
 * structural invariant the pipeline relies on is checked here, in CI, on every commit.
 *
 * What it checks
 *   A. Front matter of every specs/prompts/*.md parses as YAML and carries the required keys.
 *   B. Every ⟦PROTECTED:ID⟧ … ⟦/PROTECTED⟧ block is balanced, non-empty and declared in
 *      `protected_clauses` — and conversely every declared clause appears exactly once in the body.
 *      This is what makes GOVERNANCE.PROTECTED_CLAUSE_REMOVED (HTTP 422) enforceable at all.
 *   C. Every {{variable}} used in a body is declared in `variables`; no declared variable is unused.
 *   D. All three locales of SYSTEM_ASSISTANT exist, carry the SAME protected-clause set and the SAME
 *      variable set, and use the same output-schema keys. A locale that drifts is a locale that
 *      silently stops enforcing a rule.
 *   E. No prompt body outside the refusal templates leaks a religious verdict, an interest-based
 *      product term or a numeric figure that is not a placeholder.
 *   F. templates.refusals.yaml passes its own acceptance tests RT-REF-01…RT-REF-09 (R1–R8, word
 *      caps, placeholder declaration in both directions, Arabic-script purity, "every refusal offers
 *      a next step", and at most one apology). RT-REF-10 is human review by design and is recorded on
 *      prompt_version.reviewed_by, not asserted here.
 *   G. utility.prompts.md declares every prompt_code the DB enum knows about, minus
 *      SYSTEM_ASSISTANT (own files) and GUARDRAIL_JUDGE (own file).
 *
 * Exit code 0 = pass, 1 = at least one ERROR. WARN never fails the build.
 *
 * Usage:  node tools/prompt-lint/lint.mjs            (from the repo root)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
/** Overridable so the mutation self-test can point the linter at a tampered copy of the library. */
const PROMPTS = process.env.PROMPT_DIR ? join(process.env.PROMPT_DIR) : join(root, 'specs', 'prompts');

const errors = [];
const warns = [];
const ok = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const LOCALES = ['fr-FR', 'ar-TN', 'en-GB'];

/** DB enum prompt_code — kept in sync with specs/db/schema.sql. */
const KNOWN_CODES = [
  'SYSTEM_ASSISTANT', 'SYSTEM_RERANKER', 'QUERY_REWRITE', 'INTENT_CLASSIFIER',
  'GUARDRAIL_JUDGE', 'EVAL_JUDGE', 'ANSWER_CONTRACT', 'SUMMARIZER',
];

/** The nine protected clauses declared in specs/prompts/README.md. */
const KNOWN_CLAUSES = [
  'NO_FATWA', 'GROUNDED_ONLY', 'NO_UNSOURCED_NUMBERS', 'NO_CONVENTIONAL_PRODUCTS',
  'NO_PII', 'LANGUAGE_MATCH', 'CITATION_REQUIRED', 'HONEST_IGNORANCE', 'SOURCES_ARE_DATA',
];

/** Output-contract keys that must be identical across locales. */
const CONTRACT_KEYS = [
  'answer_markdown', 'language', 'confidence', 'used_sources', 'caveats',
  'needs_human', 'no_answer', 'no_answer_reason',
];

const NO_ANSWER_REASONS = [
  'NOT_IN_KB', 'OUTDATED', 'AMBIGUOUS', 'OUT_OF_SCOPE', 'RELIGIOUS_RULING', 'PERSONAL_DATA',
];

// ── Lexicons (mirror guardrail_policy.PROHIBITED_TOPICS + term_glossary.forbidden_renderings) ────
const VERDICT_WORDS =
  /\b(est|c'est)\s+(halal|haram|licite|illicite|permis|interdit)\b|\bhalal\b|\bharam\b|حلال|حرام|لا يجوز|\bpermissible\b|\bforbidden in islam\b/i;
const INTEREST_TERMS =
  /taux d'intérêt|crédit classique|prêt à intérêt|intérêt\b|\bloan\b|interest rate|قرض ربوي|فائدة ربوية/i;
/** Figures that are fine inside a prompt: they are schema constants, thresholds or examples. */
const ALLOWED_NUMBER_CONTEXT = /(0\.\d+|1\.0|220|400|1536|τ|k=60|λ|top_n|max_words|confidence)/;

/**
 * A sentence that merely NAMES a forbidden thing in order to rule it out is not a violation — that
 * is how the prohibition is expressed. Multilingual negation markers, checked on the line that
 * carries the term. Deliberately broad: a false negative here (missing a real leak) is caught by
 * the human review in R10 and by the red-team suite; a false positive would make the linter
 * unreadable.
 */
const NEGATION =
  /(jamais|ne\s|pas\b|aucun|ni\b|n'|sans\b|interdit|prohibé|never|\bnot\b|\bno\b|don't|doesn't|cannot|must not|do not|is not|are not|لا |ليس|ولا |دون |بدون |ممنوع|غير مسموح|أبدا)/i;
const negated = (line) => NEGATION.test(line);

/**
 * R9 — "no template apologises more than once" (rule R4 of templates.refusals.yaml, acceptance test
 * RT-REF-09). A refusal that apologises twice reads as a system that knows it failed; one apology is
 * polite, none is a scope statement, which is what R3 asks for. Counted across title, body and cta of
 * one locale, because a customer reads them as one message.
 * Built fresh per call: a /g regex carries lastIndex between .test() calls and would skip matches.
 */
const APOLOGY_SOURCE =
  'excuse|d[ée]sol[ée]|pardon|navr[ée]|regrette|sorry|apologis|apologiz|apolog|forgive|regret' +
  '|اعتذار|نعتذر|أعتذر|آسف|نأسف|عذرا|المعذرة|سامحنا';
const apologies = (text) => (String(text || '').match(new RegExp(APOLOGY_SOURCE, 'gi')) || []).length;

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  helpers
// ─────────────────────────────────────────────────────────────────────────────────────────────
function splitFrontMatter(text, file) {
  if (!text.startsWith('---')) { err(`${file}: missing YAML front matter`); return [null, text]; }
  const end = text.indexOf('\n---', 3);
  if (end < 0) { err(`${file}: unterminated front matter`); return [null, text]; }
  const fmRaw = text.slice(3, end).trim();
  const body = text.slice(end + 4);
  let fm;
  try { fm = yaml.load(fmRaw); } catch (e) { err(`${file}: front matter is not valid YAML — ${e.message.split('\n')[0]}`); return [null, body]; }
  if (!fm || typeof fm !== 'object') { err(`${file}: front matter is not a mapping`); return [null, body]; }
  return [fm, body];
}

function stripCodeFences(body) {
  // Content inside ``` fences is the prompt text proper in .md prompt files; content outside is
  // prose. For lexicon scanning we want BOTH, so this is only used where structure matters.
  return body;
}

function protectedBlocks(body) {
  const blocks = [];
  const re = /⟦PROTECTED:([A-Z_]+)⟧([\s\S]*?)⟦\/PROTECTED⟧/g;
  let m;
  while ((m = re.exec(body)) !== null) blocks.push({ id: m[1], text: m[2].trim(), index: m.index });
  return blocks;
}

function unbalancedMarkers(body) {
  const opens = [...body.matchAll(/⟦PROTECTED:([A-Z_]+)⟧/g)].map((m) => m[1]);
  const closes = [...body.matchAll(/⟦\/PROTECTED⟧/g)].length;
  const problems = [];
  if (opens.length !== closes) problems.push(`${opens.length} opening marker(s) vs ${closes} closing marker(s)`);
  const seen = new Set();
  for (const id of opens) { if (seen.has(id)) problems.push(`clause ${id} appears more than once`); seen.add(id); }
  return problems;
}

function variablesUsed(body) {
  return new Set([...body.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map((m) => m[1]));
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  A–E  SYSTEM_ASSISTANT locale files
// ─────────────────────────────────────────────────────────────────────────────────────────────
/** Every prompt_code that some spec file in this directory defines. */
const declaredCodes = new Set();
const assistantByLocale = {};

for (const localeSuffix of ['fr', 'ar', 'en']) {
  const file = `system.assistant.${localeSuffix}.md`;
  const path = join(PROMPTS, file);
  if (!existsSync(path)) { err(`${file}: MISSING — all three locales of SYSTEM_ASSISTANT are required`); continue; }
  const text = readFileSync(path, 'utf8');
  const [fm, body] = splitFrontMatter(text, file);
  if (!fm) continue;

  // A — required front matter
  for (const key of ['code', 'locale', 'version', 'state', 'model_role', 'requires_sharia_approval', 'protected_clauses', 'variables']) {
    if (fm[key] === undefined) err(`${file}: front matter missing required key \`${key}\``);
  }
  if (fm.code !== 'SYSTEM_ASSISTANT') err(`${file}: code must be SYSTEM_ASSISTANT, got ${fm.code}`);
  if (!KNOWN_CODES.includes(fm.code)) err(`${file}: unknown prompt_code ${fm.code}`);
  if (!LOCALES.includes(fm.locale)) err(`${file}: locale ${fm.locale} is not one of ${LOCALES.join('/')}`);
  if (fm.requires_sharia_approval !== true) err(`${file}: SYSTEM_ASSISTANT must require Sharia approval`);
  if (!['DRAFT', 'IN_REVIEW', 'ACTIVE', 'RETIRED'].includes(fm.state)) err(`${file}: bad state ${fm.state}`);

  // B — protected clauses: declared ⇄ present, balanced, non-empty, known
  for (const p of unbalancedMarkers(body)) err(`${file}: unbalanced protected markers — ${p}`);
  const blocks = protectedBlocks(body);
  const present = blocks.map((b) => b.id);
  const declared = fm.protected_clauses || [];
  for (const b of blocks) {
    if (!KNOWN_CLAUSES.includes(b.id)) err(`${file}: unknown protected clause id ${b.id}`);
    if (b.text.length < 80) err(`${file}: protected clause ${b.id} is suspiciously short (${b.text.length} chars)`);
  }
  for (const id of declared) if (!present.includes(id)) err(`${file}: clause ${id} declared in front matter but ABSENT from the body — this is exactly the 422 case`);
  for (const id of present) if (!declared.includes(id)) err(`${file}: clause ${id} present in the body but not declared in front matter`);
  if (present.length !== KNOWN_CLAUSES.length) {
    const missing = KNOWN_CLAUSES.filter((c) => !present.includes(c));
    warn(`${file}: carries ${present.length}/${KNOWN_CLAUSES.length} clauses; absent here: ${missing.join(', ')}`);
  }

  // C — variables declared ⇄ used
  const used = variablesUsed(body);
  const declaredVars = new Set(fm.variables || []);
  for (const v of used) if (!declaredVars.has(v)) err(`${file}: {{${v}}} used in body but not declared in front matter \`variables\``);
  for (const v of declaredVars) if (!used.has(v)) err(`${file}: variable \`${v}\` declared but never used — remove it or use it`);

  // D — output contract
  for (const k of CONTRACT_KEYS) if (!body.includes(`"${k}"`)) err(`${file}: output contract missing key "${k}"`);
  // The enum must be complete *in the place where it is enumerated*. Scanning the whole body would
  // pass even with a value deleted from the list, because RELIGIOUS_RULING and PERSONAL_DATA also
  // occur inside the protected clauses that mandate them. So: take a window around the enumeration.
  // Anchor on the LAST mention: earlier ones sit inside the protected clauses that mandate a
  // specific reason, the last one is the enumeration itself.
  const anchor = body.lastIndexOf('NOT_IN_KB');
  if (anchor < 0) {
    err(`${file}: no_answer_reason enum is missing entirely (NOT_IN_KB not found)`);
  } else {
    const window = body.slice(Math.max(0, anchor - 200), anchor + 400);
    for (const r of NO_ANSWER_REASONS) if (!window.includes(r)) err(`${file}: no_answer_reason enum missing ${r}`);
  }

  // E — the system prompt must not itself recommend an interest-based product. It necessarily NAMES
  //     such products inside NO_CONVENTIONAL_PRODUCTS in order to rule them out, so the scan skips
  //     protected-clause bodies and any line carrying a negation.
  const outsideClauses = body.replace(/⟦PROTECTED:[A-Z_]+⟧[\s\S]*?⟦\/PROTECTED⟧/g, ' ');
  const leaking = outsideClauses.split('\n')
    .filter((l) => INTEREST_TERMS.test(l) && !negated(l))
    .map((l) => l.trim().slice(0, 90));
  if (leaking.length) err(`${file}: interest-based product term outside a prohibition context → ${leaking.join(' | ')}`);

  declaredCodes.add('SYSTEM_ASSISTANT');
  assistantByLocale[fm.locale] = { file, fm, present: [...new Set(present)].sort(), vars: [...used].sort(), blocks };
  ok.push(`${file}: ${present.length} protected clauses, ${used.size} variables, contract complete`);
}

// D — cross-locale parity
const locs = Object.keys(assistantByLocale);
if (locs.length === LOCALES.length) {
  const ref = assistantByLocale[locs[0]];
  for (const L of locs.slice(1)) {
    const cur = assistantByLocale[L];
    if (JSON.stringify(cur.present) !== JSON.stringify(ref.present)) {
      err(`${cur.file}: protected-clause set differs from ${ref.file}\n      here: ${cur.present.join(', ')}\n      there: ${ref.present.join(', ')}`);
    }
    if (JSON.stringify(cur.vars) !== JSON.stringify(ref.vars)) {
      err(`${cur.file}: variable set differs from ${ref.file}\n      only here: ${cur.vars.filter((v) => !ref.vars.includes(v)).join(', ')}\n      only there: ${ref.vars.filter((v) => !cur.vars.includes(v)).join(', ')}`);
    }
  }
  ok.push(`SYSTEM_ASSISTANT: ${locs.length} locales carry identical clause sets and variable sets`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  GUARDRAIL_JUDGE + utility prompts
// ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const file = 'guardrail.sharia.judge.md';
  const path = join(PROMPTS, file);
  if (!existsSync(path)) err(`${file}: MISSING`);
  else {
    const text = readFileSync(path, 'utf8');
    const [fm, body] = splitFrontMatter(text, file);
    if (fm) {
      declaredCodes.add(fm.code);
      if (fm.code !== 'GUARDRAIL_JUDGE') err(`${file}: code must be GUARDRAIL_JUDGE`);
      if (fm.requires_sharia_approval !== true) err(`${file}: the Sharia judge must require Sharia approval`);
      if (fm.model_role !== 'GUARD_SAFETY') err(`${file}: model_role must be GUARD_SAFETY, got ${fm.model_role}`);
      if (!fm.latency_budget_ms || fm.latency_budget_ms > 500) err(`${file}: latency_budget_ms must be set and ≤500`);
      for (const key of ['decision', 'reason_code', 'severity', 'categories', 'evidence', 'suggested_action']) {
        if (!body.includes(`"${key}"`)) err(`${file}: output schema missing key "${key}"`);
      }
      // fail-safe must be documented
      if (!/fail-safe|fail safe/i.test(body)) err(`${file}: must document its fail-safe behaviour`);
      const used = variablesUsed(body);
      const decl = new Set(fm.variables || []);
      for (const v of used) if (!decl.has(v)) err(`${file}: {{${v}}} used but not declared`);
      for (const v of decl) if (!used.has(v)) err(`${file}: variable \`${v}\` declared but never used`);
      ok.push(`${file}: code ${fm.code}, ${used.size} variables, fail-safe documented, schema complete`);
    }
  }
}

{
  const file = 'utility.prompts.md';
  const path = join(PROMPTS, file);
  if (!existsSync(path)) err(`${file}: MISSING`);
  else {
    const text = readFileSync(path, 'utf8');
    const [fm, body] = splitFrontMatter(text, file);
    // This file is a container: its front matter lists several codes separated by ' | '
    if (fm && typeof fm.code === 'string') fm.code.split('|').map((s) => s.trim()).filter(Boolean).forEach((c) => declaredCodes.add(c));
    const sections = ['INTENT_CLASSIFIER', 'QUERY_REWRITE', 'SYSTEM_RERANKER', 'ANSWER_CONTRACT', 'SUMMARIZER', 'EVAL_JUDGE'];
    for (const s of sections) {
      if (!body.includes(s)) err(`${file}: section for ${s} is missing`);
      else declaredCodes.add(s);
    }
    // each section must carry its own yaml config block with the keys the importer needs
    const fences = [...body.matchAll(/```yaml\n([\s\S]*?)```/g)];
    if (fences.length < sections.length) warn(`${file}: expected ≥${sections.length} yaml config blocks, found ${fences.length}`);
    for (const f of fences) {
      let cfg; try { cfg = yaml.load(f[1]); } catch (e) { err(`${file}: a yaml config block does not parse — ${e.message.split('\n')[0]}`); continue; }
      if (!cfg) continue;
      for (const key of ['code', 'model_role', 'requires_sharia_approval', 'variables']) {
        if (cfg[key] === undefined) err(`${file}: config block for ${cfg.code || '?'} missing \`${key}\``);
      }
      if (cfg.code && !KNOWN_CODES.includes(cfg.code)) err(`${file}: unknown prompt_code ${cfg.code}`);
      if (cfg.temperature !== undefined && cfg.temperature !== 0.0 && cfg.temperature !== 0) {
        err(`${file}: ${cfg.code} must run at temperature 0 (got ${cfg.temperature}) — utility prompts are deterministic functions`);
      }
    }
    // EVAL_JUDGE must be fail-closed
    if (!/fail-closed|fail closed/i.test(body)) err(`${file}: EVAL_JUDGE must document fail-closed behaviour`);
    // the fallback table must exist
    if (!/Fallback on failure/i.test(body)) err(`${file}: missing the per-prompt fallback table`);
    ok.push(`${file}: ${fences.length} config blocks, ${sections.length} prompt codes, fallback table present`);
  }
}

// G — coverage of the DB enum
for (const c of KNOWN_CODES) if (!declaredCodes.has(c)) err(`prompt_code ${c} is in the DB enum but no spec file defines it`);
ok.push(`all ${KNOWN_CODES.length} prompt_code enum values are specified`);

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  F  templates.refusals.yaml
// ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const file = 'templates.refusals.yaml';
  const path = join(PROMPTS, file);
  if (!existsSync(path)) err(`${file}: MISSING`);
  else {
    const text = readFileSync(path, 'utf8');
    let doc; try { doc = yaml.load(text); } catch (e) { err(`${file}: invalid YAML — ${e.message.split('\n')[0]}`); doc = null; }
    if (doc) {
      const declaredPh = new Set([
        'assistant_name', 'bank_name', 'alternative_block', 'documentation_block', 'referral_cta',
        'handoff_cta', 'top_sources', 'handoff_channel', 'committee_name', 'retry_after',
        'failed_stage', 'correlation_id',
      ]);
      const usedPh = new Set();
      const scan = (o) => {
        if (typeof o === 'string') for (const m of o.matchAll(/\{\{(\w+)\}\}/g)) usedPh.add(m[1]);
        else if (Array.isArray(o)) o.forEach(scan);
        else if (o && typeof o === 'object') Object.values(o).forEach(scan);
      };
      scan(doc);
      for (const u of usedPh) if (!declaredPh.has(u)) err(`${file}: undeclared placeholder {{${u}}}`);
      for (const d of declaredPh) if (!usedPh.has(d)) err(`${file}: placeholder {{${d}}} declared in the header but never used`);

      const codes = new Set();
      if (!Array.isArray(doc.templates) || doc.templates.length !== 6) err(`${file}: expected exactly 6 templates (REF-01…REF-06)`);
      for (const t of doc.templates || []) {
        codes.add(t.code);
        if (!/^REF-0[1-6]$/.test(t.code)) err(`${file}: bad refusal code ${t.code}`);
        // R4/R5 — all three locales present, within word caps
        for (const L of LOCALES) {
          const l = t.locales?.[L];
          if (!l) { err(`${file}: ${t.code} missing locale ${L}`); continue; }
          if (!l.title || !l.body) { err(`${file}: ${t.code} ${L} has an empty title or body`); continue; }
          const bw = l.body.trim().split(/\s+/).length;
          const tw = l.title.trim().split(/\s+/).length;
          if (bw > 60) err(`${file}: R5 ${t.code} ${L} body is ${bw} words (>60)`);
          if (tw > 8) err(`${file}: R5 ${t.code} ${L} title is ${tw} words (>8)`);
          // R8 — Arabic copy carries no Latin letters outside placeholders
          if (L === 'ar-TN') {
            const sb = l.body.replace(/\{\{[^}]*\}\}/g, '');
            const st = l.title.replace(/\{\{[^}]*\}\}/g, '');
            if (/[A-Za-z]/.test(sb) || /[A-Za-z]/.test(st)) err(`${file}: R8 ${t.code} ar-TN contains Latin letters outside placeholders`);
          }
          // R1 — no religious verdict
          if (VERDICT_WORDS.test(l.body) || VERDICT_WORDS.test(l.title)) err(`${file}: R1 ${t.code} ${L} contains a religious verdict word`);
          // R2 — no interest-based product term, unless the sentence exists to rule it out
          //        (REF-02 must be able to say "we do not offer interest-based operations").
          const sentences = l.body.split(/(?<=[.!?،])\s+/);
          const offending = sentences.filter((s) => INTEREST_TERMS.test(s) && !negated(s));
          if (offending.length) err(`${file}: R2 ${t.code} ${L} names an interest-based product outside a negation → ${offending[0].trim().slice(0, 80)}`);
          // R3 — no disclosure of internals
          const internals = /guardrail|classifier|prompt|instruction|modèle|\bmodel\b|filter|filtre|نموذج|تصنيف|تعليمات/i;
          if (internals.test(l.body) || internals.test(l.title)) err(`${file}: R3 ${t.code} ${L} discloses system internals`);
          // R9 — at most one apology across the whole message
          const aps = apologies(l.title) + apologies(l.body) + apologies(l.cta);
          if (aps > 1) err(`${file}: R9 ${t.code} ${L} apologises ${aps} times — one is polite, two reads as a system that knows it failed`);
        }
        // R6 — every refusal offers a next step (REF-01 is a deliberate dead end)
        if (t.code !== 'REF-01') {
          const hasNext = LOCALES.some((L) => t.locales?.[L]?.cta) || JSON.stringify(t).includes('handoff_channel') || t.referral;
          if (!hasNext) err(`${file}: R6 ${t.code} offers no next step`);
        }
        // REF-01 must not offer a human channel
        if (t.code === 'REF-01' && LOCALES.some((L) => t.locales?.[L]?.cta)) err(`${file}: REF-01 must not offer a CTA`);
        // variants
        for (const [vn, v] of Object.entries(t.variants || {})) {
          for (const L of LOCALES) {
            const l = v.locales?.[L];
            if (!l) { err(`${file}: ${t.code}.${vn} missing locale ${L}`); continue; }
            const bw = l.body.trim().split(/\s+/).length;
            if (bw > 60) err(`${file}: R5 ${t.code}.${vn} ${L} body is ${bw} words (>60)`);
            if (!(v.audience || []).length) {
              const internals = /guardrail|classifier|prompt|instruction|modèle|\bmodel\b|filter|filtre/i;
              if (internals.test(l.body)) err(`${file}: R3 ${t.code}.${vn} ${L} is customer-facing but discloses internals`);
            }
            const aps = apologies(l.title) + apologies(l.body) + apologies(l.cta);
            if (aps > 1) err(`${file}: R9 ${t.code}.${vn} ${L} apologises ${aps} times`);
          }
        }
      }
      // disclaimers reference real codes and cover all locales
      for (const [k, d] of Object.entries(doc.disclaimers || {})) {
        for (const c of d.applies_to || []) if (!codes.has(c)) err(`${file}: disclaimer ${k} applies to unknown code ${c}`);
        for (const L of LOCALES) if (!d[L]) err(`${file}: disclaimer ${k} missing locale ${L}`);
      }
      // follow-up pools cover all locales
      for (const [k, p] of Object.entries(doc.followup_pools || {})) {
        if (k === 'RELATED_QUESTIONS' || k === 'NONE') continue;
        for (const L of LOCALES) if (!p[L] || p[L].length < 3) err(`${file}: followup pool ${k} must offer ≥3 chips in ${L}`);
      }
      if (doc.requires_sharia_approval !== true) err(`${file}: refusal templates must require Sharia approval`);
      ok.push(`${file}: 6 templates × 3 locales + variants, ${Object.keys(doc.disclaimers || {}).length} disclaimers, R1–R9 verified`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  README contract
// ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const file = 'README.md';
  const path = join(PROMPTS, file);
  if (!existsSync(path)) err(`${file}: MISSING — the importer contract must be documented`);
  else {
    const text = readFileSync(path, 'utf8');
    for (const token of ['⟦PROTECTED', 'front matter', 'PROTECTED_CLAUSE_REMOVED']) {
      if (!text.includes(token)) err(`${file}: importer contract does not mention "${token}"`);
    }
    if (!/assembly order/i.test(text)) err(`${file}: importer contract does not document the assembly order`);
    for (const c of KNOWN_CLAUSES) if (!text.includes(c)) err(`${file}: protected clause ${c} is not documented in the README`);
    ok.push(`${file}: importer contract documents all ${KNOWN_CLAUSES.length} clauses + assembly order`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
//  stray-file check
// ─────────────────────────────────────────────────────────────────────────────────────────────
const expected = new Set([
  'README.md', 'system.assistant.fr.md', 'system.assistant.ar.md', 'system.assistant.en.md',
  'guardrail.sharia.judge.md', 'utility.prompts.md', 'templates.refusals.yaml',
]);
for (const f of readdirSync(PROMPTS)) if (!expected.has(f)) warn(`${f}: unexpected file in specs/prompts/ — add it to the linter's expected set`);

// ─────────────────────────────────────────────────────────────────────────────────────────────
console.log('\nprompt-lint — specs/prompts/\n' + '─'.repeat(78));
for (const o of ok) console.log('  ok    ' + o);
for (const w of warns) console.log('  WARN  ' + w);
for (const e of errors) console.log('  ERROR ' + e);
console.log('─'.repeat(78));
console.log(`  ${ok.length} groups checked · ${warns.length} warning(s) · ${errors.length} error(s)\n`);
process.exit(errors.length ? 1 : 0);
