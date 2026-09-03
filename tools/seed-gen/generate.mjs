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
 * database (specs/config/README §"The seed block"). Two writers for one row is two truths, so no
 * migration may touch those tables — audit() below fails the build if one does.
 *
 * Deterministic output: every surrogate key is a UUIDv5 of the row's natural key under a fixed
 * project namespace, so regeneration is byte-identical and the same row has the same id in dev, UAT
 * and production. Nothing in these files calls now() for a value that would otherwise differ
 * between runs; created_at is left to the column DEFAULT.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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
//  V902 — policies: guardrails, refusal messages, and the runtime-editable registers
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Resolves a dotted path in application.yaml. A register naming a path that does not exist is
 *  exactly the drift this generator exists to prevent. */
function yamlPath(doc, path) {
  const parts = path.split('.');
  let cur = doc;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || !(p in cur)) return undefined;
    cur = cur[p];
  }
  return cur;
}

/** Parses the guardrail policy register in docs/07 §6.1. */
function parseGuardrailRegister(md) {
  const start = md.indexOf('### 6.1 Guardrail policy register');
  if (start < 0) throw new Error('V902: docs/07 has no §6.1 guardrail policy register');
  const section = md.slice(start, md.indexOf('\n## ', start + 10) > 0 ? md.indexOf('\n## ', start + 10) : undefined);
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 8) continue;
    const code = cells[0].replace(/`/g, '');
    if (!/^[A-Z_]+$/.test(code)) continue;
    rows.push({
      code, scope: cells[1], severity: cells[2], decision: cells[3], tier: cells[4],
      emits: cells[5], catches: cells[6],
      paramsPath: (cells[7].match(/`([^`]+)`/) || [, null])[1],
    });
  }
  if (!rows.length) throw new Error('V902: parsed no rows from the docs/07 §6.1 register — the table shape changed');
  return rows;
}

const MESSAGE_KEY = {
  refusal: (code, part) => `refusal.${code}.${part}`,
  followup: (pool, i) => `followup.${pool}.${i}`,
  disclaimer: (id) => `disclaimer.${id}`,
};

function buildV902() {
  const CODES = enumValues('guardrail_policy_code');
  const SCOPES = enumValues('guardrail_scope');
  const SEVERITIES = enumValues('guardrail_severity');
  const DECISIONS = enumValues('guardrail_decision');
  const TIERS = enumValues('risk_tier');
  const LOCALES = enumValues('locale_code');

  const app = yaml.load(read('specs/config/application.yaml'));
  const refusals = yaml.load(read('specs/prompts/templates.refusals.yaml'));
  const register = parseGuardrailRegister(read('docs/07-security-iam-compliance.md'));

  // ── the register must cover the enum exactly ──────────────────────────────────────────────────
  const missing = CODES.filter((c) => !register.some((r) => r.code === c));
  if (missing.length) throw new Error(`V902: guardrail_policy_code value(s) absent from docs/07 §6.1: ${missing.join(', ')}`);
  const extra = register.filter((r) => !CODES.includes(r.code));
  if (extra.length) throw new Error(`V902: docs/07 §6.1 lists code(s) the enum does not have: ${extra.map((r) => r.code).join(', ')}`);
  for (const r of register) {
    if (!SCOPES.includes(r.scope)) throw new Error(`V902: ${r.code} scope '${r.scope}' is not in guardrail_scope`);
    if (!SEVERITIES.includes(r.severity)) throw new Error(`V902: ${r.code} severity '${r.severity}' is not in guardrail_severity`);
    if (!DECISIONS.includes(r.decision)) throw new Error(`V902: ${r.code} decision '${r.decision}' is not in guardrail_decision`);
    if (!TIERS.includes(r.tier)) throw new Error(`V902: ${r.code} tier '${r.tier}' is not in risk_tier`);
  }

  // ── guardrail_policy ──────────────────────────────────────────────────────────────────────────
  const policyRows = register.map((r) => {
    const params = r.paramsPath ? yamlPath(app, r.paramsPath) : undefined;
    if (r.paramsPath && params === undefined) {
      throw new Error(`V902: docs/07 §6.1 gives ${r.code} the params path ${r.paramsPath}, which does not exist in specs/config/application.yaml`);
    }
    const emitted = (r.emits.match(/REF-\d\d/) || [null])[0];
    if (!emitted && !/event only|429/.test(r.emits)) {
      throw new Error(`V902: ${r.code} emits '${r.emits}', which is neither a REF code nor a documented non-refusal outcome`);
    }
    if (emitted && !(refusals.templates || []).some((t) => t.code === emitted)) {
      throw new Error(`V902: ${r.code} emits ${emitted}, which templates.refusals.yaml does not define`);
    }
    const value = {
      ...(params && typeof params === 'object' ? params : {}),
      _provenance: { register: 'docs/07 §6.1', paramsPath: r.paramsPath || null, catches: r.catches, emits: r.emits },
      ...(emitted ? { refusalCode: emitted } : {}),
    };
    return [
      q(uuidv5(`guardrail_policy:${r.code}:1`)), q(r.code), n(1), q(r.scope), q(r.severity), q(r.decision),
      bool(true), jb(value), q(r.tier), q('DRAFT'), q('flyway:V902__seed_policies'),
    ];
  });

  // ── the documented contract in the header of templates.refusals.yaml ──────────────────────────
  // The file states its own key convention and its own list of server-resolved placeholders. Both
  // are parsed rather than assumed: if the header changes, the seed must change with it.
  const header = read('specs/prompts/templates.refusals.yaml').split('\ntemplates:')[0];
  const documentedPlaceholders = [...new Set(
    [...header.matchAll(/^\s*#\s+.*$/gm)].flatMap((l) => [...l[0].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))
  )];
  if (!documentedPlaceholders.length) throw new Error('V902: the header of templates.refusals.yaml no longer lists its server-resolved placeholders');
  const documentedKeys = [...new Set([...header.matchAll(/(refusal\.\{CODE\}\.[\w{}.]+)/g)].map((m) => m[1]))];
  if (documentedKeys.length < 3) throw new Error('V902: the header of templates.refusals.yaml no longer documents its message_key convention');

  // ── message_bundle ────────────────────────────────────────────────────────────────────────────
  const bundle = [];
  const refusalPolicy = {};
  const addMsg = (key, locale, text) => {
    if (text === null || text === undefined || !String(text).trim()) return;
    bundle.push([q(key), q(locale), q(String(text))]);
  };
  const pools = refusals.followup_pools || {};

  for (const t of refusals.templates || []) {
    const have = Object.keys(t.locales || {});
    const absent = LOCALES.filter((l) => !have.includes(l));
    if (absent.length) {
      throw new Error(`V902: refusal ${t.code} has no ${absent.join(', ')} text — a customer asking in that language would be refused in another`);
    }
    for (const [locale, l] of Object.entries(t.locales)) {
      if (!LOCALES.includes(locale)) throw new Error(`V902: refusal ${t.code} declares locale '${locale}', not in locale_code`);
      addMsg(`refusal.${t.code}.title`, locale, l.title);
      addMsg(`refusal.${t.code}.body`, locale, l.body);
      addMsg(`refusal.${t.code}.cta`, locale, l.cta);
    }

    // Variant bodies override `body` when their condition holds (REF-05 technical, agent audience).
    const variants = {};
    for (const [name, v] of Object.entries(t.variants || {})) {
      variants[name] = { reasonCodes: v.reason_codes ?? [], note: v.note ?? null };
      for (const [locale, l] of Object.entries(v.locales || {})) {
        if (!LOCALES.includes(locale)) throw new Error(`V902: ${t.code} variant ${name} declares locale '${locale}', not in locale_code`);
        for (const part of ['title', 'body', 'cta']) {
          addMsg(`refusal.${t.code}.${part}.${name}`, locale, l[part]);
        }
      }
      const covered = Object.keys(v.locales || {});
      const vAbsent = LOCALES.filter((l) => !covered.includes(l));
      if (vAbsent.length) throw new Error(`V902: ${t.code} variant '${name}' has no ${vAbsent.join(', ')} text`);
    }

    // Suggested-question chips are keyed per refusal code, per the documented convention, and are
    // materialised from the pool the template names. RELATED_QUESTIONS is deliberately not seeded: it
    // is filled at runtime with the titles of retrieved sources that scored below the relevance
    // threshold, and an empty pool is the correct result when retrieval returned nothing.
    const followups = {};
    if (t.followup_policy && t.followup_policy !== 'NONE' && t.followup_policy !== 'RELATED_QUESTIONS') {
      const pool = pools[t.followup_policy];
      if (!pool) throw new Error(`V902: ${t.code} names follow-up pool '${t.followup_policy}', which templates.refusals.yaml does not define`);
      for (const [locale, items] of Object.entries(pool)) {
        if (!Array.isArray(items)) continue;
        items.forEach((text, i) => addMsg(`refusal.${t.code}.followup.${i + 1}`, locale, text));
      }
      followups.pool = t.followup_policy;
      followups.perLocale = Object.fromEntries(Object.entries(pool).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
    } else {
      followups.pool = t.followup_policy ?? 'NONE';
      followups.perLocale = {};
      if (followups.pool === 'RELATED_QUESTIONS') followups.composedAtRuntime = 'titles of the top retrieved sources below the relevance threshold; empty when retrieval returned nothing';
    }

    // Message keys this refusal's flow refers to but whose text is not authored anywhere. Seeding
    // invented customer-facing copy is not the generator's call — it needs the R1–R8 review — so the
    // gap is recorded in the data where the backoffice and G7h can see it, rather than left to
    // render as a null or as the raw key in front of a customer.
    const referenced = [];
    if (t.referral?.consent_key) referenced.push(t.referral.consent_key);
    for (const step of [...(t.referral?.on_accept || []), ...(t.referral?.on_decline || [])]) {
      const m = String(step).match(/message_key (\S+)/);
      if (m) referenced.push(m[1]);
    }
    const unauthored = [...new Set(referenced)].filter((k) => !bundle.some((r) => r[0] === q(k)));

    refusalPolicy[t.code] = {
      name: t.name, triggersIncident: !!t.triggers_incident, followupPolicy: t.followup_policy ?? null,
      ctaAction: t.cta_action ?? null, audienceDefault: t.audience_default ?? null, log: t.log ?? null,
      emittedBy: t.emitted_by ?? [], shortCircuit: t.short_circuit ?? false,
      followups, ...(Object.keys(variants).length ? { variants } : {}),
      ...(t.referral ? { referral: t.referral } : {}),
      ...(unauthored.length ? { referencedMessagesNotAuthored: unauthored } : {}),
    };
  }

  const disclaimerWiring = {};
  for (const [id, d] of Object.entries(refusals.disclaimers || {})) {
    for (const locale of LOCALES) {
      if (!d[locale]) throw new Error(`V902: disclaimer ${id} has no ${locale} text`);
      addMsg(`disclaimer.${id}`, locale, d[locale]);
    }
    disclaimerWiring[id] = { appliesTo: d.applies_to ?? [], condition: d.condition ?? null };
  }

  // Every generated key must match a pattern the source file documents, or the runtime will look up
  // a key the backoffice cannot explain.
  const patterns = documentedKeys.map((k) => new RegExp(`^${k.replace('{CODE}', 'REF-\\d\\d').replace('{n}', '\\d+').replace('{PART}', '(title|body|cta)').replace('{VARIANT}', '[a-z]+').replace(/\./g, '\\.')}$`));
  for (const [rawKey] of bundle.map((r) => [r[0].slice(1, -1)])) {
    if (rawKey.startsWith('disclaimer.')) continue;                 // the header documents refusal keys only
    if (!patterns.some((re) => re.test(rawKey))) {
      throw new Error(`V902: generated message_key '${rawKey}' matches none of the documented patterns (${documentedKeys.join(', ')})`);
    }
  }
  const seen = new Set();
  for (const [key, locale] of bundle.map((r) => [r[0], r[1]])) {
    const k = `${key}|${locale}`;
    if (seen.has(k)) throw new Error(`V902: duplicate message_bundle primary key ${k}`);
    seen.add(k);
  }

  // ── assistant_config: the registers the runtime reads and an administrator may edit ───────────
  const routing = {};
  for (const b of parsePromptBlocks()) {
    const m = b.meta;
    if (!m.model_role) continue;
    const prev = routing[m.code];
    routing[m.code] = { ...(prev || {}), modelRole: m.model_role,
      locales: [...new Set([...(prev?.locales || []), m.locale])],
      ...(m.output_schema ? { outputSchema: m.output_schema } : {}),
      ...(m.max_tokens ? { maxTokens: m.max_tokens } : {}),
      ...(m.temperature !== undefined ? { temperature: m.temperature } : {}) };
  }
  // docs/glossary-trilingual.md §6 is cross-cutting: it prohibits renderings of concepts that are not
  // single glossary terms, so it does not fit term_glossary's three NOT NULL label columns.
  const registerSection = (() => {
    const md = read('docs/glossary-trilingual.md');
    const start = md.indexOf('## 6. Forbidden-rendering register');
    const end = md.indexOf('\n## 7.', start);
    const out = [];
    for (const line of md.slice(start, end > 0 ? end : undefined).split('\n')) {
      if (!line.startsWith('|') || line.startsWith('|---') || line.startsWith('| Concept')) continue;
      const c = line.split('|').slice(1, -1).map((x) => x.trim());
      if (c.length < 5) continue;
      const split = (s) => s.split(/[,،]/).map((x) => x.trim()).filter(Boolean);
      out.push({ concept: c[0], neverSay: { fr: split(c[1]), ar: split(c[2]), en: split(c[3]) }, sayInstead: c[4] });
    }
    if (!out.length) throw new Error('V902: parsed no rows from the docs/glossary-trilingual.md §6 register');
    return out;
  })();

  // Which component resolves each placeholder. Three are constants and come from assistant.identity;
  // the rest are composed per request, because their content depends on retrieval, on the rate
  // limiter or on the audience. A placeholder nobody resolves reaches the customer verbatim.
  const IDENTITY_KEYS = ['assistant_name', 'bank_name', 'committee_name'];
  const COMPOSED = {
    alternative_block: 'RefusalComposer — the participatory alternative to the prohibited product asked for, from term_glossary and retrieval',
    documentation_block: 'RefusalComposer — citations of the approved documentation that describes the operation',
    referral_cta: 'RefusalComposer — the label of the Sharia-committee referral action for the answer language',
    handoff_cta: 'RefusalComposer — the label of the human handoff action for the answer language',
    handoff_channel: 'RefusalComposer — the authenticated or agency channel that can serve the request, per channel and audience',
    top_sources: 'RefusalComposer — the titles of the top retrieved sources that scored below the relevance threshold, rendered as questions',
    retry_after: 'RateLimiter — the Retry-After window in seconds, from the bucket that was exhausted',
    correlation_id: 'IncidentContext — the correlation id of the guardrail_event or incident row, so an agent can trace the refusal. REF-05 agent variant only.',
    failed_stage: 'IncidentContext — the pipeline stage that failed. REF-05 agent variant only: R3 forbids naming internals in customer-facing copy, so this must never appear in an unqualified body.',
  };
  const fragments = {};
  for (const ph of documentedPlaceholders) {
    if (IDENTITY_KEYS.includes(ph)) fragments[ph] = { resolvedBy: 'assistant_config', source: 'assistant.identity' };
    else if (COMPOSED[ph]) fragments[ph] = { resolvedBy: 'runtime', source: COMPOSED[ph] };
    else throw new Error(`V902: templates.refusals.yaml documents the placeholder {{${ph}}} but nothing declares how it is resolved`);
  }
  for (const k of Object.keys(COMPOSED)) {
    if (!documentedPlaceholders.includes(k)) throw new Error(`V902: {{${k}}} has a declared composer but the source header no longer lists it`);
  }

  // R3: a placeholder documented as agent-variant-only must not appear in customer-facing copy. The
  // header says so in prose; this is what makes the prose enforceable.
  const agentOnly = documentedPlaceholders.filter((ph) => COMPOSED[ph] && /agent variant only/i.test(COMPOSED[ph]));
  for (const [rawKey, , rawText] of bundle) {
    const key = rawKey.slice(1, -1);
    if (/\.(agent)$/.test(key)) continue;                          // the agent variant may use them
    for (const ph of agentOnly) {
      if (rawText.includes(`{{${ph}}}`)) {
        throw new Error(`V902: ${key} is customer-facing but interpolates {{${ph}}}, which the source reserves for the agent variant (R3 forbids naming internals to a customer)`);
      }
    }
  }


  // The refusal bodies and the system prompts interpolate {{assistant_name}}, {{bank_name}} and
  // {{committee_name}}. Nothing else in the seed supplies them, so a refusal would reach a customer
  // with the literal text "{{committee_name}}" in it. Keyed by placeholder name on purpose: the
  // runtime resolves a placeholder by looking its name up in this object.
  const ident = app?.albaraka?.assistant;
  if (!ident) throw new Error('V902: application.yaml has no albaraka.assistant block to seed assistant.identity from');
  const identity = {
    assistant_name: ident.name ?? null,
    assistant_name_ar: ident['name-ar'] ?? null,
    bank_name: ident['bank-name'] ?? null,
    committee_name: ident['committee-name-fr'] ?? null,
    committee_name_ar: ident['committee-name-ar'] ?? null,
    committee_name_en: ident['committee-name-en'] ?? null,
    default_locale: ident['default-locale'] ?? null,
    supported_locales: ident['supported-locales'] ?? [],
  };
  const unresolvedIdentity = Object.entries(identity).filter(([k, v]) => v === null || v === '');
  if (unresolvedIdentity.length) throw new Error(`V902: albaraka.assistant supplies no value for ${unresolvedIdentity.map(([k]) => k).join(', ')}`);

  const assistantConfig = [
    ['assistant.identity', identity, 'T1_LOW',
     'The names interpolated into prompts and refusal messages, keyed by placeholder name. Seeded from albaraka.assistant in specs/config/application.yaml. Renaming the assistant is a branding decision an administrator can take without a migration; seed_test.sql G7e fails if a seeded message uses a placeholder this object does not supply.'],
    ['refusal.fragments', fragments, 'T2_MEDIUM',
     'Every placeholder that appears in a refusal, and what resolves it. Three are constants from assistant.identity; the rest are composed per request, because their content depends on retrieval, on the rate limiter or on the audience. Derived from the placeholder list in the header of specs/prompts/templates.refusals.yaml — a placeholder the header stops documenting fails the build rather than reaching a customer verbatim.'],
    ['prompt.model_routing', routing, 'T2_MEDIUM',
     'Which model_config runs each prompt code, and the output schema, max_tokens and temperature that go with it. prompt_version has no columns for these, so the binding lives here and stays editable at runtime rather than frozen into a migration. Generated from the front matter of specs/prompts/*.md.'],
    ['refusal.policy', refusalPolicy, 'T3_HIGH',
     'Per refusal code: the machine name, whether a hit opens an incident, which follow-up pool and CTA apply, which variants exist and when, the referral flow, and which guardrail stages emit it. message_bundle stores only text, so the behaviour around a refusal lives here. Where a flow refers to a message whose text has not been authored, the key is listed under referencedMessagesNotAuthored rather than invented. Generated from specs/prompts/templates.refusals.yaml.'],
    ['guardrail.forbidden_renderings_register', registerSection, 'T3_HIGH',
     'Cross-cutting prohibited renderings for concepts that are not single glossary terms, and what to say instead. term_glossary.forbidden_renderings covers the per-term cases; this covers the rest. Generated from docs/glossary-trilingual.md §6.'],
    ['disclaimer.wiring', disclaimerWiring, 'T2_MEDIUM',
     'Which disclaimer applies to which refusal code, and under what condition. Disclaimers are appended by the SERVER after the refusal body and are never generated by a model. Generated from specs/prompts/templates.refusals.yaml.'],
  ];
  const acRows = assistantConfig.map(([key, value, tier, desc]) => [
    q(key), jb(value), q('JSON'), 'NULL', q(tier), q(desc), n(0), q('flyway:V902__seed_policies'),
  ]);

  const body = `SET search_path TO ${SCHEMA}, public;

-- ── guardrail_policy ─────────────────────────────────────────────────────────────────────────────
-- ${policyRows.length} policies, one per member of guardrail_policy_code. Scope, severity, decision and tier
-- come from the docs/07 §6.1 register; params is the application.yaml block that register names,
-- resolved at generation time and stored with its provenance, so the seeded policy and the configured
-- thresholds cannot disagree.
--
-- All seeded state = 'DRAFT'. Enabling a guardrail is a governance act, and so is weakening one:
-- lowering a CRITICAL policy from BLOCK is a T3 change needing the two-eyes quorum of docs/05 §4.
--
-- NOT seeded here, deliberately: model_config and retrieval_config belong to
-- SeedOnEmptyDatabaseRunner, which reads albaraka.seed from application.yaml on an empty database
-- (specs/config/README). Two writers for one row is two truths.
${insert('guardrail_policy',
  ['id', 'code', 'version_no', 'applies_to', 'severity', 'decision_on_hit', 'enabled', 'params',
   'risk_tier', 'state', 'created_by'],
  policyRows, 3)}
-- ── message_bundle ───────────────────────────────────────────────────────────────────────────────
-- ${bundle.length} rows. Key convention: refusal.<CODE>.<title|body|cta>, followup.<POOL>.<n>,
-- disclaimer.<ID>. Every refusal carries all ${LOCALES.length} locales — the generator fails if one is missing,
-- because a customer refused in a language they did not ask in has been refused twice.
-- RELATED_QUESTIONS is not seeded: it is filled at runtime with the titles of retrieved sources that
-- scored below the relevance threshold, and an empty pool is the correct result when retrieval
-- returned nothing.
${insert('message_bundle', ['message_key', 'locale', 'text'], bundle, 6)}
-- ── assistant_config ─────────────────────────────────────────────────────────────────────────────
-- ${acRows.length} runtime-editable registers. These are the parts of the seed that an administrator is meant to
-- change without a migration; each description names the file it was generated from.
${insert('assistant_config',
  ['key', 'value', 'value_type', 'locale', 'risk_tier', 'description', 'version', 'updated_by'],
  acRows, 1)}
-- ── invariants a reviewer can re-run ─────────────────────────────────────────────────────────────
-- SELECT count(*) FROM guardrail_policy;                                  → ${policyRows.length}
-- SELECT count(*) FROM guardrail_policy WHERE state <> 'DRAFT';           → 0
-- SELECT count(*) FROM guardrail_policy WHERE severity = 'CRITICAL'
--                                          AND decision_on_hit <> 'BLOCK'; → ${register.filter((r) => r.severity === 'CRITICAL' && r.decision !== 'BLOCK').length}
-- SELECT count(*) FROM message_bundle;                                    → ${bundle.length}
-- SELECT count(DISTINCT message_key) FROM message_bundle;                 → ${new Set(bundle.map((r) => r[0])).size}
-- SELECT count(*) FROM assistant_config;                                  → ${acRows.length}
`;

  return migration('V902__seed_policies.sql', 'guardrail policies, refusal messages and runtime registers', [
    'docs/07-security-iam-compliance.md §6.1   (the guardrail policy register: scope, severity, decision, tier, params path)',
    'specs/config/application.yaml             (the params blocks the register names, resolved by path)',
    'specs/prompts/templates.refusals.yaml     (refusal text in three locales, follow-up pools, disclaimers, per-code behaviour)',
    'docs/glossary-trilingual.md §6            (the cross-cutting forbidden-rendering register)',
    'specs/prompts/*.md                        (the prompt → model-role binding)',
    'specs/db/schema.sql                       (guardrail_policy_code, guardrail_scope, guardrail_severity, guardrail_decision, risk_tier, locale_code)',
  ], [
    'params is resolved from application.yaml at generation time and stored with a _provenance member',
    'naming the path it came from. A register that names a path which no longer exists fails the',
    'build rather than seeding an empty policy.',
    '',
    'The refusal each policy emits is checked against templates.refusals.yaml, and every refusal must',
    'exist in all three locales. RATE_LIMIT is the one policy that emits an HTTP 429 instead of a',
    'refusal, and LANGUAGE_CONSISTENCY the one that warns instead of blocking; both are argued in',
    'docs/07 §6.1 rather than left as a surprise in the data.',
  ], body);
}


// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  Audit — invariants over the generated files themselves
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Tables owned by SeedOnEmptyDatabaseRunner (specs/config/README §"The seed block"). A migration
 *  that writes them creates a second truth for one row, and which one wins depends on deploy order. */
const RUNNER_OWNED = ['model_config', 'retrieval_config'];

function audit(files) {
  const problems = [];
  const schema = read('specs/db/schema.sql');
  const tables = new Set([...schema.matchAll(/CREATE TABLE (\w+) \(/g)].map((m) => m[1]));

  for (const [name, text] of files) {
    if (!text.includes(`SET search_path TO ${SCHEMA}, public;`)) {
      problems.push(`${name} does not set search_path to ${SCHEMA} — it would insert into public, where these tables do not exist`);
    }
    const targets = [...text.matchAll(/INSERT INTO (\w+)/g)].map((m) => m[1]);
    for (const t of new Set(targets)) {
      if (RUNNER_OWNED.includes(t)) problems.push(`${name} inserts into ${t}, which is owned by SeedOnEmptyDatabaseRunner`);
      if (!tables.has(t)) problems.push(`${name} inserts into ${t}, which schema.sql does not create`);
    }
    if (!targets.length) problems.push(`${name} contains no INSERT — an empty migration is a mistake, not a no-op`);
  }
  // No handwritten strays: everything in specs/db/seed must be generated, or the staleness check has
  // a blind spot the size of whatever file nobody regenerates.
  if (existsSync(OUT)) {
    for (const f of readdirSync(OUT).filter((x) => x.endsWith('.sql'))) {
      if (!Object.values(BUILDERS).some(([file]) => file === f)) {
        problems.push(`specs/db/seed/${f} is not produced by any builder — either generate it or delete it, because --check cannot tell whether it is stale`);
      }
    }
  }
  return problems;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  CLI
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const BUILDERS = {
  V900: ['V900__seed_glossary.sql', buildV900],
  V901: ['V901__seed_prompts.sql', buildV901],
  V902: ['V902__seed_policies.sql', buildV902],
  V903: ['V903__seed_dialect.sql', buildV903],
};

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  if (only && !BUILDERS[only]) { console.error(`unknown migration ${only}; have ${Object.keys(BUILDERS).join(', ')}`); process.exit(2); }

  let stale = 0;
  mkdirSync(OUT, { recursive: true });
  const generated = [];
  for (const [id, [file, build]] of Object.entries(BUILDERS)) {
    if (only && only !== id) continue;
    let text;
    try { text = build(); }
    catch (e) { console.error(`\n  ✗ ${e.message.startsWith(`${id}:`) ? e.message : `${id}: ${e.message}`}\n`); process.exit(2); }
    const path = join(OUT, file);
    // In check mode audit what is on disk, because that is what ships; otherwise audit what we are
    // about to write.
    generated.push([file, check && existsSync(path) ? readFileSync(path, 'utf8') : text]);
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
      // Scan the longer of the two: a hand-appended line makes the committed file longer, and
      // indexing the shorter array would report nothing at all.
      const len = Math.max(a.length, b.length);
      let firstDiff = -1;
      for (let i = 0; i < len; i++) { if ((a[i] ?? undefined) !== (b[i] ?? undefined)) { firstDiff = i; break; } }
      console.error(`  ✗ ${file} is STALE — source changed, SQL did not`);
      if (firstDiff < 0) {
        console.error(`      files differ only in trailing whitespace or line endings`);
      } else {
        console.error(`      first difference at line ${firstDiff + 1} of ${len}:`);
        console.error(`        committed: ${JSON.stringify((a[firstDiff] ?? '(absent)').slice(0, 100))}`);
        console.error(`        generated: ${JSON.stringify((b[firstDiff] ?? '(absent)').slice(0, 100))}`);
      }
    } else console.log(`  ok  ${file.padEnd(30)} matches its sources`);
  }
  const problems = audit(generated);
  for (const p of problems) console.error(`  ✗ ${p}`);
  if (problems.length) { console.error(`\n  ${problems.length} audit problem(s) in the generated migrations.\n`); process.exit(1); }
  if (!check) console.log(`  audit clean — search_path targets ${SCHEMA}, no migration writes a runner-owned table, every target exists in schema.sql`);

  if (check && stale) {
    console.error(`\n  ${stale} generated migration(s) out of date. Run: node tools/seed-gen/generate.mjs\n`);
    process.exit(1);
  }
  if (!check) console.log('');
}

main();
