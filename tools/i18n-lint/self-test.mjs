#!/usr/bin/env node
/**
 * i18n-lint self-test — proves every check can fire.
 *
 * Each mutation introduces exactly one defect into a throwaway copy of specs/i18n, or of one of the
 * four authority files, and asserts that the expected check id appears. Mutating the authorities
 * matters as much as mutating the specs: it is the evidence that the folds, the stem affixes, the
 * token-type coverage, the seed target and the documented dialect examples are read from the
 * documents rather than copied into the linter.
 *
 * The negative controls at the end are what stop the suite from passing by flagging everything. Two
 * of them encode decisions that look like defects and are not: a high-confidence entry with no note
 * (only below 0.80 does a reason become mandatory) and a single-character pair that differs only in
 * the conjugation prefix (نعمل / أستعمل), which is a systematic difference between the dialects and
 * not a misspelling.
 *
 * Usage: node tools/i18n-lint/self-test.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const I18N = join(root, 'specs', 'i18n');
const SCHEMA = join(root, 'specs', 'db', 'schema.sql');
const DOC03 = join(root, 'docs', '03-data-model.md');
const DOC06 = join(root, 'docs', '06-i18n-trilingual-rtl.md');
const CONFIG = join(root, 'specs', 'config', 'application.yaml');
const LINT = join(here, 'lint.mjs');

const readSpecs = () => ({
  norm: JSON.parse(readFileSync(join(I18N, 'normalization.json'), 'utf8')),
  derja: JSON.parse(readFileSync(join(I18N, 'derja-msa.json'), 'utf8')),
});
const clone = (o) => JSON.parse(JSON.stringify(o));
const row = (d, k) => d.derja.mappings.find((r) => r.derjaAr === k);

function run(specs, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'i18nlint-'));
  try {
    writeFileSync(join(dir, 'normalization.json'),
      opts.rawNorm !== undefined ? opts.rawNorm : JSON.stringify(specs.norm, null, 2));
    writeFileSync(join(dir, 'derja-msa.json'),
      opts.rawDerja !== undefined ? opts.rawDerja : JSON.stringify(specs.derja, null, 2));
    const env = { ...process.env, I18N_DIR: dir };
    for (const [key, file, mutate] of [
      ['SCHEMA_FILE', SCHEMA, opts.schema],
      ['DOC03_FILE', DOC03, opts.doc03],
      ['DOC06_FILE', DOC06, opts.doc06],
      ['CONFIG_FILE', CONFIG, opts.config],
    ]) {
      if (!mutate) continue;
      const p = join(dir, file.split('/').pop());
      writeFileSync(p, mutate(readFileSync(file, 'utf8')));
      env[key] = p;
    }
    let out = ''; let code = 0;
    try {
      out = execFileSync(process.execPath, [LINT], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; code = e.status === undefined ? 2 : e.status; }
    return { code, out };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const M = [];
const mut = (id, desc, apply, expect, extra = {}) => M.push({ id, desc, apply, expect, ...extra });

// ── N: normalization.json ───────────────────────────────────────────────────────────────────────
mut('N01a', 'normalization.json is not valid JSON', (d) => d, 'N01 normalization.json: JSON parse failure', { rawNorm: '{ "stages": ' });
mut('N01b', 'a required top-level key disappears from normalization.json', (d) => { delete d.norm.postgresTextSearch; }, 'N01');
mut('N02a', 'a stage is defined but missing from stageOrder', (d) => { d.norm.stageOrder = d.norm.stageOrder.filter((s) => s !== 'fold'); }, 'N02');
mut('N02b', 'stageOrder names a stage that does not exist', (d) => { d.norm.stageOrder.push('sentiment'); }, 'N02');
mut('N03', 'arabizi transliteration runs after language detection', (d) => {
  const o = d.norm.stageOrder; const i = o.indexOf('arabizi_transliterate'); o.splice(i, 1);
  o.splice(o.indexOf('language_detect') + 1, 0, 'arabizi_transliterate');
}, 'N03');
mut('N04a', 'tatweel is no longer stripped', (d) => {
  d.norm.stages.unicode.ar.stripRanges = d.norm.stages.unicode.ar.stripRanges.filter((r) => r.from !== 'U+0640');
}, 'N04');
mut('N04b', 'the Unicode form is downgraded to NFC', (d) => { d.norm.stages.unicode.form = 'NFC'; }, 'N04');
mut('N04c', 'French and English stop being lowercased', (d) => { d.norm.stages.unicode.fr_en.lowercase = false; }, 'N04');
mut('N05a', 'a documented fold is dropped (taa marbuta)', (d) => { delete d.norm.stages.fold.ar.charMap['ة']; }, 'N05');
mut('N05b', 'a documented fold is retargeted (alef to hamza-alef)', (d) => { d.norm.stages.fold.ar.charMap['أ'] = 'إ'; }, 'N05');
mut('N05c', 'an unjustified fold is added', (d) => { d.norm.stages.fold.ar.charMap['ب'] = 'پ'; }, 'N05');
mut('N06a', 'a documented prefix is dropped from the stemmer', (d) => {
  d.norm.stages.stem.ar.stripPrefixes = d.norm.stages.stem.ar.stripPrefixes.filter((x) => x !== 'ال');
}, 'N06');
mut('N06b', 'an undocumented suffix is added to the stemmer', (d) => { d.norm.stages.stem.ar.stripSuffixes.push('تم'); }, 'N06');
mut('N06c', 'the stemmer is allowed to strip greedily', (d) => { d.norm.stages.stem.ar.maxStripPerSide = 3; }, 'N06');
mut('N06d', 'the minimum root length no longer protects triliterals', (d) => { d.norm.stages.stem.ar.minRootLength = 2; }, 'N06');
mut('N07a', 'the spec drops a token type schema.sql maps', (d) => {
  for (const m of d.norm.postgresTextSearch.mappings) m.tokenTypes = m.tokenTypes.filter((t) => t !== 'uint');
}, 'N07');
mut('N07b', 'the spec claims a token type schema.sql does not map', (d) => {
  d.norm.postgresTextSearch.mappings[0].tokenTypes.push('arabic_word');
}, 'N07');
mut('N07c', 'the dictionaries disagree with schema.sql', (d) => {
  d.norm.postgresTextSearch.mappings[0].dictionaries = ['simple'];
}, 'N07');
mut('N07d', 'schema.sql stops mapping uint', (d) => d, 'N07',
  { schema: (t) => t.replace('ADD MAPPING FOR uint, int, float, sfloat WITH simple;', 'ADD MAPPING FOR int, float, sfloat WITH simple;') });
mut('N07e', 'the spec claims Postgres stems Arabic', (d) => { d.norm.postgresTextSearch.arabicStemmingInDatabase = true; }, 'N07');
mut('N07f', 'an excluded token type loses its reason', (d) => { d.norm.postgresTextSearch.intentionallyUnmapped.blank = ''; }, 'N07');
mut('N08', 'the required cluster encoding is no longer UTF8', (d) => {
  d.norm.postgresTextSearch.requiresServerEncoding = 'LATIN1';
  d.norm.stages.unicode.requiresServerEncoding = 'LATIN1';
}, 'N08');
mut('N09', 'appliesTo names a column that does not exist', (d) => { d.norm.appliesTo.indexSide.push('chunk.normalized_body'); }, 'N09');
mut('N09b', 'appliesTo names a table that does not exist', (d) => { d.norm.appliesTo.indexSide.push('chunk_normalised.text'); }, 'N09');
mut('N10', 'display text is declared modifiable', (d) => { d.norm.appliesTo.displayTextNeverModified = false; }, 'N10');
mut('N10b', 'answer_markdown is no longer excluded', (d) => {
  d.norm.appliesTo.neverAppliedTo = d.norm.appliesTo.neverAppliedTo.filter((x) => x !== 'answer_markdown');
}, 'N10');
mut('N11a', 'the dinar is quoted to two decimals', (d) => { d.norm.formatting.currency.decimals = 2; }, 'N11');
mut('N11b', 'the currency changes', (d) => { d.norm.formatting.currency.code = 'EUR'; }, 'N11');
mut('N13a', 'dialect mapping runs after stemming', (d) => {
  const o = d.norm.stageOrder; const i = o.indexOf('dialect_map'); o.splice(i, 1);
  o.splice(o.indexOf('stem') + 1, 0, 'dialect_map');
}, 'N13');
mut('N13b', 'dialect mapping runs before folding', (d) => {
  const o = d.norm.stageOrder; const i = o.indexOf('dialect_map'); o.splice(i, 1);
  o.splice(o.indexOf('fold'), 0, 'dialect_map');
}, 'N13');

// ── D: derja-msa.json ───────────────────────────────────────────────────────────────────────────
mut('D01a', 'derja-msa.json loses its policy block', (d) => { delete d.derja.policy; }, 'D01');
mut('D01b', 'derja-msa.json is not valid JSON', (d) => d, 'D01 derja-msa.json: JSON parse failure', { rawDerja: '{ "mappings": [' });
mut('D02a', 'a row carries a field that is not a column or declared metadata', (d) => { row(d, 'نحب').reviewedBy = 'x'; }, 'D02');
mut('D02b', 'a row loses a NOT NULL column', (d) => { delete row(d, 'نحب').msa; }, 'D02');
mut('D03', 'two rows claim the same unique key', (d) => { d.derja.mappings.push({ ...row(d, 'برشة') }); }, 'D03');
mut('D03b', 'a key appears in both mappings and sharedVocabulary', (d) => {
  d.derja.sharedVocabulary.push({ ...row(d, 'برشة'), msa: 'برشة' });
}, 'D03');
mut('D04', 'an identity row is added to mappings', (d) => {
  d.derja.mappings.push({ derjaAr: 'مصرف', derjaLatin: 'masraf', msa: 'مصرف', glossEn: 'bank', confidence: 0.98, category: 'finance', source: 'SEED', status: 'ACTIVE' });
}, 'D04');
mut('D05a', 'a target is written in Latin script (the swapped-column defect)', (d) => { row(d, 'برشة').msa = 'beaucoup'; }, 'D05');
mut('D05b', 'an arabizi form contains Arabic script', (d) => { row(d, 'نحب').derjaLatin = 'ne7eb نحب'; }, 'D05');
mut('D06a', 'a confidence leaves the (0,1] range', (d) => { row(d, 'نحب').confidence = 1.5; }, 'D06');
mut('D06b', 'a seed row claims an ADMIN source', (d) => { row(d, 'نحب').source = 'ADMIN'; }, 'D06');
mut('D06c', 'a seed row is shipped REJECTED', (d) => { row(d, 'نحب').status = 'REJECTED'; }, 'D06');
mut('D07', 'a low-confidence entry has no written reason', (d) => { const r = row(d, 'حوش'); r.confidence = 0.55; delete r.note; delete r.contextRequired; delete r.contextWhen; }, 'D07');
mut('D08a', 'a context-gated entry loses its predicate', (d) => { delete row(d, 'كان').contextWhen; }, 'D08');
mut('D08b', 'a context-gated entry claims certainty', (d) => { row(d, 'كان').confidence = 1.0; }, 'D08');
mut('D09a', 'coverage falls below the documented target', (d) => { d.derja.mappings = d.derja.mappings.slice(0, 300); }, 'D09');
mut('D09b', 'the declared target disagrees with the document', (d) => { d.derja.policy.seedTarget = 999; }, 'D09');
mut('D09c', 'docs/06 raises the coverage target', (d) => d, 'D09', { doc06: (t) => t.replace('~350 seed mappings', '~400 seed mappings') });
mut('D10a', 'a dialect example documented in docs/06 is missing', (d) => {
  d.derja.mappings = d.derja.mappings.filter((r) => r.derjaAr !== 'شنوة');
}, 'D10');
mut('D10b', 'docs/06 documents a new example the spec does not carry', (d) => d, 'D10',
  { doc06: (t) => t.replace('· `وين` → `أين` |', '· `وين` → `أين` · `شنقال` → `أين` |') });
mut('D11', 'an arabizi digit is not covered by the transliteration stage', (d) => {
  row(d, 'نحب').derjaLatin = 'n0heb';   // 0 and 1 are the two digits the table does not define
}, 'D11');
mut('D12', 'a row uses an undeclared category', (d) => { row(d, 'نحب').category = 'verbs'; }, 'D12');
mut('D13', 'a target is itself a mapping source (a chain)', (d) => { row(d, 'ياسر').msa = 'نحب'; }, 'D13');
mut('D14', 'a target differs from its source by one interior character', (d) => { row(d, 'ياسر').msa = 'كثيراا'; }, 'D14', { warnOnly: true });
mut('D15', 'the input-only policy is dropped', (d) => { d.derja.policy.inputOnly = false; }, 'D15');
mut('D15b', 'answers are allowed in Derja', (d) => { d.derja.policy.answersAlwaysMsa = false; }, 'D15');
mut('D15c', 'religious content may be answered in Derja', (d) => { d.derja.policy.religiousContentNeverDerja = false; }, 'D15');
mut('D16a', 'the apply gate is removed', (d) => { delete d.derja.policy.appliesWhen; }, 'D16');
mut('D16b', 'a pruned entry is re-added', (d) => {
  d.derja.mappings.push({ derjaAr: 'ما', derjaLatin: 'ma', msa: 'لا', glossEn: 'not', confidence: 0.95, category: 'negation', source: 'SEED', status: 'ACTIVE' });
}, 'D16');
mut('D16c', 'a pruned entry loses its reason', (d) => { d.derja.prunedEntries[0].reason = ''; }, 'D16');
mut('D17', 'a fold-redundant entry is re-added', (d) => {
  d.derja.mappings.push({ derjaAr: 'جيت', derjaLatin: 'jit', msa: 'جئت', glossEn: 'I came', confidence: 0.98, category: 'verb', source: 'SEED', status: 'ACTIVE' });
}, 'D17');
mut('D18', 'two keys collapse onto each other once folded', (d) => {
  d.derja.mappings.push({ derjaAr: 'كرى', derjaLatin: 'kra', msa: 'استأجر', glossEn: 'he rented', confidence: 0.95, category: 'finance', source: 'SEED', status: 'ACTIVE' });
}, 'D18');

// ── C: cross-artefact ───────────────────────────────────────────────────────────────────────────
mut('C01a', 'the dialect stage points at a file that does not exist', (d) => { d.norm.stages.dialect_map.mapFile = 'derja-map.json'; }, 'C01');
mut('C01b', 'the dialect stage is switched off', (d) => { d.norm.stages.dialect_map.enabled = false; }, 'C01');
mut('C01c', 'the two files disagree about unmatched input', (d) => { d.norm.stages.dialect_map.onNoMatch = 'DROP'; }, 'C01');
mut('C02', 'the seeded table does not exist', (d) => { d.derja.table = 'derja_map'; }, 'C02');
mut('C03', 'glossary expansion names a column that does not exist', (d) => { d.norm.stages.glossary_expand.fields.push('synonyms_de'); }, 'C03');
mut('C04a', 'specs/config and the i18n spec disagree about decimals', (d) => d, 'C04',
  { config: (t) => t.replace('decimals: 3', 'decimals: 2') });
mut('C04b', 'specs/config drops a locale', (d) => d, 'C04',
  { config: (t) => t.replace('supported-locales: [fr-FR, ar-TN, en-GB]', 'supported-locales: [fr-FR, en-GB]') });
mut('C05', 'answer language is decided per conversation', (d) => { d.norm.stages.language_detect.perMessageNotPerConversation = false; }, 'C05');

// ── negative controls ───────────────────────────────────────────────────────────────────────────
mut('Z1', 'no mutation at all', () => {}, null, { silent: true });
mut('Z2', 'a high-confidence entry carries no note, as it need not', (d) => {
  const r = row(d, 'برشة'); r.confidence = 0.98; delete r.note;
}, null, { silent: true });
mut('Z3', 'a single-character pair that differs only in the conjugation prefix', (d) => {
  d.derja.mappings.push({ derjaAr: 'نستظهر', derjaLatin: 'nestadher', msa: 'أستظهر', glossEn: 'I produce (a document)', confidence: 0.95, category: 'verb', source: 'SEED', status: 'ACTIVE' });
}, null, { silent: true });
mut('Z4', 'a target that is shared vocabulary, not a mapping source (no chain)', (d) => {
  row(d, 'ياسر').msa = 'حساب';
}, null, { silent: true });
mut('Z5', 'blank stays unmapped, as it must', (d) => {
  d.norm.postgresTextSearch.intentionallyUnmapped.blank = 'whitespace';
}, null, { silent: true });
mut('Z6', 'an arabizi form uses é, which Tunisian keyboards produce', (d) => {
  row(d, 'نحب').derjaLatin = 'néheb';
}, null, { silent: true });
mut('Z7', 'a context-gated entry carries 0.90 conditional confidence', (d) => {
  const r = row(d, 'كان'); r.confidence = 0.90;
}, null, { silent: true });

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\ni18n-lint self-test\n' + '─'.repeat(88));
let pass = 0; const fail = [];
for (const m of M) {
  const specs = readSpecs();
  try { m.apply(specs); } catch (e) { fail.push([m.id, `mutation threw: ${e.message}`]); continue; }
  const opts = { ...m };
  const res = run(specs, opts);

  if (m.silent) {
    if (res.code === 0) { pass++; console.log(`  ok    ${m.id.padEnd(6)} silent — ${m.desc}`); }
    else fail.push([m.id, `expected silence, got ${res.out.split('\n').filter((l) => l.includes('ERROR')).slice(0, 2).map((l) => l.trim()).join(' | ') || `exit ${res.code}`}`]);
    continue;
  }
  if (m.warnOnly) {
    if (res.out.includes(m.expect) && !res.out.split('\n').some((l) => l.includes('ERROR') && l.includes(` ${m.expect} `))) {
      pass++; console.log(`  ok    ${m.id.padEnd(6)} warns ${m.expect} without failing — ${m.desc}`);
    } else fail.push([m.id, `expected a ${m.expect} warning and no ${m.expect} error — ${m.desc}`]);
    continue;
  }
  if (res.out.includes(m.expect) && res.code !== 0) { pass++; console.log(`  ok    ${m.id.padEnd(6)} fires ${m.expect} — ${m.desc}`); }
  else fail.push([m.id, `"${m.expect}" ${res.out.includes(m.expect) ? 'present but exit 0' : 'absent'} — ${m.desc}`]);
}
console.log('─'.repeat(88));
for (const [id, why] of fail) console.log(`  FAIL  ${id.padEnd(6)} ${why}`);
console.log(`  ${pass}/${M.length} mutations behaved as expected · ${fail.length} failure(s)\n`);
process.exit(fail.length ? 1 : 0);
