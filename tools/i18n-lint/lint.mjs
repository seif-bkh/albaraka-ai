#!/usr/bin/env node
/**
 * i18n-lint — executable checks over specs/i18n/
 *
 * Normalisation is the quietest place in this system to be wrong. A fold applied on the index side
 * and not the query side does not throw: the two tokens simply never meet, recall drops a few points,
 * and the failure is reported as "the model is weak". A mapping table with a swapped column seeds
 * Arabic→English pairs that no reviewer reads closely, because there are 377 of them. An unmapped
 * Postgres token type discards every integer in the corpus without a warning.
 *
 * So the expectations here are derived, not copied:
 *   · the Arabic folds, stem affixes and Unicode ranges  ← docs/03 §8 pipeline table
 *   · the text-search configuration                      ← specs/db/schema.sql (the executable truth)
 *   · the field and column names a stage writes to       ← specs/db/schema.sql
 *   · the required Derja examples and the seed coverage   ← docs/06 §7
 *   · the currency and locale contract                   ← specs/config/application.yaml
 *
 * Check groups
 *   N  normalization.json: stages coherent and ordered, documented folds and affixes present, the
 *      text-search block mirrors schema.sql exactly, UTF8 required, display text never modified
 *   D  derja-msa.json: columns match derja_msa_map, keys unique across both lists, no identity rows,
 *      scripts correct, confidence and context discipline, coverage against docs/06, documented
 *      examples present, arabizi digits covered by the transliteration stage, no mapping chains
 *   C  Cross-artefact: policy flags agree between the two files, referenced tables and columns exist,
 *      currency and locales agree with specs/config
 *
 * Exit 0 = pass, 1 = at least one ERROR. WARN never fails the build.
 *
 * Usage: node tools/i18n-lint/lint.mjs
 *          [I18N_DIR=/path/to/specs/i18n] [SCHEMA_FILE=…] [DOC03_FILE=…] [DOC06_FILE=…]
 *          [CONFIG_FILE=…]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const I18N = process.env.I18N_DIR || join(root, 'specs', 'i18n');
const SCHEMA = process.env.SCHEMA_FILE || join(root, 'specs', 'db', 'schema.sql');
const DOC03 = process.env.DOC03_FILE || join(root, 'docs', '03-data-model.md');
const DOC06 = process.env.DOC06_FILE || join(root, 'docs', '06-i18n-trilingual-rtl.md');
const CONFIG = process.env.CONFIG_FILE || join(root, 'specs', 'config', 'application.yaml');

const errors = [];
const warns = [];
const ok = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

function readJson(path, label) {
  if (!existsSync(path)) { err(`${label}: file not found at ${path}`); return null; }
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { err(`${label}: JSON parse failure — ${e.message}`); return null; }
}
function readText(path, label) {
  if (!existsSync(path)) { err(`${label}: file not found at ${path}`); return ''; }
  return readFileSync(path, 'utf8');
}

const norm = readJson(join(I18N, 'normalization.json'), 'N01 normalization.json');
const derja = readJson(join(I18N, 'derja-msa.json'), 'D01 derja-msa.json');
const schema = readText(SCHEMA, 'schema.sql');
const doc03 = readText(DOC03, 'docs/03');
const doc06 = readText(DOC06, 'docs/06');
const configText = readText(CONFIG, 'application.yaml');

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  Authority parsers
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Columns of a CREATE TABLE, in order, with nullability. */
function tableColumns(sql, table) {
  const start = sql.indexOf(`CREATE TABLE ${table} (`);
  if (start < 0) { err(`schema.sql: no CREATE TABLE ${table}`); return []; }
  const body = sql.slice(start, sql.indexOf('\n);', start));
  const out = [];
  for (const line of body.split('\n').slice(1)) {
    const m = line.match(/^\s{2}([a-z_]+)\s+\S+/);
    if (m && !/^\s*(CONSTRAINT|UNIQUE|PRIMARY|CHECK|FOREIGN)\b/.test(line)) {
      out.push({ name: m[1], notNull: /NOT NULL/.test(line) });
    }
  }
  return out;
}

/** `ADD MAPPING FOR <types> WITH <dicts>` from the albaraka_fts DDL. */
function ftsMappings(sql) {
  const out = [];
  const re = /ADD MAPPING FOR ([a-z_, ]+) WITH ([a-z_, ]+);/g;
  const start = sql.indexOf('CREATE TEXT SEARCH CONFIGURATION albaraka_fts');
  if (start < 0) { err('schema.sql: no albaraka_fts configuration'); return out; }
  const region = sql.slice(start, start + 4000);
  for (const m of region.matchAll(re)) {
    out.push({
      tokenTypes: m[1].split(',').map((s) => s.trim()).filter(Boolean),
      dictionaries: m[2].split(',').map((s) => s.trim()).filter(Boolean),
    });
  }
  return out;
}

/** A row of the docs/03 §8 pipeline table, by its first cell. */
function pipelineRow(doc, firstCell) {
  for (const line of doc.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells[0] && cells[0].replace(/[`*]/g, '') === firstCell) return cells;
  }
  return null;
}

const backticked = (s) => [...(s || '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);

// The 23 token types PostgreSQL's default parser emits, established empirically against 18.4 with
// `SELECT alias FROM ts_token_type('default')` (see the commit that added the G4 assertions). A
// token type outside this list cannot appear, and one missing from the mapping discards its tokens.
const PARSER_TOKEN_TYPES = ['asciihword', 'asciiword', 'blank', 'email', 'entity', 'file', 'float',
  'host', 'hword', 'hword_asciipart', 'hword_numpart', 'hword_part', 'int', 'numhword', 'numword',
  'protocol', 'sfloat', 'tag', 'uint', 'url', 'url_path', 'version', 'word'];

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const ARABIC_ONLY = (s) => typeof s === 'string' && s.length > 0
  && [...s].every((c) => ARABIC.test(c) || /[\s'’\-–—.,:;?!()«»]/.test(c));
// Tunisian arabizi is typed on a French keyboard, so é and è are legitimate and are handled by the
// transliteration stage (normalization.json maps both to ي). What is not legitimate is Arabic script
// in a latin column, or a character the transliteration table has never heard of.
const LATIN_OK = /^[\u0020-\u007E\u00C0-\u00FF]+$/;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  N — normalization.json
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function checkNormalization() {
  if (!norm) return;
  const stages = norm.stages || {};
  // N01 required top-level keys: a reshaped file must be named, not read as an empty pipeline
  const missingN = ['stageOrder', 'stages', 'appliesTo', 'postgresTextSearch', 'formatting']
    .filter((k) => norm[k] === undefined);
  if (missingN.length) err(`N01 normalization.json is missing ${missingN.join(', ')} — the runtime reads these keys, so their absence is a silent no-op rather than a failure`);

  const order = norm.stageOrder || [];

  // N02 coherence between stageOrder and stages
  const orphanStage = Object.keys(stages).filter((s) => !order.includes(s));
  const danglingRef = order.filter((s) => !(s in stages));
  if (orphanStage.length) err(`N02 stage(s) ${orphanStage.join(', ')} are defined but absent from stageOrder — they would never run`);
  if (danglingRef.length) err(`N02 stageOrder names ${danglingRef.join(', ')}, which is not defined in stages`);
  if (!orphanStage.length && !danglingRef.length) ok.push(`N02 normalisation: stageOrder and stages agree on ${order.length} stages`);

  // N03 arabizi must precede language detection, or Latin-script Derja is detected as French
  const runsBefore = stages.arabizi_transliterate?.runsBefore;
  if (runsBefore && order.indexOf('arabizi_transliterate') > order.indexOf(runsBefore)) {
    err(`N03 stageOrder runs arabizi_transliterate after ${runsBefore}; Latin-script Derja (9addéch, bch) would be detected as French and routed to the wrong prompt and answer language`);
  } else if (runsBefore) ok.push(`N03 normalisation: arabizi transliteration precedes ${runsBefore}`);

  // N04 documented Unicode strips
  const uniRow = pipelineRow(doc03, 'Unicode');
  if (!uniRow) warn('N04 docs/03 §8 has no Unicode row to check against');
  else {
    const docText = uniRow.join(' ');
    const ranges = (stages.unicode?.ar?.stripRanges || []);
    const flat = ranges.map((r) => `${r.from}–${r.to}`);
    for (const [label, from, to] of [['tashkīl', 'U+064B', 'U+0652'], ['tatweel', 'U+0640', 'U+0640']]) {
      const documented = docText.includes(from.replace('U+', 'U+').toLowerCase()) || docText.includes(from);
      const present = flat.some((f) => f.startsWith(from));
      if (documented && !present) err(`N04 docs/03 §8 requires stripping ${label} (${from}${to === from ? '' : `–${to}`}) but normalization.json declares ${flat.join(', ') || 'nothing'}`);
    }
    if (stages.unicode?.form !== 'NFKC') err(`N04 unicode.form must be NFKC (docs/03 §8), got ${stages.unicode?.form}`);
    if (stages.unicode?.fr_en?.lowercase !== true) err('N04 fr_en must be lowercased (docs/03 §8)');
  }

  // N05 documented folds present; extra folds must be explained where a reader will see them
  const foldRow = pipelineRow(doc03, 'Folding');
  if (!foldRow) warn('N05 docs/03 §8 has no Folding row to check against');
  else {
    const charMap = stages.fold?.ar?.charMap || {};
    const comment = [].concat(stages.fold?.ar?.$comment || []).join(' ');
    // docs/03 writes the folds as `أ إ آ ٱ` → `ا`؛ `ة` → `ه`؛ …
    const arrowPairs = [...foldRow.join(' ').matchAll(/`([^`]+)`\s*(?:→|-&gt;)\s*`([^`]+)`/g)];
    let checked = 0;
    for (const [, src, tgt] of arrowPairs) {
      for (const ch of [...src].filter((c) => ARABIC.test(c))) {
        checked++;
        if (!(ch in charMap)) err(`N05 docs/03 §8 folds ${ch} → ${tgt} but normalization.json has no such entry`);
        else if (charMap[ch] !== tgt) err(`N05 docs/03 §8 folds ${ch} → ${tgt}; normalization.json folds it to ${charMap[ch]}`);
      }
    }
    // The grouped form `أ إ آ ٱ` → `ا` arrives as one pair with a multi-char source; the
    // single-char folds (ة، ى، ؤ، ئ) arrive individually. Both are handled above.
    const docChars = new Set([...foldRow.join(' ').matchAll(/[\u0600-\u06FF]/g)].map((m) => m[0]));
    for (const ch of Object.keys(charMap)) {
      if (docChars.has(ch)) continue;
      if (!comment.includes(ch)) err(`N05 normalization.json folds ${ch} → ${charMap[ch]}, which docs/03 §8 does not list, and the stage comment does not justify it`);
    }
    if (!errors.some((e) => e.startsWith('N05'))) ok.push(`N05 normalisation: all ${checked} documented Arabic folds present; ${Object.keys(charMap).length - checked} additions each justified in the stage comment`);
  }

  // N06 stem affixes, compared as sets (docs/03 listed ات twice; stemming is not a sequence)
  const stemRow = pipelineRow(doc03, 'Stemming');
  if (stemRow) {
    const groups = backticked(stemRow[2] || '');
    const docPrefixes = new Set((groups[0] || '').split(/\s+/).filter(Boolean));
    const docSuffixes = new Set((groups[1] || '').split(/\s+/).filter(Boolean));
    const spec = stages.stem?.ar || {};
    const gotP = new Set(spec.stripPrefixes || []);
    const gotS = new Set(spec.stripSuffixes || []);
    const missP = [...docPrefixes].filter((x) => !gotP.has(x));
    const missS = [...docSuffixes].filter((x) => !gotS.has(x));
    const extraP = [...gotP].filter((x) => !docPrefixes.has(x));
    const extraS = [...gotS].filter((x) => !docSuffixes.has(x));
    if (missP.length) err(`N06 stem.ar is missing documented prefix(es) ${missP.join(' ')}`);
    if (missS.length) err(`N06 stem.ar is missing documented suffix(es) ${missS.join(' ')}`);
    if (extraP.length) err(`N06 stem.ar strips prefix(es) ${extraP.join(' ')} that docs/03 §8 does not document`);
    if (extraS.length) err(`N06 stem.ar strips suffix(es) ${extraS.join(' ')} that docs/03 §8 does not document`);
    if (spec.maxStripPerSide !== 1) err(`N06 stem.ar.maxStripPerSide must be 1; a greedy light stemmer collapses distinct words onto one root and precision fails silently (got ${spec.maxStripPerSide})`);
    if ((spec.minRootLength ?? 0) < 3) err(`N06 stem.ar.minRootLength must be at least 3 to protect triliteral roots (got ${spec.minRootLength})`);
    if (!errors.some((e) => e.startsWith('N06'))) ok.push(`N06 normalisation: ${gotP.size} prefixes and ${gotS.size} suffixes match docs/03 §8 as sets; one strip per side`);
  }

  // N07 the text-search block must mirror schema.sql, and cover every parser token type
  const fts = norm.postgresTextSearch || {};
  const real = ftsMappings(schema);
  const realTypes = new Set(real.flatMap((m) => m.tokenTypes));
  const specTypes = new Set((fts.mappings || []).flatMap((m) => m.tokenTypes));
  const excluded = new Set(Object.keys(fts.intentionallyUnmapped || {}));

  if (fts.configurationName && !schema.includes(`CREATE TEXT SEARCH CONFIGURATION ${fts.configurationName}`)) {
    err(`N07 postgresTextSearch.configurationName "${fts.configurationName}" is not created in schema.sql`);
  }
  for (const missing of [...realTypes].filter((t) => !specTypes.has(t))) {
    err(`N07 schema.sql maps token type \`${missing}\` but normalization.json does not list it`);
  }
  for (const extra of [...specTypes].filter((t) => !realTypes.has(t))) {
    err(`N07 normalization.json lists token type \`${extra}\`, which schema.sql does not map${PARSER_TOKEN_TYPES.includes(extra) ? '' : ' and which the default parser does not even emit'}`);
  }
  // dictionaries must agree per token type
  const realDicts = new Map();
  for (const m of real) for (const t of m.tokenTypes) realDicts.set(t, m.dictionaries.join(','));
  for (const m of (fts.mappings || [])) for (const t of m.tokenTypes) {
    const want = m.dictionaries.join(',');
    if (realDicts.has(t) && realDicts.get(t) !== want) {
      err(`N07 token type \`${t}\` maps to ${want} in normalization.json but ${realDicts.get(t)} in schema.sql`);
    }
  }
  const accounted = new Set([...specTypes, ...excluded]);
  for (const t of PARSER_TOKEN_TYPES) {
    if (!accounted.has(t)) err(`N07 the default parser can emit \`${t}\`, which is neither mapped nor declared intentionally unmapped — its tokens would be discarded silently`);
  }
  for (const t of excluded) {
    if (!PARSER_TOKEN_TYPES.includes(t)) warn(`N07 intentionallyUnmapped names \`${t}\`, which the default parser does not emit`);
    if (!fts.intentionallyUnmapped[t]) err(`N07 \`${t}\` is excluded without a reason`);
  }
  if (!errors.some((e) => e.startsWith('N07'))) {
    ok.push(`N07 normalisation: text-search block mirrors schema.sql — ${specTypes.size} mapped token types, ${excluded.size} intentionally excluded, ${PARSER_TOKEN_TYPES.length} accounted for`);
  }
  if (fts.arabicStemmingInDatabase !== false) err('N07 arabicStemmingInDatabase must be false: stock PostgreSQL has no Arabic stemmer');
  if (fts.arabicStemmingInApplication !== true) err('N07 arabicStemmingInApplication must be true, or Arabic retrieval relies on stemming nobody performs');

  // N08 encoding
  const enc = fts.requiresServerEncoding || stages.unicode?.requiresServerEncoding;
  if (enc !== 'UTF8') err(`N08 the cluster encoding must be declared UTF8 (got ${enc}); on SQL_ASCII every non-ASCII token, Arabic included, classifies as blank and indexes nothing`);
  else ok.push('N08 normalisation: UTF8 required, which is what keeps Arabic out of the `blank` token class');

  // N13 dialect_map must run before stem: a key the stemmer alters is unreachable, and can collide
  // with a different key (معلومات stems to معلوم, which is its own entry).
  if (order.indexOf('dialect_map') > order.indexOf('stem')) {
    err('N13 stageOrder runs dialect_map after stem — a key the stemmer would alter can never match, and can land on a different key (معلومات → معلوم, الجاب → جاب), silently rewriting the wrong word');
  } else if (order.indexOf('dialect_map') < order.indexOf('fold')) {
    err('N13 stageOrder runs dialect_map before fold — keys are compared folded, so أ/إ/آ and ة/ه variants in user input would miss');
  } else ok.push('N13 normalisation: fold → dialect_map → stem, the only order in which the map is both reachable and unambiguous');

  // N10 display text is never modified
  const applies = norm.appliesTo || {};
  if (applies.displayTextNeverModified !== true) err('N10 appliesTo.displayTextNeverModified must be true — answers quote documents exactly as approved');
  for (const f of ['answer_markdown']) {
    if (!(applies.neverAppliedTo || []).includes(f)) err(`N10 appliesTo.neverAppliedTo must include ${f}`);
  }
  // N09b the fields normalisation writes must exist
  for (const f of [...(applies.indexSide || []), ...(applies.querySide || [])]) {
    const [table, col] = f.split('.');
    if (!col) continue;
    const cols = tableColumns(schema, table);
    if (!cols.length) { err(`N09 appliesTo names table \`${table}\`, which schema.sql does not create`); continue; }
    if (!cols.some((c) => c.name === col)) err(`N09 appliesTo names \`${f}\` but ${table} has no column ${col}`);
  }

  // N11/N12 formatting contract
  const cur = norm.formatting?.currency || {};
  if (cur.code !== 'TND') err(`N11 currency.code must be TND, got ${cur.code}`);
  if (cur.decimals !== 3) err(`N11 currency.decimals must be 3 — dinars divide into 1000 millimes and tariffs are quoted in millimes; got ${cur.decimals}`);
  if (norm.formatting?.numbers?.neverUseEasternArabicNumerals !== true) warn('N11 eastern Arabic numerals are not explicitly forbidden; they break numeric grounding checks and screen readers');
  if (!errors.some((e) => e.startsWith('N11'))) ok.push('N11 normalisation: TND at three decimals, western digits only');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  D — derja-msa.json
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function checkDerja() {
  if (!derja) return;
  // D01 required top-level keys
  const missingD = ['mappings', 'sharedVocabulary', 'policy', 'table']
    .filter((k) => derja[k] === undefined);
  if (missingD.length) err(`D01 derja-msa.json is missing ${missingD.join(', ')} — a seed file without its policy block ships the mappings without the rules that govern them`);

  const M = derja.mappings || [];
  const S = derja.sharedVocabulary || [];
  if (!M.length) { err('D01 derja-msa.json has no mappings'); return; }

  // D02 columns must match derja_msa_map
  const cols = tableColumns(schema, 'derja_msa_map');
  if (!cols.length) err('D02 schema.sql has no derja_msa_map table to align with');
  else {
    const expected = new Set(cols.filter((c) => !['id', 'created_by', 'created_at'].includes(c.name)).map((c) => camel(c.name)));
    const allowedMeta = new Set(['category', 'note', 'contextRequired', 'contextWhen']);
    const seen = new Set();
    for (const r of M) {
      for (const k of Object.keys(r)) seen.add(k);
      for (const c of cols.filter((x) => x.notNull && !['id', 'created_by', 'created_at'].includes(x.name))) {
        if (r[camel(c.name)] === undefined || r[camel(c.name)] === null) {
          err(`D02 ${r.derjaAr || '(no key)'}: NOT NULL column ${c.name} is missing`);
        }
      }
      for (const k of Object.keys(r)) {
        if (!expected.has(k) && !allowedMeta.has(k)) err(`D02 ${r.derjaAr}: field \`${k}\` is neither a derja_msa_map column nor declared authoring metadata`);
      }
    }
    const unused = [...expected].filter((c) => !seen.has(c));
    if (unused.length) warn(`D02 derja_msa_map column(s) ${unused.join(', ')} are never populated by the seed file`);
    if (!errors.some((e) => e.startsWith('D02'))) ok.push(`D02 derja: every row carries the derja_msa_map columns (${[...expected].join(', ')}) plus declared metadata only`);
  }

  // D03 uniqueness across BOTH lists — one key space, because the table has one UNIQUE(derja_ar)
  const seen = new Map();
  for (const [label, list] of [['mappings', M], ['sharedVocabulary', S]]) {
    for (const r of list) {
      const k = r.derjaAr;
      if (seen.has(k)) err(`D03 "${k}" appears in ${seen.get(k)} and in ${label} — derja_ar is UNIQUE, so one of them would be dropped at insert time`);
      else seen.set(k, label);
    }
  }
  if (!errors.some((e) => e.startsWith('D03'))) ok.push(`D03 derja: ${seen.size} keys unique across mappings (${M.length}) and sharedVocabulary (${S.length})`);

  // D04 no identity rows in mappings
  const ident = M.filter((r) => r.derjaAr === r.msa);
  if (ident.length) err(`D04 ${ident.length} mapping(s) map a term to itself (${ident.slice(0, 5).map((r) => r.derjaAr).join('، ')}…) — an identity row is noise in a mapping table and inflates the coverage number; move it to sharedVocabulary`);
  else ok.push('D04 derja: no identity rows in mappings; shared vocabulary is kept in its own list');

  // D05 scripts: the column-order bug that would have seeded Arabic → English
  for (const r of M) {
    if (!ARABIC_ONLY(r.derjaAr)) err(`D05 "${r.derjaAr}": derjaAr must be Arabic script`);
    if (!ARABIC_ONLY(r.msa)) err(`D05 "${r.derjaAr}": msa must be Arabic script, got "${r.msa}" — a Latin target means the columns were swapped or the entry maps out of the language`);
    if (r.derjaLatin !== null && r.derjaLatin !== undefined) {
      const lat = String(r.derjaLatin);
      if (ARABIC.test(lat)) err(`D05 "${r.derjaAr}": derjaLatin contains Arabic script ("${lat}") — the columns are the wrong way round`);
      else if (!LATIN_OK.test(lat)) err(`D05 "${r.derjaAr}": derjaLatin "${lat}" uses a character outside ASCII and Latin-1`);
    }
  }
  if (!errors.some((e) => e.startsWith('D05'))) ok.push('D05 derja: sources and targets are Arabic script, arabizi forms are Latin script');

  // D06 domains
  for (const r of M) {
    const c = Number(r.confidence);
    if (!(c > 0 && c <= 1)) err(`D06 "${r.derjaAr}": confidence ${r.confidence} is not in (0, 1] — numeric(3,2) would reject it or, worse, accept a meaningless value`);
    if (r.source !== 'SEED') err(`D06 "${r.derjaAr}": source must be SEED in a seed file, got ${r.source}`);
    if (r.status !== 'ACTIVE') err(`D06 "${r.derjaAr}": status must be ACTIVE in a seed file, got ${r.status}`);
    // D07 low confidence needs a reason
    if (c < 0.80 && !r.note) err(`D07 "${r.derjaAr}": confidence ${c} with no note — a low-confidence mapping without a written reason is a guess that outlives whoever made it`);
    // D08 context discipline
    if (r.contextRequired) {
      if (!r.contextWhen) err(`D08 "${r.derjaAr}": contextRequired without a contextWhen predicate`);
      if (!r.note) err(`D08 "${r.derjaAr}": contextRequired without a note explaining the two senses`);
      if (c >= 1.00) err(`D08 "${r.derjaAr}": contextRequired with confidence 1.00 — a mapping that needs context cannot also claim certainty`);
      if (!derja.policy?.confidenceSemantics) err('D08 an entry is contextRequired but policy.confidenceSemantics does not say whether that confidence is conditional on contextWhen');
    }
  }
  const ctx = M.filter((r) => r.contextRequired);
  if (!errors.some((e) => /^(D06|D07|D08)/.test(e))) {
    ok.push(`D06–D08 derja: confidences in range, all SEED/ACTIVE, ${M.filter((r) => r.confidence < 0.8).length} low-confidence entries each carry a reason, ${ctx.length} homographs carry a context predicate`);
  }

  // D09 coverage against docs/06 §7
  const covMatch = doc06.match(/~\s*(\d+)\s+seed mappings/);
  const target = covMatch ? Number(covMatch[1]) : (derja.policy?.seedTarget ?? 0);
  if (!covMatch) warn('D09 docs/06 §7 states no "~N seed mappings" coverage target');
  if (target && M.length < target) err(`D09 ${M.length} mappings against a documented target of ~${target} (docs/06 §7) — sharedVocabulary entries do not count, they map nothing`);
  else if (target) ok.push(`D09 derja: ${M.length} mappings, above the ~${target} documented in docs/06 §7`);
  if (derja.policy?.seedTarget && derja.policy.seedTarget !== target) {
    err(`D09 policy.seedTarget (${derja.policy.seedTarget}) disagrees with docs/06 §7 (~${target})`);
  }

  // D10 every documented example must exist
  const exRow = pipelineRow(doc06, 'Examples');
  if (!exRow) warn('D10 docs/06 §7 has no Examples row to check against');
  else {
    const keys = new Map(M.concat(S).map((r) => [r.derjaAr, r]));
    const items = exRow.join(' ').split('·').map((s) => s.trim()).filter(Boolean);
    let n = 0;
    for (const item of items) {
      const m = item.match(/`([^`]+)`\s*(?:→|-&gt;)\s*`([^`]+)`/);
      if (!m) continue;
      const srcs = m[1].split('/').map((s) => s.trim());
      const tgts = m[2].split('/').map((s) => s.trim());
      for (const src of srcs) {
        n++;
        const row = keys.get(src);
        if (!row) { err(`D10 docs/06 §7 documents \`${src}\` but derja-msa.json has no such entry`); continue; }
        const inTargets = tgts.includes(row.msa);
        if (!inTargets && M.includes(row)) {
          warn(`D10 docs/06 §7 maps \`${src}\` → ${tgts.join(' / ')} but the spec maps it → ${row.msa}; recorded in ${row.note ? 'the entry note' : 'no note'}`);
        }
      }
    }
    if (!errors.some((e) => e.startsWith('D10'))) ok.push(`D10 derja: all ${n} dialect examples documented in docs/06 §7 are present`);
  }

  // D11 every digit used in an arabizi form must be handled by the transliteration stage
  const subs = Object.keys(norm?.stages?.arabizi_transliterate?.digitSubstitutions || {});
  const used = new Map();
  for (const r of M) {
    for (const ch of String(r.derjaLatin || '')) {
      if (/[0-9]/.test(ch) && !used.has(ch)) used.set(ch, r.derjaAr);
    }
  }
  for (const [digit, first] of used) {
    if (!subs.includes(digit)) err(`D11 arabizi digit "${digit}" (first seen in "${first}") has no entry in normalization.json digitSubstitutions — those messages are detected as French and never reach the dialect map`);
  }
  if (!errors.some((e) => e.startsWith('D11'))) ok.push(`D11 derja: all ${used.size} arabizi digits in use are covered by the transliteration stage`);

  // D12 categories declared
  const declared = Object.keys(derja.categories || {});
  for (const r of M.concat(S)) {
    if (!declared.includes(r.category)) err(`D12 "${r.derjaAr}": category "${r.category}" is not declared in the categories block`);
  }
  if (!errors.some((e) => e.startsWith('D12'))) ok.push(`D12 derja: ${declared.length} categories declared and no row outside them`);

  // D13 no chains: a target must not itself be a source, or one pass rewrites twice
  const srcSet = new Set(M.map((r) => r.derjaAr));
  for (const r of M) {
    if (srcSet.has(r.msa)) err(`D13 "${r.derjaAr}" → "${r.msa}", which is itself a source in the map — a single normalisation pass would rewrite it again`);
  }
  if (!errors.some((e) => e.startsWith('D13'))) ok.push('D13 derja: no mapping chains into another mapping');

  // D14 a one-character difference is a typo signal — but only where the difference is not a
  // conjugation prefix. Derja and MSA differ systematically in the first person (نعمل / أستعمل),
  // and warning on every one of those buries the real signal: مرابحة → مرابحا, a non-word.
  const PREFIXES = new Set(['ن', 'أ', 'ا', 'ت', 'ي', 'ء', 'إ', 'آ']);
  let d14 = 0;
  for (const r of M) {
    if (!r.derjaAr || !r.msa) continue;
    const a = [...r.derjaAr]; const b = [...r.msa];
    if (a.length !== b.length || a.length < 3) continue;
    const at = a.map((c, i) => (c === b[i] ? -1 : i)).filter((i) => i >= 0);
    if (at.length !== 1) continue;
    if (at[0] === 0 && PREFIXES.has(a[0]) && PREFIXES.has(b[0])) continue;   // conjugation prefix
    warn(`D14 "${r.derjaAr}" → "${r.msa}" differs by one character at position ${at[0]} — verify this is a real dialect pair and not a misspelling (the class of defect that produced مرابحة → مرابحا)`);
    d14++;
  }
  if (!d14) ok.push('D14 derja: no single-character pair outside the conjugation prefixes');

  // D17 a mapping the fold stage already performs is dead weight, and worse: it looks like coverage.
  const charMap = norm?.stages?.fold?.ar?.charMap || {};
  const fold = (t) => [...String(t)].map((c) => charMap[c] || c).join('');
  let d17 = 0;
  for (const r of M) {
    if (!r.derjaAr || !r.msa || r.derjaAr === r.msa) continue;
    if (fold(r.derjaAr) === fold(r.msa)) {
      err(`D17 "${r.derjaAr}" → "${r.msa}" is already performed by the fold stage (both fold to "${fold(r.msa)}") — the entry adds no coverage and can rewrite text the folder has already unified`);
      d17++;
    }
  }
  if (!d17) ok.push('D17 derja: no mapping duplicates what the fold stage already does');

  // D18 keys are compared folded, so two keys that fold identically cannot both be matched.
  const byFold = new Map();
  let d18 = 0;
  for (const r of M) {
    if (!r.derjaAr || !r.msa) continue;
    const k = fold(r.derjaAr);
    if (byFold.has(k)) {
      const prev = byFold.get(k);
      if (prev.msa === r.msa) warn(`D18 "${prev.derjaAr}" and "${r.derjaAr}" fold to the same key with the same target — one of them is unreachable, keep one`);
      else err(`D18 "${prev.derjaAr}" (→ ${prev.msa}) and "${r.derjaAr}" (→ ${r.msa}) fold to the same key "${k}" with different targets; only one can ever match`);
      d18++;
    } else byFold.set(k, r);
  }
  if (!d18) ok.push(`D18 derja: all ${M.length} keys remain distinct once folded`);

  // D16 the map is gated on Derja detection, and a pruned entry must actually be absent
  const gate = derja.policy?.appliesWhen;
  if (!gate) err('D16 policy.appliesWhen is missing: several Derja forms are also valid MSA words with a different meaning, so the map must state when it is applied');
  else if (!/Derja/i.test(gate) || !/MSA/.test(gate)) err('D16 policy.appliesWhen must gate on Derja detection versus MSA');
  for (const pr of (derja.prunedEntries || [])) {
    if (!pr.reason) err(`D16 prunedEntries: "${pr.derjaAr}" has no reason — a removal nobody can explain will be re-added`);
    if (M.some((r) => r.derjaAr === pr.derjaAr) || S.some((r) => r.derjaAr === pr.derjaAr)) {
      err(`D16 "${pr.derjaAr}" is listed as pruned but is still present in the file`);
    }
  }

  // D15 policy must be the documented one
  const pol = derja.policy || {};
  if (pol.inputOnly !== true) err('D15 policy.inputOnly must be true: Derja is understood and retrieved, never emitted');
  if (pol.answersAlwaysMsa !== true) err('D15 policy.answersAlwaysMsa must be true');
  if (pol.religiousContentNeverDerja !== true) err('D15 policy.religiousContentNeverDerja must be true');
  if (!errors.some((e) => e.startsWith('D15'))) ok.push('D15 derja: input-only policy asserted, MSA answers, never Derja for religious content');
  if (!errors.some((e) => e.startsWith('D16'))) ok.push(`D16 derja: applied only to Derja-detected messages; ${(derja.prunedEntries || []).length} pruned entries each carry a reason and are genuinely absent`);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  C — cross-artefact consistency
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function checkCross() {
  if (!norm || !derja) return;

  // C01 the two files must describe the same dialect stage
  const dm = norm.stages?.dialect_map || {};
  if (dm.mapFile && !existsSync(join(I18N, dm.mapFile.split('/').pop()))) {
    err(`C01 dialect_map.mapFile "${dm.mapFile}" does not resolve inside ${I18N}`);
  }
  const pairs = [
    ['onNoMatch', dm.onNoMatch, derja.policy?.onNoMatch],
    ['longestMatchFirst', dm.longestMatchFirst, derja.policy?.longestMatchFirst],
    ['inputOnly', dm.inputOnly, derja.policy?.inputOnly],
  ];
  for (const [name, a, b] of pairs) {
    if (a !== undefined && b !== undefined && a !== b) err(`C01 ${name} is ${JSON.stringify(a)} in normalization.json but ${JSON.stringify(b)} in derja-msa.json`);
  }
  if (dm.enabled !== true) err('C01 dialect_map must be enabled: Derja input is ~a third of front-office traffic');

  // C02 the table the file seeds must exist
  if (derja.table && !schema.includes(`CREATE TABLE ${derja.table} (`)) {
    err(`C02 derja-msa.json names table "${derja.table}", which schema.sql does not create`);
  } else if (derja.table) ok.push(`C02 derja: seeds ${derja.table}, which exists in schema.sql`);

  // C03 glossary expansion must name real columns
  const ge = norm.stages?.glossary_expand || {};
  if (ge.source) {
    const cols = tableColumns(schema, ge.source);
    if (!cols.length) err(`C03 glossary_expand.source "${ge.source}" is not a table in schema.sql`);
    else for (const f of (ge.fields || [])) {
      if (!cols.some((c) => c.name === f)) err(`C03 glossary_expand.fields names \`${f}\`, which ${ge.source} does not have`);
    }
  }

  // C04 currency and locales must agree with specs/config
  const dec = configText.match(/decimals:\s*(\d+)/);
  const cur = configText.match(/code:\s*(TND|EUR|USD)/);
  if (dec && Number(dec[1]) !== norm.formatting?.currency?.decimals) {
    err(`C04 specs/config declares currency decimals ${dec[1]} while normalization.json declares ${norm.formatting?.currency?.decimals}`);
  }
  if (cur && cur[1] !== norm.formatting?.currency?.code) {
    err(`C04 specs/config declares currency ${cur[1]} while normalization.json declares ${norm.formatting?.currency?.code}`);
  }
  const cfgLocales = configText.match(/supported-locales:\s*\[([^\]]*)\]/);
  if (cfgLocales) {
    const fromConfig = cfgLocales[1].split(',').map((s) => s.trim());
    const fromSpec = norm.locales || [];
    const diff = fromConfig.filter((l) => !fromSpec.includes(l)).concat(fromSpec.filter((l) => !fromConfig.includes(l)));
    if (diff.length) err(`C04 locales differ — specs/config has [${fromConfig}], normalization.json has [${fromSpec}]`);
    else ok.push(`C04 i18n: currency and the ${fromSpec.length} supported locales agree with specs/config/application.yaml`);
  }

  // C05 the language the answer is written in is the language of the question
  if (norm.stages?.language_detect?.perMessageNotPerConversation !== true) {
    err('C05 language detection must be per message: a conversation that switches to Arabic must be answered in Arabic from the next question, not from the next session');
  }
}

if (norm) checkNormalization();
if (derja) checkDerja();
if (norm && derja) checkCross();

console.log('\ni18n-lint — specs/i18n/\n' + '─'.repeat(88));
for (const o of ok) console.log('  ok    ' + o);
for (const w of warns) console.log('  WARN  ' + w);
for (const e of errors) console.log('  ERROR ' + e);
console.log('─'.repeat(88));
console.log(`  ${derja?.mappings?.length ?? 0} mappings · ${derja?.sharedVocabulary?.length ?? 0} shared-vocabulary entries · ${norm?.stageOrder?.length ?? 0} normalisation stages · ${PARSER_TOKEN_TYPES.length} parser token types`);
console.log(`  ${ok.length} groups checked · ${warns.length} warning(s) · ${errors.length} error(s)\n`);
process.exit(errors.length ? 1 : 0);
