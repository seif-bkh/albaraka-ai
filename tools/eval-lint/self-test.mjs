#!/usr/bin/env node
/**
 * eval-lint mutation self-test
 *
 * Same discipline as tools/prompt-lint/self-test.mjs: a check that has never been seen to fail is
 * not evidence. Each mutation copies specs/eval/ to a temp dir, breaks exactly one thing, and
 * asserts that lint.mjs reports it.
 *
 * Two of the mutations are NEGATIVE CONTROLS (N1, N2): they break nothing and must keep passing.
 * Without them, a rule as blunt as "any refusal may not cite anything" would look correct — and it
 * would silently invalidate every REF-02/REF-03/REF-05 case, whose templates embed grounded blocks.
 *
 * Usage: node tools/eval-lint/self-test.mjs
 */
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const SRC = join(root, 'specs', 'eval');
const LINT = join(here, 'lint.mjs');
const GS = 'golden-set.jsonl';
const RT = 'red-team.jsonl';
const KM = 'kb-manifest.jsonl';

function runLint(dir) {
  try {
    const out = execFileSync(process.execPath, [LINT], {
      env: { ...process.env, EVAL_DIR: dir }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'eval-lint-')); cpSync(SRC, d, { recursive: true }); return d; };

const loadJsonl = (d, f) => readFileSync(join(d, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const dumpJsonl = (d, f, rows) => writeFileSync(join(d, f), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

/** Mutate one row by id, in one file. Throws if the row or the anchor does not exist. */
const patch = (d, file, id, fn) => {
  const rows = loadJsonl(d, file);
  const i = rows.findIndex((r) => (r.id ?? r.chunkId) === id);
  if (i < 0) throw new Error(`no row with id ${id} in ${file}`);
  const before = JSON.stringify(rows[i]);
  fn(rows[i]);
  if (before === JSON.stringify(rows[i])) throw new Error(`mutation on ${id} changed nothing — anchor drifted`);
  dumpJsonl(d, file, rows);
};

const MUTATIONS = [
  // ── negative controls: these must NOT be flagged ──────────────────────────────────────────────
  { id: 'N1 a REF-02 case gains a second grounded citation requirement', expectPass: true,
    run: (d) => patch(d, GS, 'GS-EN-REF-081', (c) => { c.mustCiteChunks = ['chk-mourabaha-part-vehicule', 'chk-mourabaha-part-def']; }),
    expect: null },
  { id: 'N2b a REF-03 case may require the grounded documentation block', expectPass: true,
    run: (d) => patch(d, GS, 'GS-FR-REF-074', (c) => { c.mustCiteChunks = ['chk-comite-charia']; }),
    expect: null },
  { id: 'N3 a REF-05 case keeps its grounded top-sources requirement', expectPass: true,
    run: (d) => patch(d, GS, 'GS-FR-PROC-091', (c) => { c.mustNotCiteChunks = ['chk-tarifs-2024-compte']; }),
    expect: null },

  // ── referential integrity ─────────────────────────────────────────────────────────────────────
  { id: 'M01 a case points at a chunk that does not exist',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-001', (c) => { c.mustCiteChunks = ['chk-does-not-exist']; }),
    expect: 'mustCiteChunks references unknown chunk chk-does-not-exist' },
  { id: 'M02 a case must cite a RETIRED chunk (it can never pass)',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-001', (c) => { c.mustCiteChunks = ['chk-tarifs-2024-compte']; }),
    expect: 'which is RETIRED' },
  { id: 'M03 a case must cite a QUARANTINED chunk',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-001', (c) => { c.mustCiteChunks = ['chk-injected-upload-01']; }),
    expect: 'which is QUARANTINED' },
  { id: 'M04 a front-office case must cite an INTERNAL chunk',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-001', (c) => { c.mustCiteChunks = ['chk-loi-2016-48-produits']; }),
    expect: 'at classification INTERNAL' },
  { id: 'M05 a chunk is both must-cite and must-not-cite',
    run: (d) => patch(d, GS, 'GS-FR-TARI-018', (c) => { c.mustNotCiteChunks = ['chk-tarifs-2026-compte']; }),
    expect: 'is both must-cite and must-not-cite' },
  { id: 'M06 duplicate case id',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-002', (c) => { c.id = 'GS-FR-MOUR-001'; }),
    expect: 'duplicate id' },
  { id: 'M07 the same id used by the golden set and the red-team suite',
    run: (d) => patch(d, RT, 'RT-02', (c) => { c.id = 'GS-FR-MOUR-001'; }),
    expect: 'used by both the golden set and the red-team suite' },
  { id: 'M08 a malformed JSONL line',
    run: (d) => { const f = join(d, GS); const lines = readFileSync(f, 'utf8').split('\n');
      lines[1] = lines[1].slice(0, -3); writeFileSync(f, lines.join('\n'), 'utf8'); },
    expect: 'invalid JSON' },

  // ── value domains ─────────────────────────────────────────────────────────────────────────────
  { id: 'M09 unknown intent code',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-001', (c) => { c.expectedIntents = ['PRODUCT_INQUIRY']; }),
    expect: 'unknown intent PRODUCT_INQUIRY' },
  { id: 'M10 unknown refusal code',
    run: (d) => patch(d, GS, 'GS-FR-REF-074', (c) => { c.expectRefusalCode = 'REF-09'; }),
    expect: 'unknown refusal code REF-09' },
  { id: 'M11 unknown locale',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-001', (c) => { c.questionLang = 'fr-TN'; }),
    expect: 'not in fr-FR|ar-TN|en-GB' },
  { id: 'M12 weight outside 1–5',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-001', (c) => { c.weight = 9; }),
    expect: 'weight must be an integer 1–5' },
  { id: 'M13 empty expectedIntents',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-001', (c) => { c.expectedIntents = []; }),
    expect: 'expectedIntents is empty' },

  // ── internal consistency ──────────────────────────────────────────────────────────────────────
  { id: 'M14 question language differs from expected answer language',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-001', (c) => { c.expectedAnswerLang = 'en-GB'; }),
    expect: 'expectedAnswerLang differs from questionLang' },
  { id: 'M15 a required term is also forbidden (the "pas garanti" / "garanti" bug)',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-001', (c) => { c.mustNotContainTerms = ['Mourabaha']; }),
    expect: 'is both required and forbidden' },
  { id: 'M16 a forbidden term is a substring of a required term',
    run: (d) => patch(d, GS, 'GS-FR-MOUD-012', (c) => { c.mustNotContainTerms = ['pourcentage']; c.mustContainTerms = ['pourcentage du profit']; }),
    expect: 'term collision' },
  { id: 'M17 an invalid regex in mustContainPatterns',
    run: (d) => patch(d, GS, 'GS-FR-TARI-018', (c) => { c.mustContainPatterns = ['3[.,000']; }),
    expect: 'is not a valid regex' },
  { id: 'M18 a static-copy refusal (REF-01) required to cite chunks',
    run: (d) => patch(d, RT, 'RT-03', (c) => { c.mustCiteChunks = ['chk-mourabaha-part-def']; }),
    expect: 'that template is composed of static copy only' },
  { id: 'M19 an answer case with no reference answer',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-001', (c) => { c.referenceAnswer = ''; }),
    expect: 'referenceAnswer is missing or too short' },
  { id: 'M20 a TARIFF case that pins no figure',
    run: (d) => patch(d, GS, 'GS-FR-TARI-019', (c) => { c.mustContainTerms = []; c.mustContainPatterns = []; }),
    expect: 'tagged TARIFF but pins no figure' },
  { id: 'M21 addedAt is not an ISO date',
    run: (d) => patch(d, GS, 'GS-FR-MOUR-001', (c) => { c.addedAt = '03/09/2026'; }),
    expect: 'addedAt must be an ISO date' },

  // ── red-team specifics ────────────────────────────────────────────────────────────────────────
  { id: 'M22 a documented RT case is deleted',
    run: (d) => dumpJsonl(d, RT, loadJsonl(d, RT).filter((c) => c.id !== 'RT-09')),
    expect: 'RT-09 from docs/05 is missing' },
  { id: 'M23 two red-team cases share an attack family',
    run: (d) => patch(d, RT, 'RT-09', (c) => { c.family = 'INJECTION_FATWA_SMUGGLING'; }),
    expect: 'family INJECTION_FATWA_SMUGGLING used by both' },
  { id: 'M24 an S1 attack forbids no term — nothing observable is asserted',
    run: (d) => patch(d, RT, 'RT-04', (c) => { c.mustNotContainTerms = []; }),
    expect: 'an S1 case must forbid at least one term' },
  { id: 'M25 an S1 attack down-weighted below the critical cases',
    run: (d) => patch(d, RT, 'RT-04', (c) => { c.weight = 2; }),
    expect: 'S1 severity with weight 2' },
  { id: 'M26 a guardrail layer with no owner (malformed entry)',
    run: (d) => patch(d, RT, 'RT-04', (c) => { c.guardrailLayers = ['someone should catch this']; }),
    expect: 'must be "<stage>:<POLICY>"' },
  { id: 'M27 a red-team case with no detection point',
    run: (d) => patch(d, RT, 'RT-04', (c) => { c.detectionPoint = ''; }),
    expect: 'detectionPoint missing' },
  { id: 'M28 a red-team case that asserts nothing at all',
    run: (d) => patch(d, RT, 'RT-06', (c) => { c.expectRefusalCode = null; c.mustCiteChunks = []; c.mustNotContainTerms = []; }),
    expect: 'asserts nothing' },

  // ── manifest coherence ────────────────────────────────────────────────────────────────────────
  { id: 'M29 a chunk claims Sharia approval with no approval reference',
    run: (d) => patch(d, KM, 'chk-mourabaha-part-def', (c) => { c.shariaApprovalRef = null; }),
    expect: 'shariaApproved=true without shariaApprovalRef' },
  { id: 'M30 a PUBLISHED chunk whose validity has already expired',
    run: (d) => patch(d, KM, 'chk-tarifs-2026-compte', (c) => { c.validTo = '2026-06-30'; }),
    expect: 'state=PUBLISHED but validity expired' },
  { id: 'M31 a RETIRED chunk with no validTo (the temporal gate cannot close it)',
    run: (d) => patch(d, KM, 'chk-tarifs-2024-compte', (c) => { c.validTo = null; }),
    expect: 'RETIRED without validTo' },
  { id: 'M32 a T3 chunk that is not Sharia-approved',
    run: (d) => patch(d, KM, 'chk-riba', (c) => { c.shariaApproved = false; c.shariaApprovalRef = null; }),
    expect: 'a T3 chunk must be Sharia-approved' },
  { id: 'M33 duplicate chunk id in the manifest',
    run: (d) => { const rows = loadJsonl(d, KM); rows.push({ ...rows[0] }); dumpJsonl(d, KM, rows); },
    expect: 'duplicate chunkId' },
  { id: 'M34 a chunk with an out-of-range token count',
    run: (d) => patch(d, KM, 'chk-riba', (c) => { c.tokens = 4000; }),
    expect: 'outside the 50–1200 chunking window' },

  // ── composition ───────────────────────────────────────────────────────────────────────────────
  { id: 'M35 the French slice collapses below its target share',
    run: (d) => dumpJsonl(d, GS, loadJsonl(d, GS).filter((c) => !(c.questionLang === 'fr-FR' && /[1-8]$/.test(c.id)))),
    expect: 'language slice fr-FR is' },
  { id: 'M36 every tariff case is deleted, skewing the topic mix',
    run: (d) => dumpJsonl(d, GS, loadJsonl(d, GS).filter((c) => !(c.tags || []).includes('TARIFF'))),
    expect: 'topic slice TARIFF is' },
];

let failures = 0, broken = 0;
console.log('\neval-lint self-test — mutation detection\n' + '─'.repeat(86));

{
  const d = scratch(); const { code, out } = runLint(d); rmSync(d, { recursive: true, force: true });
  if (code !== 0) {
    console.log('  ABORT BASELINE — the unmutated sets do not pass the linter:');
    console.log(out.split('\n').filter((l) => l.includes('ERROR')).map((l) => '        ' + l.trim()).join('\n'));
    console.log('─'.repeat(86) + '\n'); process.exit(1);
  }
  console.log('  ok      BASELINE — unmutated sets pass (exit 0)');
}

for (const m of MUTATIONS) {
  const d = scratch();
  let applied = true;
  try { m.run(d); } catch (e) { applied = false; broken++; console.log(`  BROKEN  ${m.id}\n          mutation could not be applied: ${e.message}`); }
  if (applied) {
    const { code, out } = runLint(d);
    let good;
    if (m.expectPass) good = code === 0;
    else good = code !== 0 && out.includes(m.expect);
    if (good) console.log(`  ok      ${m.id}${m.expectPass ? '  (negative control)' : ''}`);
    else {
      failures++;
      console.log(`  ${m.expectPass ? 'FALSE POSITIVE' : 'MISSED'}  ${m.id}`);
      if (m.expectPass) console.log('          the linter flagged a legitimate case:');
      else console.log(`          expected the linter to report: ${m.expect}`);
      console.log(`          exit code: ${code}`);
      const rep = out.split('\n').filter((l) => l.includes('ERROR')).slice(0, 3);
      console.log(rep.length ? '          ' + rep.map((l) => l.trim()).join('\n          ') : '          it reported nothing');
    }
  }
  rmSync(d, { recursive: true, force: true });
}

console.log('─'.repeat(86));
console.log(`  ${MUTATIONS.length} mutations · ${MUTATIONS.length - failures - broken} correct · ${failures} WRONG · ${broken} BROKEN\n`);
process.exit(failures || broken ? 1 : 0);
