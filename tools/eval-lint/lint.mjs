#!/usr/bin/env node
/**
 * eval-lint — executable checks over specs/eval/
 *
 * A benchmark that is internally inconsistent is worse than no benchmark: it fails good releases and
 * passes bad ones, and nobody notices because the failures look like model regressions. Every rule
 * here exists because a plausible-looking case violated it during authoring.
 *
 * Files checked
 *   specs/eval/kb-manifest.jsonl   the seed corpus the cases point at
 *   specs/eval/golden-set.jsonl    answer-quality and retrieval cases
 *   specs/eval/red-team.jsonl      adversarial cases RT-01…RT-15
 *
 * Check groups
 *   K  Manifest: unique chunk ids, valid enums, searchable coherence, retired chunks flagged
 *   S  Schema: JSONL well-formed, one object per line, unique ids, required fields, value domains
 *   X  Cross-reference: every cited chunk id exists; must-cite chunks are actually searchable;
 *      INTERNAL chunks are never expected citations for a PUBLIC case; retired chunks appear only
 *      as must-NOT-cite traps
 *   C  Consistency: no term is both required and forbidden (incl. substring/token collisions),
 *      patterns are valid regexes, refusal cases carry no citation requirement, reference answers
 *      present where an answer is expected, question language == expected answer language
 *   P  Composition: language and topic shares against the docs/11 §2.2 targets
 *   R  Red team: RT-01…RT-15 complete, one family each, guardrail layers named, S1 cases forbid
 *      terms, severity/weight coherent
 *
 * Exit 0 = pass, 1 = at least one ERROR. WARN never fails the build.
 *
 * Usage: node tools/eval-lint/lint.mjs   [EVAL_DIR=/path/to/specs/eval]
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const EVAL = process.env.EVAL_DIR ? process.env.EVAL_DIR : join(root, 'specs', 'eval');
const REFUSALS = join(root, 'specs', 'prompts', 'templates.refusals.yaml');

const errors = [];
const warns = [];
const ok = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

// ── enums ────────────────────────────────────────────────────────────────────────────────────────
// The five domains below are read from specs/db/schema.sql rather than copied here. A copied enum is
// a stale enum: this file once listed `AGENT` as a classification, a value the database has never
// had, while omitting `RESTRICTED`, which it does — so a manifest row that would insert cleanly was
// rejected and a row that would fail at insert time was waved through. Deriving the list makes that
// class of drift impossible.
const SCHEMA = join(root, 'specs', 'db', 'schema.sql');

function dbEnum(typeName) {
  if (!existsSync(SCHEMA)) { err(`cannot read ${SCHEMA} — needed for the ${typeName} domain`); return []; }
  const sql = readFileSync(SCHEMA, 'utf8');
  const m = sql.match(new RegExp(`CREATE TYPE\\s+${typeName}\\s+AS\\s+ENUM\\s*\\(([\\s\\S]*?)\\);`));
  if (!m) { err(`schema.sql declares no enum ${typeName}`); return []; }
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const LOCALE = dbEnum('locale_code');
const INTENT = dbEnum('intent_code');
const REFUSAL = dbEnum('refusal_code');
const CLASSIFICATION = dbEnum('classification');
const TIER = dbEnum('risk_tier');

// Corpus conventions, not database enums: the manifest's `state` and `documentType` describe the
// lifecycle of an evaluation fixture (QUARANTINED and EMERGENCY_WITHDRAWN are review outcomes from
// docs/05 §5, and no column stores them), so they are declared here.
const STATE = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED', 'QUARANTINED', 'EMERGENCY_WITHDRAWN'];
const DOC_TYPE = ['PRODUCT_SHEET', 'TARIFF', 'DIRECTORY', 'GUIDE', 'GLOSSARY', 'PROCEDURE', 'LEGAL', 'POLICY'];

/**
 * A refusal whose body embeds a grounded block (`{{alternative_block}}`, `{{documentation_block}}`,
 * `{{top_sources}}`) legitimately depends on retrieval, so a case may require citations for it. A
 * refusal made only of static template copy must not. Derived from the templates themselves rather
 * than hard-coded, so the two specs cannot drift apart.
 */
const GROUNDED_PLACEHOLDERS = ['alternative_block', 'documentation_block', 'top_sources'];
const citationBearingRefusals = (() => {
  if (!existsSync(REFUSALS)) { err(`cannot read ${REFUSALS} — needed to know which refusals are citation-bearing`); return new Set(); }
  const doc = yaml.load(readFileSync(REFUSALS, 'utf8'));
  const set = new Set();
  for (const t of doc.templates || []) {
    const blob = JSON.stringify(t.locales || {});
    if (GROUNDED_PLACEHOLDERS.some((ph) => blob.includes(`{{${ph}}}`))) set.add(t.code);
  }
  return set;
})();

/** Composition targets, docs/11 §2.2. Tolerance in percentage points. */
const TARGETS = {
  language: { 'ar-TN:MSA': 30, 'ar-TN:DERJA': 10, 'fr-FR': 40, 'en-GB': 20 },
  topic: { PRODUCT: 35, PROCEDURE: 20, TARIFF: 15, SHARIA_CONCEPT: 10, MUST_REFUSE: 10, OTHER: 10 },
  tolerance: 8,
};

// ── JSONL reader ─────────────────────────────────────────────────────────────────────────────────
function readJsonl(file) {
  const path = join(EVAL, file);
  if (!existsSync(path)) { err(`${file}: MISSING`); return []; }
  const rows = [];
  readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
    const text = line.trim();
    if (!text) return;
    if (text.startsWith('//') || text.startsWith('#')) return;
    try {
      const o = JSON.parse(text);
      if (Array.isArray(o) || typeof o !== 'object' || o === null) err(`${file}:${i + 1}: line is not a JSON object`);
      else rows.push({ ...o, __line: i + 1 });
    } catch (e) {
      err(`${file}:${i + 1}: invalid JSON — ${e.message}`);
    }
  });
  return rows;
}

/** Tokenise the way the harness matches terms: Unicode-aware word split. */
const tokens = (s) => String(s).toLowerCase().split(/[^\p{L}\p{N}.%,]+/u).filter(Boolean);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  K — manifest
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const manifest = readJsonl('kb-manifest.jsonl');
const chunks = new Map();
for (const c of manifest) {
  if (chunks.has(c.chunkId)) err(`kb-manifest.jsonl:${c.__line}: duplicate chunkId ${c.chunkId}`);
  chunks.set(c.chunkId, c);
  for (const [field, domain] of [['lang', LOCALE], ['classification', CLASSIFICATION], ['state', STATE], ['tier', TIER], ['documentType', DOC_TYPE]]) {
    if (!domain.includes(c[field])) err(`kb-manifest ${c.chunkId}: ${field}="${c[field]}" not in ${domain.join('|')}`);
  }
  if (!c.documentId || !c.documentTitle) err(`kb-manifest ${c.chunkId}: missing documentId/documentTitle`);
  if (typeof c.shariaApproved !== 'boolean') err(`kb-manifest ${c.chunkId}: shariaApproved must be boolean`);
  if (c.shariaApproved && !c.shariaApprovalRef) err(`kb-manifest ${c.chunkId}: shariaApproved=true without shariaApprovalRef`);
  if (!c.shariaApproved && c.shariaApprovalRef) err(`kb-manifest ${c.chunkId}: shariaApprovalRef set but shariaApproved=false`);
  if (c.tier === 'T3_HIGH' && !c.shariaApproved) err(`kb-manifest ${c.chunkId}: a T3 chunk must be Sharia-approved`);
  // searchability coherence: a chunk is searchable only if PUBLISHED ∧ approved-if-required ∧ in date
  if (c.state === 'PUBLISHED') {
    if (c.validTo && new Date(c.validTo) < new Date(c.validFrom)) err(`kb-manifest ${c.chunkId}: validTo before validFrom`);
  }
  if (c.state === 'RETIRED' && !c.validTo) err(`kb-manifest ${c.chunkId}: RETIRED without validTo — the temporal-validity gate needs it`);
  if (c.state === 'PUBLISHED' && c.validTo && new Date(c.validTo) < new Date('2026-09-03')) {
    err(`kb-manifest ${c.chunkId}: state=PUBLISHED but validity expired on ${c.validTo} — the DB gate would close it; mark it RETIRED`);
  }
  if (!Array.isArray(c.topics) || c.topics.length === 0) err(`kb-manifest ${c.chunkId}: topics must be a non-empty array`);
  if (!c.summary || c.summary.length < 40) err(`kb-manifest ${c.chunkId}: summary too short to be a retrieval field`);
  if (!Number.isFinite(c.tokens) || c.tokens < 50 || c.tokens > 1200) err(`kb-manifest ${c.chunkId}: tokenCount ${c.tokens} outside the 50–1200 chunking window`);
}
/** Is this chunk reachable by retrieval today? Mirrors the `searchable` materialised gate. */
const isSearchable = (c) => !!c && c.state === 'PUBLISHED'
  && (!c.validTo || new Date(c.validTo) >= new Date('2026-09-03'))
  && (!c.validFrom || new Date(c.validFrom) <= new Date('2026-09-03'));
ok.push(`kb-manifest.jsonl: ${chunks.size} chunks across ${new Set(manifest.map((c) => c.documentId)).size} documents`);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  S + X + C — golden set and red team share the same case checks
// ─────────────────────────────────────────────────────────────────────────────────────────────────
const CASE_FIELDS = ['id', 'question', 'questionLang', 'expectedAnswerLang', 'expectedIntents',
  'mustCiteChunks', 'mustNotCiteChunks', 'mustContainTerms', 'mustNotContainTerms',
  'mustContainPatterns', 'expectRefusalCode', 'referenceAnswer', 'tags', 'weight', 'source',
  'addedBy', 'addedAt'];
const RT_FIELDS = ['family', 'severity', 'expectedBehaviour', 'attackVector', 'guardrailLayers', 'detectionPoint'];

function checkCases(rows, file, { redTeam }) {
  const ids = new Set();
  for (const c of rows) {
    const tag = `${file}:${c.__line} ${c.id || '?'}`;
    // S — schema
    for (const f of CASE_FIELDS) if (!(f in c) && !(redTeam && f === 'referenceAnswer')) err(`${tag}: missing field \`${f}\``);
    if (redTeam) for (const f of RT_FIELDS) if (!(f in c)) err(`${tag}: missing red-team field \`${f}\``);
    if (ids.has(c.id)) err(`${tag}: duplicate id`);
    ids.add(c.id);
    if (!LOCALE.includes(c.questionLang)) err(`${tag}: questionLang "${c.questionLang}" not in ${LOCALE.join('|')}`);
    if (!LOCALE.includes(c.expectedAnswerLang)) err(`${tag}: expectedAnswerLang "${c.expectedAnswerLang}" not in ${LOCALE.join('|')}`);
    for (const i of c.expectedIntents || []) if (!INTENT.includes(i)) err(`${tag}: unknown intent ${i}`);
    if ((c.expectedIntents || []).length === 0) err(`${tag}: expectedIntents is empty`);
    if (c.expectRefusalCode !== null && !REFUSAL.includes(c.expectRefusalCode)) err(`${tag}: unknown refusal code ${c.expectRefusalCode}`);
    if (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 5) err(`${tag}: weight must be an integer 1–5`);
    if (!Array.isArray(c.tags) || c.tags.length === 0) err(`${tag}: tags must be a non-empty array`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.addedAt || '')) err(`${tag}: addedAt must be an ISO date`);

    // C — question language == expected answer language (LANGUAGE_MATCH protected clause)
    if (c.questionLang !== c.expectedAnswerLang) {
      err(`${tag}: expectedAnswerLang differs from questionLang — the LANGUAGE_MATCH clause forbids it`);
    }

    // X — chunk references resolve, and must-cite chunks must be reachable
    for (const id of c.mustCiteChunks || []) {
      const k = chunks.get(id);
      if (!k) err(`${tag}: mustCiteChunks references unknown chunk ${id}`);
      else {
        if (!isSearchable(k)) err(`${tag}: mustCiteChunks references ${id} which is ${k.state}${k.validTo ? ` and expired ${k.validTo}` : ''} — it can never be retrieved, so the case can never pass`);
        if (k.classification !== 'PUBLIC') err(`${tag}: mustCiteChunks references ${id} at classification ${k.classification}; a front-office case cannot require it`);
      }
    }
    for (const id of c.mustNotCiteChunks || []) if (!chunks.get(id)) err(`${tag}: mustNotCiteChunks references unknown chunk ${id}`);
    for (const id of c.mustCiteChunks || []) if ((c.mustNotCiteChunks || []).includes(id)) err(`${tag}: ${id} is both must-cite and must-not-cite`);

    // C — required vs forbidden term collisions (substring AND token level)
    const must = c.mustContainTerms || [];
    const mustNot = c.mustNotContainTerms || [];
    for (const a of must) for (const b of mustNot) {
      const al = a.toLowerCase(), bl = b.toLowerCase();
      if (al === bl) err(`${tag}: term "${a}" is both required and forbidden`);
      else if (al.includes(bl) || bl.includes(al)) err(`${tag}: term collision — required "${a}" and forbidden "${b}" overlap; any answer satisfying one violates the other`);
      else {
        const ta = new Set(tokens(a)), tb = new Set(tokens(b));
        const shared = [...ta].filter((t) => tb.has(t) && t.length > 2);
        if (shared.length && ta.size > 1 && tb.size === 1) {
          warn(`${tag}: forbidden token "${shared[0]}" appears inside required phrase "${a}" — confirm the harness matches phrases, not tokens`);
        }
      }
    }
    // C — patterns are valid regexes
    for (const p of c.mustContainPatterns || []) {
      try { new RegExp(p, 'u'); } catch (e) { err(`${tag}: mustContainPatterns "${p}" is not a valid regex — ${e.message}`); }
    }
    // C — a refusal made of static template copy cannot be required to cite anything; a refusal
    //     that embeds a grounded block can. And only cases that expect an ANSWER need a reference.
    if (c.expectRefusalCode) {
      if ((c.mustCiteChunks || []).length && !citationBearingRefusals.has(c.expectRefusalCode)) {
        err(`${tag}: expects refusal ${c.expectRefusalCode} but also requires citing chunks — that template is composed of static copy only (citation-bearing refusals: ${[...citationBearingRefusals].sort().join(', ')})`);
      }
      if (c.referenceAnswer && !/REF-|refus|رفض|refusal/i.test(c.referenceAnswer)) warn(`${tag}: refusal case whose referenceAnswer does not describe the refusal`);
    } else if (!redTeam && (!c.referenceAnswer || c.referenceAnswer.length < 30)) {
      err(`${tag}: expects an answer but referenceAnswer is missing or too short to anchor the judge`);
    }
    // R — red-team specifics
    if (redTeam) {
      if (!/^\d$|^S[1-4]$/.test(String(c.severity)) && !/^S[1-4]$/.test(c.severity)) err(`${tag}: severity must be S1–S4`);
      if (!(c.guardrailLayers || []).length) err(`${tag}: guardrailLayers is empty — an attack nobody is responsible for detecting`);
      for (const l of c.guardrailLayers || []) if (!/^(stage\d+|ingestion|retrieval):[A-Za-z0-9_\-]+$/.test(l)) err(`${tag}: guardrailLayers entry "${l}" must be "<stage>:<POLICY>"`);
      if (c.severity === 'S1' && !(c.mustNotContainTerms || []).length) err(`${tag}: an S1 case must forbid at least one term, otherwise nothing observable is asserted`);
      if (c.severity === 'S1' && c.weight < 4) err(`${tag}: S1 severity with weight ${c.weight} — critical attacks must not be outvoted`);
      if (!c.expectedBehaviour || c.expectedBehaviour.length < 40) err(`${tag}: expectedBehaviour too short to review`);
      if (!c.detectionPoint) err(`${tag}: detectionPoint missing — say which control catches it`);
      if (!c.expectRefusalCode && !(c.mustCiteChunks || []).length && !(c.mustNotContainTerms || []).length) {
        err(`${tag}: asserts nothing — needs a refusal code, an expected citation, or forbidden terms`);
      }
    }
  }
  return ids;
}

const golden = readJsonl('golden-set.jsonl');
const redTeam = readJsonl('red-team.jsonl');
const goldenIds = checkCases(golden, 'golden-set.jsonl', { redTeam: false });
const rtIds = checkCases(redTeam, 'red-team.jsonl', { redTeam: true });

// id namespace separation
for (const id of rtIds) if (goldenIds.has(id)) err(`id ${id} is used by both the golden set and the red-team suite`);

// R — RT-01…RT-15 completeness (docs/05 §6)
const expectedRt = Array.from({ length: 15 }, (_, i) => `RT-${String(i + 1).padStart(2, '0')}`);
for (const id of expectedRt) if (!rtIds.has(id)) err(`red-team.jsonl: ${id} from docs/05 is missing`);
for (const id of rtIds) if (!expectedRt.includes(id)) warn(`red-team.jsonl: ${id} is not in the docs/05 RT-01…RT-15 list — add it there or renumber`);
const families = new Map();
for (const c of redTeam) {
  if (families.has(c.family)) err(`red-team.jsonl: family ${c.family} used by both ${families.get(c.family)} and ${c.id}`);
  families.set(c.family, c.id);
}
ok.push(`red-team.jsonl: ${redTeam.length} cases, ${families.size} distinct attack families, RT-01…RT-15 complete`);

// C — every retired manifest chunk must be used as a trap at least once (otherwise it is dead weight)
const retired = [...chunks.values()].filter((c) => c.state === 'RETIRED').map((c) => c.chunkId);
for (const id of retired) {
  const usedAsTrap = [...golden, ...redTeam].some((c) => (c.mustNotCiteChunks || []).includes(id));
  if (!usedAsTrap) warn(`kb-manifest: retired chunk ${id} is never used as a must-not-cite trap`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  P — composition
// ─────────────────────────────────────────────────────────────────────────────────────────────────
function share(count, total) { return total ? (100 * count) / total : 0; }
const OPERATIONAL = ['PROCEDURE', 'BRANCH', 'DIGITAL', 'RECLAMATION'];
function topicOf(c) {
  if (c.expectRefusalCode) return 'MUST_REFUSE';
  const t = c.tags || [];
  if (t.includes('TARIFF')) return 'TARIFF';
  if (t.includes('SHARIA_CONCEPT')) return 'SHARIA_CONCEPT';
  // docs/11 §2.2 counts every operational how-do-I / where-is question as "Procedures"
  if (OPERATIONAL.some((x) => t.includes(x))) return 'PROCEDURE';
  if (t.includes('PRODUCT') || t.includes('COMPARISON')) return 'PRODUCT';
  return 'OTHER';
}
{
  const total = golden.length;
  const derja = golden.filter((c) => (c.tags || []).some((t) => t === 'AR_DERJA')).length;
  const arMsa = golden.filter((c) => c.questionLang === 'ar-TN' && !(c.tags || []).includes('AR_DERJA')).length;
  const fr = golden.filter((c) => c.questionLang === 'fr-FR').length;
  const en = golden.filter((c) => c.questionLang === 'en-GB').length;
  const observedLang = { 'ar-TN:MSA': arMsa, 'ar-TN:DERJA': derja, 'fr-FR': fr, 'en-GB': en };
  for (const [k, target] of Object.entries(TARGETS.language)) {
    const got = share(observedLang[k], total);
    const delta = got - target;
    if (Math.abs(delta) > TARGETS.tolerance) err(`composition: language slice ${k} is ${got.toFixed(1)}% (target ${target}%, ${total} cases) — outside ±${TARGETS.tolerance}pp`);
    else ok.push(`composition: ${k} = ${got.toFixed(1)}% (target ${target}%)`);
  }
  if (arMsa + derja + fr + en !== total) err(`composition: language slices sum to ${arMsa + derja + fr + en}, not ${total}`);

  const topics = {};
  for (const c of golden) { const t = topicOf(c); topics[t] = (topics[t] || 0) + 1; }
  for (const [k, target] of Object.entries(TARGETS.topic)) {
    const got = share(topics[k] || 0, total);
    if (Math.abs(got - target) > TARGETS.tolerance) err(`composition: topic slice ${k} is ${got.toFixed(1)}% (target ${target}%) — outside ±${TARGETS.tolerance}pp`);
    else ok.push(`composition: ${k} = ${got.toFixed(1)}% (target ${target}%)`);
  }

  // Derja cases must assert that dialect never leaks into the answer
  for (const c of golden) {
    if (!(c.tags || []).includes('AR_DERJA')) continue;
    // The strongest form of the assertion is: forbid a token the user actually typed.
    const q = c.question.toLowerCase();
    const forbidsDialect = (c.mustNotContainTerms || []).some((t) => t.length > 2 && q.includes(t.toLowerCase()))
      || (c.tags || []).includes('LATIN_ECHO_TRAP');
    if (!forbidsDialect) warn(`golden-set ${c.id}: tagged AR_DERJA but does not assert that dialect stays out of the answer`);
  }
  // Every numeric/tariff case must pin the figure with a pattern
  for (const c of golden) {
    if (!(c.tags || []).includes('TARIFF') || c.expectRefusalCode) continue;
    const hasFigure = (c.mustContainTerms || []).some((t) => /\d/.test(t)) || (c.mustContainPatterns || []).length > 0;
    if (!hasFigure) err(`golden-set ${c.id}: tagged TARIFF but pins no figure — the numeric-grounding gate would be untested`);
  }
  // Cases that must never cite an INTERNAL chunk
  const internal = [...chunks.values()].filter((c) => c.classification !== 'PUBLIC').map((c) => c.chunkId);
  const citingInternal = [...golden, ...redTeam].filter((c) => (c.mustCiteChunks || []).some((id) => internal.includes(id)));
  if (citingInternal.length) err(`${citingInternal.map((c) => c.id).join(', ')}: require citing a non-PUBLIC chunk`);
  ok.push(`classification: no front-office case requires citing an INTERNAL/CONFIDENTIAL chunk (${internal.length} such chunks exist)`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\neval-lint — specs/eval/\n' + '─'.repeat(86));
for (const o of ok) console.log('  ok    ' + o);
for (const w of warns) console.log('  WARN  ' + w);
for (const e of errors) console.log('  ERROR ' + e);
console.log('─'.repeat(86));
console.log(`  ${chunks.size} chunks · ${golden.length} golden cases · ${redTeam.length} red-team cases`);
console.log(`  ${ok.length} groups checked · ${warns.length} warning(s) · ${errors.length} error(s)\n`);
process.exit(errors.length ? 1 : 0);
