#!/usr/bin/env node
/**
 * seed-gen — generates the Flyway content migrations in specs/db/seed/ from their authored sources.
 *
 * The SQL in specs/db/seed/ is a BUILD ARTEFACT. Do not edit it by hand: edit the source and
 * regenerate. Every file carries a header naming the sources it was generated from, and `--check`
 * regenerates in memory and fails if the committed SQL differs, so a source edit that was never
 * regenerated cannot reach main.
 *
 *   node generate.mjs            write specs/db/seed/V900…V903
 *   node generate.mjs --check    exit 1 if the committed SQL is stale
 *   node generate.mjs --only V903
 *
 * Why generated rather than handwritten: 97 glossary terms and 366 dialect mappings, each with
 * trilingual text and array columns, is roughly 500 INSERT rows. Handwritten, they drift from the
 * documents the moment anyone edits a document — and the drift is invisible, because both files
 * still look correct in review.
 *
 * SOURCES                                                    TARGET
 *   docs/glossary-trilingual.md            §1–§5   ────────►  term_glossary          (V900)
 *   specs/eval/kb-manifest.jsonl           docType ────────►  collection             (V900)
 *   docs/04-rag-pipeline.md                §15     ────────►  collection.chunking_policy
 *   specs/prompts/*.md                     frontmatter ────►  prompt_template/version (V901)
 *   docs/07-security-iam-compliance.md     §6.1    ────────►  guardrail_policy       (V902)
 *   specs/prompts/templates.refusals.yaml  all     ────────►  message_bundle         (V902)
 *   specs/config/application.yaml          guardrails ─────►  guardrail_policy.params
 *   specs/i18n/derja-msa.json              mappings ───────►  derja_msa_map          (V903)
 *
 * NOT seeded here, deliberately: model_config and retrieval_config belong to
 * `SeedOnEmptyDatabaseRunner`, which reads `albaraka.seed` from application.yaml on an empty
 * database (specs/config/README §"The seed block"). Two writers for one row is two truths, so V902
 * must not touch those tables — `tools/seed-lint` fails the build if it does.
 *
 * Deterministic output: every surrogate key is a UUIDv5 of the row's natural key under a fixed
 * project namespace, so regeneration is byte-identical and the same row has the same id in dev, UAT
 * and production. Nothing in these files calls now() for a value that would otherwise differ
 * between runs; created_at is left to the column DEFAULT.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const OUT = join(root, 'specs', 'db', 'seed');

const read = (p) => readFileSync(join(root, p), 'utf8');

/** Reads a CREATE TYPE … AS ENUM body out of schema.sql. The enum is the schema's, not ours. */
function enumValues(name) {
  const sql = read('specs/db/schema.sql');
  const m = sql.match(new RegExp(`CREATE TYPE ${name}\\s+AS ENUM\\s*\\(([\\s\\S]*?)\\);`));
  if (!m) throw new Error(`schema.sql declares no enum ${name}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** The schema the DDL creates. Hardcoding it is how a seed ends up inserting into `public`. */
const SCHEMA = (() => {
  const m = read('specs/db/schema.sql').match(/CREATE SCHEMA IF NOT EXISTS (\w+)/);
  if (!m) throw new Error('schema.sql declares no CREATE SCHEMA — cannot target the seed');
  return m[1];
})();

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  Deterministic ids and SQL literals
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Fixed namespace for every seeded surrogate key. Arbitrary, committed, never reused elsewhere. */
const SEED_NAMESPACE = 'a1ba4a4a-0000-5000-8000-000000000000';

/** UUIDv5 (SHA-1, RFC 4122) of `name` under the seed namespace. */
export function uuidv5(name, ns = SEED_NAMESPACE) {
  const nsBytes = Buffer.from(ns.replace(/-/g, ''), 'hex');
  const digest = createHash('sha1').update(Buffer.concat([nsBytes, Buffer.from(name, 'utf8')])).digest();
  const b = Buffer.from(digest.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;                       // version 5
  b[8] = (b[8] & 0x3f) | 0x80;                       // RFC 4122 variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined ? 'NULL' : String(v));
const bool = (v) => (v ? 'true' : 'false');
const arr = (list) => (!list || !list.length ? `'{}'::text[]` : `ARRAY[${list.map(q).join(', ')}]::text[]`);
const jb = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

/** One INSERT per `per` rows: reviewable diffs without 500 separate statements. */
function insert(table, columns, rows, per = 8) {
  if (!rows.length) return `-- (no rows)\n`;
  const out = [];
  for (let i = 0; i < rows.length; i += per) {
    const slice = rows.slice(i, i + per);
    out.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES`);
    out.push(slice.map((r, k) => `  (${r.join(', ')})${k === slice.length - 1 ? ';' : ','}`).join('\n'));
  }
  return out.join('\n') + '\n';
}

/** Wraps generated SQL so a reviewer sees provenance before rows. */
function migration(file, title, sources, notes, body) {
  const rule = '─'.repeat(100);
  const src = sources.map((s) => `--   ${s}`).join('\n');
  const note = notes.length ? `\n--\n${notes.map((s) => `-- ${s}`).join('\n')}\n` : '';
  return `-- ${rule}
--  ${file} — ${title}
-- ${rule}
--  GENERATED FILE. Do not edit by hand.
--
--  Regenerate with:  node tools/seed-gen/generate.mjs
--  Staleness check:  node tools/seed-gen/generate.mjs --check     (runs in CI)
--
--  Sources of truth:
${src}
--${note}
--  Surrogate keys are UUIDv5 of the row's natural key under namespace ${SEED_NAMESPACE},
--  so regeneration is byte-identical and a row has the same id in every environment.
--
--  Inserts are plain, not ON CONFLICT DO NOTHING: a Flyway versioned migration runs exactly once,
--  and a natural-key collision here means the source is wrong. Failing loudly at migrate time is
--  better than silently seeding one row fewer.
-- ${rule}

${body}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  V900 — collections and the trilingual glossary
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** docs/04 §15 names the content types; the manifest's documentType values must each have a home,
 *  because document.collection_id is NOT NULL. */
const COLLECTIONS = [
  // code,            documentType,  names (fr / ar / en),                      chunking strategy, tokens, rule
  { code: 'PRODUCT_SHEETS', docType: 'PRODUCT_SHEET', fr: 'Fiches produits', ar: 'بطاقات المنتجات', en: 'Product sheets',
    strategy: 'HEADING_BLOCK', min: 400, max: 700, rule: 'heading-aware; one chunk per condition block (éligibilité, montant, durée, marge, garanties, pièces)' },
  { code: 'TARIFFS', docType: 'TARIFF', fr: 'Barèmes et tarifs', ar: 'التعريفات البنكية', en: 'Tariff booklets',
    strategy: 'TABLE_ROW', min: 80, max: 200, rule: 'one row = one chunk, never split a table row; the header is repeated in every chunk' },
  { code: 'PROCEDURES', docType: 'PROCEDURE', fr: 'Procédures', ar: 'الإجراءات', en: 'Procedures',
    strategy: 'STEP_SEQUENCE', min: 300, max: 600, rule: 'one numbered step sequence per chunk; steps are never split mid-sequence' },
  { code: 'REGULATION', docType: 'LEGAL', fr: 'Textes réglementaires', ar: 'النصوص التشريعية والترتيبية', en: 'Regulation',
    strategy: 'ARTICLE', min: 200, max: 800, rule: 'per article, with the article number carried in heading_path (loi 2016-48, circulaires BCT)' },
  { code: 'DIRECTORY', docType: 'DIRECTORY', fr: 'Annuaire et agences', ar: 'دليل الوكالات', en: 'Branch directory',
    strategy: 'TABLE_ROW', min: 80, max: 200, rule: 'one row = one chunk; an agency is retrieved whole or not at all' },
  { code: 'GLOSSARY', docType: 'GLOSSARY', fr: 'Glossaire', ar: 'المعجم', en: 'Glossary',
    strategy: 'ENTRY', min: 100, max: 300, rule: 'one term = one chunk, so a definition is never split from its term' },
  { code: 'GUIDES', docType: 'GUIDE', fr: 'Guides clients', ar: 'أدلة الحرفاء', en: 'Customer guides',
    strategy: 'HEADING_BLOCK', min: 400, max: 700, rule: 'heading-aware; one chunk per question or section' },
  // The two content types docs/04 §15 defines that the current manifest has no document for. They are
  // seeded because a collection cannot be added by an ingestion job, and a Sharia note arriving
  // before an administrator created its collection would fail on a NOT NULL foreign key.
  { code: 'SHARIA_NOTES', docType: null, fr: 'Notes et avis du Comité', ar: 'ملاحظات وآراء اللجنة', en: 'Sharia notes and committee opinions',
    strategy: 'PARAGRAPH', min: 500, max: 900, rule: 'paragraph-respecting with larger context; the ruling reference is kept intact' },
  { code: 'FAQ', docType: null, fr: 'Questions fréquentes', ar: 'الأسئلة الشائعة', en: 'FAQ',
    strategy: 'QA_PAIR', min: 100, max: 300, rule: 'question + answer = one chunk; the question is embedded too, which is a large recall win' },
];

/** The manifest carries no audience column; classification implies the floor, because
 *  ck_document_classification_reachable forbids CONFIDENTIAL/RESTRICTED at PUBLIC audience. */
const audienceFor = (classification) => (classification === 'PUBLIC' ? 'PUBLIC' : 'AGENT');

function modal(values) {
  const c = new Map();
  for (const v of values) c.set(v, (c.get(v) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0]?.[0] ?? null;
}

function buildV900() {
  const manifest = read('specs/eval/kb-manifest.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byType = new Map();
  for (const r of manifest) {
    if (!byType.has(r.documentType)) byType.set(r.documentType, []);
    byType.get(r.documentType).push(r);
  }
  // Every documentType in the corpus must resolve to a collection, or the demo corpus cannot load.
  const homeless = [...byType.keys()].filter((t) => !COLLECTIONS.some((c) => c.docType === t));
  if (homeless.length) throw new Error(`V900: kb-manifest documentType(s) with no collection: ${homeless.join(', ')}`);

  const collRows = COLLECTIONS.map((c) => {
    const rows = c.docType ? byType.get(c.docType) || [] : [];
    const classification = rows.length ? modal(rows.map((r) => r.classification)) : 'PUBLIC';
    const tier = rows.length ? modal(rows.map((r) => r.tier)) : (c.code === 'SHARIA_NOTES' ? 'T3_HIGH' : 'T1_LOW');
    const policy = { strategy: c.strategy, minTokens: c.min, maxTokens: c.max, rule: c.rule, source: 'docs/04 §15' };
    const provenance = rows.length
      ? `${rows.length} manifest chunk(s), ${new Set(rows.map((r) => r.documentId)).size} document(s)`
      : 'no document in the current manifest; seeded so ingestion cannot fail on a missing collection';
    return [
      q(uuidv5(`collection:${c.code}`)), q(c.code), q(c.fr), q(c.ar), q(c.en),
      q(audienceFor(classification)), q(classification), q(tier), q(JSON.stringify(policy)),
      q(`${c.en} — ${provenance}. Defaults derived from specs/eval/kb-manifest.jsonl.`),
      q(`${c.fr} — valeurs par défaut dérivées de specs/eval/kb-manifest.jsonl.`),
      q(`${c.en} — defaults derived from specs/eval/kb-manifest.jsonl.`),
      bool(true),
    ];
  });

  const terms = parseGlossary(read('docs/glossary-trilingual.md'));
  const termRows = terms.map((t) => [
    q(uuidv5(`term_glossary:${t.code}`)), q(t.code), q(t.term_fr), q(t.term_ar), q(t.term_en),
    q(t.transliteration_ar), q(t.definition_fr), q(t.definition_ar), q(t.definition_en),
    arr(t.forbidden), arr(t.synonyms_fr), arr(t.synonyms_ar), arr(t.synonyms_en),
    q(t.domain), bool(t.sharia_sensitive), q('ACTIVE'), n(0), q('flyway:V900__seed_glossary'),
  ]);

  const body = `SET search_path TO ${SCHEMA}, public;

-- ── collection ───────────────────────────────────────────────────────────────────────────────────
-- ${COLLECTIONS.length} collections. chunking_policy holds a JSON object
-- {"strategy","minTokens","maxTokens","rule","source"} so the backoffice can render and edit it;
-- the strategies and token windows are the ones documented in docs/04 §15.
${insert('collection',
  ['id', 'code', 'name_fr', 'name_ar', 'name_en', 'default_audience', 'default_classification',
   'default_risk_tier', 'chunking_policy', 'description_fr', 'description_ar', 'description_en', 'enabled'],
  collRows, 3)}
-- ── term_glossary ────────────────────────────────────────────────────────────────────────────────
-- ${termRows.length} terms from docs/glossary-trilingual.md §1–§5. 🔒 in the document becomes
-- sharia_sensitive = true, which routes edits through the T3 path (docs/05 §4).
-- forbidden_renderings is a flat text[]: the column has no per-locale dimension, so the French,
-- Arabic and English prohibited strings from one row are stored together and matched literally by
-- the output guard regardless of the answer language.
-- A trailing parenthetical in a term cell is a gloss, not part of the term: "Murabaha (cost-plus
-- sale)" seeds term_en = 'Murabaha' and definition_en = 'cost-plus sale'. The document's notes
-- column is English, so it seeds definition_en; definition_fr carries only French glosses.
${insert('term_glossary',
  ['id', 'canonical_code', 'term_fr', 'term_ar', 'term_en', 'transliteration_ar', 'definition_fr',
   'definition_ar', 'definition_en', 'forbidden_renderings', 'synonyms_fr', 'synonyms_ar',
   'synonyms_en', 'domain', 'sharia_sensitive', 'status', 'version', 'created_by'],
  termRows, 4)}
-- ── invariants a reviewer can re-run ─────────────────────────────────────────────────────────────
-- SELECT count(*) FROM collection;                                        → ${COLLECTIONS.length}
-- SELECT count(*) FROM term_glossary;                                     → ${termRows.length}
-- SELECT count(*) FROM term_glossary WHERE sharia_sensitive;              → ${terms.filter((t) => t.sharia_sensitive).length}
-- SELECT count(*) FROM term_glossary WHERE cardinality(forbidden_renderings) > 0; → ${terms.filter((t) => t.forbidden.length).length}
`;

  return migration('V900__seed_glossary.sql', 'collections and the trilingual glossary', [
    'docs/glossary-trilingual.md §1–§5   (terms, trilingual labels, forbidden renderings, 🔒 sensitivity)',
    'specs/eval/kb-manifest.jsonl        (documentType values, and the modal classification/tier per type)',
    'docs/04-rag-pipeline.md §15         (chunking strategy and token window per content type)',
  ], [
    'collection.default_audience is derived, not authored: the manifest has no audience field, and',
    'ck_document_classification_reachable forbids CONFIDENTIAL/RESTRICTED content at PUBLIC audience,',
    'so any collection whose modal classification is above PUBLIC defaults to AGENT.',
    '',
    'Collection names in the three languages are AUTHORED here — no source document carries them —',
    'and they are the only invented values in this file. Everything else is parsed or derived.',
    '',
    'docs/glossary-trilingual.md §6 (the forbidden-rendering register) and §7 (Derja → MSA) are not',
    'term rows: §6 is cross-cutting policy and is seeded by V902 into assistant_config, and §7 is a',
    'human-readable excerpt of specs/i18n/derja-msa.json, which V903 seeds in full.',
  ], body);
}

/** Parses the markdown tables of docs/glossary-trilingual.md §1–§5. */
function parseGlossary(md) {
  const DOMAINS = [
    [/financing contracts/i, 'PRODUCT'],
    [/sharia concepts/i, 'SHARIA'],
    [/accounts, deposits/i, 'FINANCIAL'],
    [/governance & regulation/i, 'GOVERNANCE'],
    [/assistant, rag & platform/i, 'TECHNICAL'],
  ];
  /** "Murabaha (cost-plus sale)" → term "Murabaha", gloss "cost-plus sale". Only a parenthetical
   *  that closes the cell is treated as a gloss, so a term containing brackets survives intact. */
  const splitGloss = (cell) => {
    const m = String(cell || '').match(/^(.*?)\s*\(([^)]+)\)$/);
    return m ? [m[1].trim(), m[2].trim()] : [String(cell || '').trim(), null];
  };
  const out = [];
  let domain = null;
  let section = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^## (.+)$/);
    if (h) {
      section = h[1].trim();
      domain = DOMAINS.find(([re]) => re.test(section))?.[1] ?? null;
      continue;
    }
    if (!domain || !line.startsWith('| `')) continue;          // §6 and §7 have no domain → skipped
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 4) continue;
    const code = cells[0].match(/^`([^`]+)`/);
    if (!code) continue;
    const sensitive = cells[0].includes('🔒');
    const [term_fr, gloss_fr] = splitGloss(cells[1]);
    const [term_en, gloss_en] = splitGloss(cells[3]);

    // The notes column is written in English: a definition, then ✗ and the prohibited strings in
    // italics. Anything after the italic group is a qualifier on the prohibition, not a prohibition.
    const notes = cells[4] || '';
    const [definition, rest] = notes.split('✗');
    const italic = (rest || '').match(/\*([^*]+)\*/);
    const forbidden = italic
      ? italic[1].split(/[,،]/).map((x) => x.trim()).filter(Boolean)
      : [];
    const qualifier = italic ? (rest.slice(italic.index + italic[0].length).trim() || null) : (rest || '').trim() || null;
    const defEn = [gloss_en, (definition || '').trim() || null,
      qualifier ? (forbidden.length ? `prohibited ${qualifier}` : qualifier) : null]
      .filter(Boolean).join('. ').replace(/\.\./g, '.') || null;

    out.push({
      code: code[1],
      term_fr, term_ar: cells[2], term_en,
      transliteration_ar: null,
      definition_fr: gloss_fr,
      definition_ar: null,
      definition_en: defEn,
      forbidden, synonyms_fr: [], synonyms_ar: [], synonyms_en: [],
      domain, sharia_sensitive: sensitive, section,
    });
  }
  if (!out.length) throw new Error('V900: parsed no glossary terms — the table shape in docs/glossary-trilingual.md changed');
  const dupes = out.map((t) => t.code).filter((c, i, a) => a.indexOf(c) !== i);
  if (dupes.length) throw new Error(`V900: duplicate canonical_code in the glossary document: ${[...new Set(dupes)].join(', ')}`);
  const empties = out.filter((t) => !t.term_fr || !t.term_ar || !t.term_en);
  if (empties.length) throw new Error(`V900: term(s) missing a NOT NULL label: ${empties.map((t) => t.code).join(', ')}`);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  V903 — the Derja → MSA map
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function buildV903() {
  const spec = JSON.parse(read('specs/i18n/derja-msa.json'));
  const rows = spec.mappings.map((r) => [
    q(uuidv5(`derja_msa_map:${r.derjaAr}`)), q(r.derjaAr), q(r.derjaLatin ?? null), q(r.msa),
    q(r.glossEn ?? null), n(r.confidence), q(r.source), q(r.status), q('flyway:V903__seed_dialect'),
  ]);

  const low = spec.mappings.filter((r) => r.confidence < 0.8);
  const ctx = spec.mappings.filter((r) => r.contextRequired);
  const body = `SET search_path TO ${SCHEMA}, public;

-- ${rows.length} Derja → MSA mappings. sharedVocabulary (${spec.sharedVocabulary.length} entries) is deliberately
-- NOT seeded: those forms are identical in Derja and MSA, so there is nothing to map, and putting
-- them in the table would fill the administrator's mining queue with suggestions of the form
-- "نظام = نظام".
--
-- Rows carrying contextRequired are seeded ACTIVE with their predicate recorded in gloss_en, because
-- derja_msa_map has no context column. The runtime resolves them through the glossary and the intent
-- rather than through this table alone; ${ctx.length} such rows are listed at the foot of this file so a
-- reviewer can see which mappings are not unconditional.
--
-- Pruned entries (${spec.prunedEntries.length} rows in the spec, covering 11 removed mappings) are absent by design. Each
-- removal has a written reason in derja-msa.json:prunedEntries — they either duplicate the fold
-- stage, collide with another key once folded, chain into a second mapping, or rewrite a word that
-- is valid MSA with a different meaning. tools/i18n-lint D16 fails the build if one is re-added.
${insert('derja_msa_map',
  ['id', 'derja_ar', 'derja_latin', 'msa', 'gloss_en', 'confidence', 'source', 'status', 'created_by'],
  rows, 10)}
-- ── invariants a reviewer can re-run ─────────────────────────────────────────────────────────────
-- SELECT count(*) FROM derja_msa_map;                        → ${rows.length}
-- SELECT count(*) FROM derja_msa_map WHERE derja_latin IS NOT NULL;  → ${spec.mappings.filter((r) => r.derjaLatin).length}
-- SELECT count(*) FROM derja_msa_map WHERE confidence < 0.80; → ${low.length}
-- SELECT count(*) FROM derja_msa_map WHERE source <> 'SEED';  → 0
-- SELECT count(*) FROM derja_msa_map WHERE status <> 'ACTIVE'; → 0
--
-- Context-gated rows (the mapping is conditional; see contextWhen in specs/i18n/derja-msa.json):
${ctx.map((r) => `--   ${r.derjaAr} → ${r.msa}   when ${r.contextWhen}`).join('\n')}
`;

  return migration('V903__seed_dialect.sql', 'Tunisian Derja → MSA input map', [
    `specs/i18n/derja-msa.json           (mappings: ${rows.length} rows)`,
    'specs/i18n/README.md                (the policy this seed implements: Derja in, MSA out)',
  ], [
    'Derja is INPUT-side only. This table never rewrites an answer: answers are always MSA, and',
    'religious content is never expressed in Derja in either direction.',
    '',
    'The map is applied only when the message is detected as Derja, not to every Arabic query —',
    'several Derja forms are also valid MSA words with a different meaning. See policy.appliesWhen.',
    '',
    'Ordering matters at runtime: fold → dialect_map → stem. A key the stemmer would alter can never',
    'match, and can land on a different key (معلومات stems to معلوم, itself an entry meaning "fee").',
  ], body);
}


// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  V901 — the prompt library
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const PROMPT_FILES = ['system.assistant.fr.md', 'system.assistant.ar.md', 'system.assistant.en.md',
  'guardrail.sharia.judge.md'];

/** Approximation only: the runtime replaces token_estimate with a real tokenizer count. Over-
 *  estimating is the safe direction, because this number feeds the context budget guard. Arabic
 *  carries more meaning per character in BPE vocabularies, so it gets a smaller divisor. */
const estimateTokens = (body, locale) => Math.ceil(body.length / (locale === 'ar-TN' ? 2.5 : 4));

function parsePromptBlocks() {
  const blocks = [];

  // Front-matter files: `---` meta `---` then the whole remainder is the body.
  for (const file of PROMPT_FILES) {
    const text = read(`specs/prompts/${file}`);
    const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!m) throw new Error(`V901: ${file} has no YAML front matter — the importer contract in specs/prompts/README.md requires it`);
    blocks.push({ file, meta: yaml.load(m[1]), body: m[2].trim() });
  }

  // utility.prompts.md: a document header (which lists all six codes and is NOT a prompt) followed
  // by one section per prompt, each with a ```yaml block and a ```text body.
  const util = read('specs/prompts/utility.prompts.md');
  const sections = [...util.matchAll(/^## \d+\. `([A-Z_]+)`\n([\s\S]*?)(?=^## \d+\. `|$(?![\s\S]))/gm)];
  if (!sections.length) throw new Error('V901: parsed no sections out of utility.prompts.md');
  for (const [, code, section] of sections) {
    const meta = section.match(/```yaml\n([\s\S]*?)```/);
    const body = section.match(/```text\n([\s\S]*?)```/);
    if (!meta) throw new Error(`V901: utility.prompts.md section ${code} has no \`\`\`yaml metadata block`);
    if (!body) throw new Error(`V901: utility.prompts.md section ${code} has no \`\`\`text prompt body`);
    const parsed = yaml.load(meta[1]);
    if (parsed.code !== code) throw new Error(`V901: section heading says ${code} but its front matter says ${parsed.code}`);
    blocks.push({ file: 'utility.prompts.md', meta: parsed, body: body[1].trim() });
  }
  return blocks;
}

function buildV901() {
  const blocks = parsePromptBlocks();
  const CODES = enumValues('prompt_code');
  const LOCALES = enumValues('locale_code');
  const ROLES = enumValues('model_role');

  // Every prompt code the schema declares must have a seeded row, or the runtime asks for a prompt
  // that does not exist and falls back to no system prompt at all.
  const missing = CODES.filter((c) => !blocks.some((b) => b.meta.code === c));
  if (missing.length) throw new Error(`V901: prompt_code enum value(s) with no prompt file: ${missing.join(', ')}`);
  const unknown = blocks.filter((b) => !CODES.includes(b.meta.code));
  if (unknown.length) throw new Error(`V901: file(s) declare a code the enum does not have: ${unknown.map((b) => b.meta.code).join(', ')}`);

  for (const b of blocks) {
    const m = b.meta;
    if (!LOCALES.includes(m.locale)) {
      throw new Error(`V901: ${b.file} declares locale '${m.locale}', which is not in locale_code (${LOCALES.join(', ')}). Language-neutral prompts use fr-FR as the canonical row — see the note in utility.prompts.md's document header.`);
    }
    if (m.model_role && !ROLES.includes(m.model_role)) throw new Error(`V901: ${m.code} declares model_role '${m.model_role}', not in the model_role enum`);
    if (!m.body === undefined && !b.body) throw new Error(`V901: ${m.code} has an empty prompt body`);
    // The front-matter clause list and the inline markers are two statements of one fact; if they
    // disagree, the Prompt Studio would enforce a clause the body does not contain.
    const inline = [...new Set([...b.body.matchAll(/⟦PROTECTED:([A-Z_]+)⟧/g)].map((x) => x[1]))].sort();
    const declared = [...(m.protected_clauses || [])].sort();
    if (inline.join() !== declared.join()) {
      throw new Error(`V901: ${m.code} (${m.locale}) declares protected_clauses [${declared.join(', ')}] but its body marks [${inline.join(', ')}]`);
    }
  }

  const tplRows = [];
  const verRows = [];
  const routing = {};
  for (const b of blocks) {
    const m = b.meta;
    const localeField = `description_${m.locale.split('-')[0]}`;
    const desc = { fr: null, ar: null, en: null };
    desc[localeField.split('_')[1]] = `Importé de specs/prompts/${b.file} — rôle modèle ${m.model_role || '(non déclaré)'}.`;
    tplRows.push([q(m.code), q(m.locale), q(desc.fr), q(desc.ar), q(desc.en), bool(!!m.requires_sharia_approval)]);

    const tokens = estimateTokens(b.body, m.locale);
    verRows.push([
      q(uuidv5(`prompt_version:${m.code}:${m.locale}:${m.version}`)), q(m.code), q(m.locale), n(m.version),
      q(b.body), arr(m.variables || []), arr(m.protected_clauses || []), bool(!!m.requires_sharia_approval),
      // Seeded DRAFT whatever the file says. specs/config/README: "first boot ──► seed rows created
      // as DRAFT ──► review ──► ACTIVE". A source file cannot grant itself ACTIVE.
      q('DRAFT'),
      q(`Baseline v${m.version} imported from specs/prompts/${b.file}. Seeded DRAFT; activation goes through the governance workflow (docs/05 §4).`),
      q(`النسخة الأساسية v${m.version} مستوردة من specs/prompts/${b.file}. تُزرع بصيغة DRAFT ويعتمد تفعيلها مسار الحوكمة.`),
      q(`Baseline v${m.version} imported from specs/prompts/${b.file}. Seeded as DRAFT; activation follows the governance workflow.`),
      n(100), n(tokens), n(0), q('flyway:V901__seed_prompts'),
    ]);
    if (m.model_role) {
      // One binding per code, across every locale row it has. A code bound to two different roles
      // depending on the answer language would be a routing bug, not a feature.
      const prev = routing[m.code];
      if (prev && prev.modelRole !== m.model_role) {
        throw new Error(`V901: ${m.code} is bound to ${prev.modelRole} for one locale and ${m.model_role} for ${m.locale}`);
      }
      routing[m.code] = {
        ...(prev || {}), modelRole: m.model_role,
        locales: [...new Set([...(prev?.locales || []), m.locale])],
        ...(m.output_schema ? { outputSchema: m.output_schema } : {}),
        ...(m.max_tokens ? { maxTokens: m.max_tokens } : {}),
        ...(m.temperature !== undefined ? { temperature: m.temperature } : {}),
        ...(m.latency_budget_ms ? { latencyBudgetMs: m.latency_budget_ms } : {}),
      };
    }
  }

  const body = `SET search_path TO ${SCHEMA}, public;

-- ── prompt_template ──────────────────────────────────────────────────────────────────────────────
-- ${tplRows.length} rows: one per (code, locale). Language-neutral prompts are stored under the canonical
-- locale fr-FR because locale_code has no neutral member; the runtime resolves (code, answer_lang)
-- and falls back to the canonical row, so one classifier serves all three languages.
${insert('prompt_template',
  ['code', 'locale', 'description_fr', 'description_ar', 'description_en', 'requires_sharia_approval'],
  tplRows, 4)}
-- ── prompt_version ───────────────────────────────────────────────────────────────────────────────
-- ${verRows.length} baseline versions. Every row is seeded state = 'DRAFT' regardless of what its source file
-- says: activation is a governance act (docs/05 §4), not a property of a file in a repository.
--
-- token_estimate is an approximation (chars/4, chars/2.5 for Arabic) used for context-budget
-- planning. Over-estimating is the safe direction; the runtime replaces it with a real count.
--
-- Not persisted here, because prompt_version has no columns for them: model_role, output_schema,
-- max_tokens, temperature and latency_budget_ms. The prompt → model-role binding is seeded by V902
-- into assistant_config as 'prompt.model_routing' so that it is editable at runtime like every other
-- tunable rather than frozen into a migration.
${insert('prompt_version',
  ['id', 'code', 'locale', 'version_no', 'body', 'variables', 'protected_clauses',
   'requires_sharia_approval', 'state', 'change_note_fr', 'change_note_ar', 'change_note_en',
   'canary_percent', 'token_estimate', 'version', 'created_by'],
  verRows, 2)}
-- ── the prompt → model-role binding, for V902 to persist ─────────────────────────────────────────
${Object.entries(routing).map(([c, v]) => `--   ${c.padEnd(20)} ${v.modelRole.padEnd(15)} locales=${v.locales.join('+')}${v.outputSchema ? `  output=${v.outputSchema}` : ''}${v.maxTokens ? `  max_tokens=${v.maxTokens}` : ''}`).join('\n')}
--
-- ── invariants a reviewer can re-run ─────────────────────────────────────────────────────────────
-- SELECT count(*) FROM prompt_template;                                   → ${tplRows.length}
-- SELECT count(*) FROM prompt_version;                                    → ${verRows.length}
-- SELECT count(*) FROM prompt_version WHERE state <> 'DRAFT';             → 0
-- SELECT count(*) FROM prompt_version WHERE requires_sharia_approval;     → ${blocks.filter((b) => b.meta.requires_sharia_approval).length}
-- SELECT count(DISTINCT code) FROM prompt_version;                        → ${CODES.length}   (every prompt_code enum value)
`;

  return migration('V901__seed_prompts.sql', 'the prompt library baseline', [
    `specs/prompts/${PROMPT_FILES.join(', specs/prompts/')}`,
    'specs/prompts/utility.prompts.md   (6 prompts: INTENT_CLASSIFIER, QUERY_REWRITE, SYSTEM_RERANKER, ANSWER_CONTRACT, SUMMARIZER, EVAL_JUDGE)',
    'specs/db/schema.sql                (prompt_code, locale_code and model_role enums)',
    'specs/prompts/README.md            (the front-matter contract this importer implements)',
  ], [
    'Seeded DRAFT. specs/config/README: first boot creates DRAFT rows, a human reviews, then ACTIVE.',
    'A prompt file cannot grant itself ACTIVE, so the source `state:` value is ignored on purpose.',
    '',
    'The generator validates rather than transcribes: every prompt_code enum value must have a file,',
    'every declared locale and model_role must exist in its enum, and the front-matter',
    'protected_clauses list of each file must equal the ⟦PROTECTED:…⟧ markers in its body. Two',
    'statements of one fact that disagree would let the Prompt Studio enforce a clause the prompt',
    'does not contain, or drop one it does.',
    '',
    'KNOWN GAP, recorded rather than papered over: guardrail.sharia.judge.md sets',
    'requires_sharia_approval: true but declares no protected_clauses and marks none inline. It is',
    'the most doctrinally sensitive prompt in the system — its rubric decides what gets blocked — so',
    'an administrator can currently rewrite the ladder without tripping the protected-clause guard.',
    'Adding clauses to it is a content decision for the Sharia officer, not for a generator.',
  ], body);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  CLI
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const BUILDERS = {
  V900: ['V900__seed_glossary.sql', buildV900],
  V901: ['V901__seed_prompts.sql', buildV901],
  V903: ['V903__seed_dialect.sql', buildV903],
};

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  if (only && !BUILDERS[only]) { console.error(`unknown migration ${only}; have ${Object.keys(BUILDERS).join(', ')}`); process.exit(2); }

  let stale = 0;
  mkdirSync(OUT, { recursive: true });
  for (const [id, [file, build]] of Object.entries(BUILDERS)) {
    if (only && only !== id) continue;
    let text;
    try { text = build(); }
    catch (e) { console.error(`\n  ✗ ${id}: ${e.message}\n`); process.exit(2); }
    const path = join(OUT, file);
    if (!check) {
      writeFileSync(path, text);
      const rows = (text.match(/^\s{2}\(/gm) || []).length;
      console.log(`  wrote ${file.padEnd(30)} ${String(text.length).padStart(7)} bytes · ~${rows} rows`);
      continue;
    }
    if (!existsSync(path)) { console.error(`  ✗ ${file} does not exist — run generate.mjs`); stale++; continue; }
    const have = readFileSync(path, 'utf8');
    if (have !== text) {
      stale++;
      const a = have.split('\n'); const b = text.split('\n');
      const firstDiff = b.findIndex((l, i) => a[i] !== l);
      console.error(`  ✗ ${file} is STALE — source changed, SQL did not`);
      console.error(`      first difference at line ${firstDiff + 1}:`);
      console.error(`        committed: ${JSON.stringify((a[firstDiff] ?? '').slice(0, 100))}`);
      console.error(`        generated: ${JSON.stringify(b[firstDiff].slice(0, 100))}`);
    } else console.log(`  ok  ${file.padEnd(30)} matches its sources`);
  }
  if (check && stale) {
    console.error(`\n  ${stale} generated migration(s) out of date. Run: node tools/seed-gen/generate.mjs\n`);
    process.exit(1);
  }
  if (!check) console.log('');
}

main();
