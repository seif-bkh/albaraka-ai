#!/usr/bin/env node
/**
 * prompt-lint mutation self-test
 *
 * A linter that has never been seen to fail is not evidence of anything. This script copies
 * specs/prompts/ into a temp directory, introduces ONE known violation at a time, and asserts that
 * `lint.mjs` exits non-zero and reports the expected error. A mutation that goes undetected means
 * the corresponding check in lint.mjs is vacuous, and this script fails.
 *
 * The unmutated copy is linted first: if the baseline is not clean, every mutation test would
 * "pass" for the wrong reason, so the run aborts.
 *
 * Markdown mutations are textual. YAML mutations are structural (load → change → dump) so that a
 * test never depends on indentation luck.
 *
 * Usage:  node tools/prompt-lint/self-test.mjs
 * Deps:   js-yaml (same as lint.mjs)
 */
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const SRC = join(root, 'specs', 'prompts');
const LINT = join(here, 'lint.mjs');
const REFUSALS = 'templates.refusals.yaml';

/** Run the linter against a directory. Returns {code, out}. Never throws. */
function runLint(dir) {
  try {
    const out = execFileSync(process.execPath, [LINT], {
      env: { ...process.env, PROMPT_DIR: dir },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
}

const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-lint-'));
  cpSync(SRC, dir, { recursive: true });
  return dir;
};

const mutateText = (dir, file, fn) => {
  const p = join(dir, file);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (before === after) throw new Error(`mutation on ${file} changed nothing — the anchor string drifted`);
  writeFileSync(p, after, 'utf8');
};

const mutateYaml = (dir, file, fn) => {
  const p = join(dir, file);
  const doc = yaml.load(readFileSync(p, 'utf8'));
  fn(doc);
  writeFileSync(p, yaml.dump(doc, { lineWidth: 100, noRefs: true }), 'utf8');
};

const tmpl = (doc, code) => doc.templates.find((t) => t.code === code);
const words = (n) => Array.from({ length: n }, (_, i) => `mot${i}`).join(' ');

// ── the mutations ────────────────────────────────────────────────────────────────────────────────
const MUTATIONS = [
  // ── protected clauses: the guarantee the whole governance model rests on ───────────────────────
  {
    id: 'M01 clause deleted from body, still declared (the HTTP 422 case)',
    run: (d) => mutateText(d, 'system.assistant.fr.md', (t) => t.replace(/⟦PROTECTED:NO_FATWA⟧[\s\S]*?⟦\/PROTECTED⟧\n/, '')),
    expect: 'clause NO_FATWA declared in front matter but ABSENT from the body',
  },
  {
    id: 'M02 clause deleted from front matter, still in body',
    run: (d) => mutateText(d, 'system.assistant.en.md', (t) => t.replace(/^\s*-\s*NO_PII\s*$/m, '')),
    expect: 'clause NO_PII present in the body but not declared in front matter',
  },
  {
    id: 'M03 unbalanced protected marker (closing tag removed)',
    run: (d) => mutateText(d, 'system.assistant.ar.md', (t) => t.replace('⟦/PROTECTED⟧', '')),
    expect: 'unbalanced protected markers',
  },
  {
    id: 'M04 clause emptied of its content',
    run: (d) => mutateText(d, 'system.assistant.fr.md', (t) => t.replace(/(⟦PROTECTED:CITATION_REQUIRED⟧)[\s\S]*?(⟦\/PROTECTED⟧)/, '$1 ok $2')),
    expect: 'protected clause CITATION_REQUIRED is suspiciously short',
  },
  {
    id: 'M05 a locale loses a clause the others keep',
    run: (d) => mutateText(d, 'system.assistant.ar.md', (t) => t
      .replace(/⟦PROTECTED:GROUNDED_ONLY⟧[\s\S]*?⟦\/PROTECTED⟧\n/, '')
      .replace(/^\s*-\s*GROUNDED_ONLY\s*$/m, '')),
    expect: 'protected-clause set differs from',
  },
  {
    id: 'M06 an entire locale file is deleted',
    run: (d) => rmSync(join(d, 'system.assistant.en.md')),
    expect: 'MISSING — all three locales of SYSTEM_ASSISTANT are required',
  },

  // ── variables and output contract ─────────────────────────────────────────────────────────────
  {
    id: 'M07 variable used in the body but never declared',
    run: (d) => mutateText(d, 'system.assistant.fr.md', (t) => t.replace('{{question}}', '{{question}} {{secret_new_var}}')),
    expect: '{{secret_new_var}} used in body but not declared',
  },
  {
    id: 'M08 variable declared but never used',
    run: (d) => mutateText(d, 'system.assistant.en.md', (t) => t.replace(/^\s*-\s*channel\s*$/m, '  - channel\n  - orphan_variable')),
    expect: 'variable `orphan_variable` declared but never used',
  },
  {
    id: 'M09 an output-contract key is dropped',
    run: (d) => mutateText(d, 'system.assistant.fr.md', (t) => t.replace(/"needs_human": false,\n\s*/, '')),
    expect: 'output contract missing key "needs_human"',
  },
  {
    id: 'M10 a no_answer_reason value is dropped',
    run: (d) => mutateText(d, 'system.assistant.en.md', (t) => t.replace('`RELIGIOUS_RULING`, `PERSONAL_DATA`', '`PERSONAL_DATA`')),
    expect: 'no_answer_reason enum missing RELIGIOUS_RULING',
  },
  {
    id: 'M11 variable sets drift between locales',
    run: (d) => mutateText(d, 'system.assistant.ar.md', (t) => t
      .replace('{{question}}', '{{question}} {{ar_only_var}}')
      .replace(/^\s*-\s*question\s*$/m, '  - question\n  - ar_only_var')),
    expect: 'variable set differs from',
  },

  // ── governance flags ──────────────────────────────────────────────────────────────────────────
  {
    id: 'M12 Sharia approval switched off on the system prompt',
    run: (d) => mutateText(d, 'system.assistant.fr.md', (t) => t.replace('requires_sharia_approval: true', 'requires_sharia_approval: false')),
    expect: 'SYSTEM_ASSISTANT must require Sharia approval',
  },
  {
    id: 'M13 a utility prompt given a non-zero temperature',
    run: (d) => mutateText(d, 'utility.prompts.md', (t) => t.replace('temperature: 0.0', 'temperature: 0.7')),
    expect: 'must run at temperature 0',
  },
  {
    id: 'M14 guardrail judge loses its fail-safe contract',
    run: (d) => mutateText(d, 'guardrail.sharia.judge.md', (t) => t.replace(/\*\*Fail-safe\.\*\*/g, '**Degradation.**').replace(/fail-safe/g, 'best-effort')),
    expect: 'must document its fail-safe behaviour',
  },
  {
    id: 'M15 guardrail judge latency budget blown past 500 ms',
    run: (d) => mutateText(d, 'guardrail.sharia.judge.md', (t) => t.replace('latency_budget_ms: 450', 'latency_budget_ms: 1200')),
    expect: 'latency_budget_ms must be set and ≤500',
  },
  {
    id: 'M16 EVAL_JUDGE no longer fail-closed',
    run: (d) => mutateText(d, 'utility.prompts.md', (t) => t.replace(/fail-closed/gi, 'best-effort')),
    expect: 'EVAL_JUDGE must document fail-closed behaviour',
  },
  {
    id: 'M17 a prompt_code from the DB enum is left unspecified',
    run: (d) => mutateText(d, 'utility.prompts.md', (t) => t.replace(/EVAL_JUDGE/g, 'LLM_ARBITER')),
    expect: 'prompt_code EVAL_JUDGE is in the DB enum but no spec file defines it',
  },
  {
    id: 'M18 the fallback table is removed',
    run: (d) => mutateText(d, 'utility.prompts.md', (t) => t.replace('Fallback on failure', 'What happens next')),
    expect: 'missing the per-prompt fallback table',
  },

  // ── refusal templates: R1–R8 ──────────────────────────────────────────────────────────────────
  {
    id: 'M19 R1 — a refusal issues a religious verdict',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { tmpl(doc, 'REF-03').locales['en-GB'].title = 'This is halal according to our committee'; }),
    expect: 'R1 REF-03 en-GB contains a religious verdict word',
  },
  {
    id: 'M20 R2 — a refusal names an interest-based product affirmatively',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { tmpl(doc, 'REF-02').locales['fr-FR'].body = 'Nous proposons un crédit classique au taux d\'intérêt de 5 pour cent.'; }),
    expect: 'R2 REF-02 fr-FR names an interest-based product outside a negation',
  },
  {
    id: 'M21 R3 — a refusal discloses system internals',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { tmpl(doc, 'REF-01').locales['fr-FR'].body = 'Mon guardrail a bloqué cette demande.'; }),
    expect: 'R3 REF-01 fr-FR discloses system internals',
  },
  {
    id: 'M22 R5 — a refusal body exceeds 60 words',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { tmpl(doc, 'REF-01').locales['fr-FR'].body = words(70); }),
    expect: 'R5 REF-01 fr-FR body is',
  },
  {
    id: 'M23 R5 — a refusal title exceeds 8 words',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { tmpl(doc, 'REF-06').locales['ar-TN'].title = words(11); }),
    expect: 'R5 REF-06 ar-TN title is',
  },
  {
    id: 'M24 R6 — a refusal becomes a dead end',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => {
      const t = tmpl(doc, 'REF-02');
      for (const L of ['fr-FR', 'ar-TN', 'en-GB']) t.locales[L].cta = null;
      t.locales['fr-FR'].body = t.locales['fr-FR'].body.replace('{{handoff_channel}}', '');
      delete t.referral;
    }),
    expect: 'R6 REF-02 offers no next step',
  },
  {
    id: 'M25 R8 — Arabic copy polluted with Latin letters',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { tmpl(doc, 'REF-03').locales['ar-TN'].title = 'لا يمكنني إصدار fatwa شرعي'; }),
    expect: 'R8 REF-03 ar-TN contains Latin letters outside placeholders',
  },
  {
    id: 'M26 a whole locale disappears from a template',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { delete tmpl(doc, 'REF-04').locales['ar-TN']; }),
    expect: 'REF-04 missing locale ar-TN',
  },
  {
    id: 'M27 an undeclared placeholder is introduced',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { tmpl(doc, 'REF-05').locales['fr-FR'].body += ' {{unknown_thing}}'; }),
    expect: 'undeclared placeholder {{unknown_thing}}',
  },
  {
    id: 'M28 REF-01 is given a CTA (an attack must not earn a human channel)',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { tmpl(doc, 'REF-01').locales['fr-FR'].cta = 'Parler à un conseiller'; }),
    expect: 'REF-01 must not offer a CTA',
  },
  {
    id: 'M29 a template is dropped from the file',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { doc.templates = doc.templates.filter((t) => t.code !== 'REF-06'); }),
    expect: 'expected exactly 6 templates',
  },
  {
    id: 'M30 a customer-facing REF-05 variant leaks internals',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { tmpl(doc, 'REF-05').variants.technical.locales['fr-FR'].body = 'Le modèle a échoué.'; }),
    expect: 'R3 REF-05.technical fr-FR is customer-facing but discloses internals',
  },
  {
    id: 'M31 a disclaimer points at a refusal code that does not exist',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { doc.disclaimers['DISC-PII'].applies_to = ['REF-99']; }),
    expect: 'disclaimer DISC-PII applies to unknown code REF-99',
  },
  {
    id: 'M32 a follow-up pool loses a locale',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { delete doc.followup_pools.PRODUCT_CATALOGUE['ar-TN']; }),
    expect: 'followup pool PRODUCT_CATALOGUE must offer ≥3 chips in ar-TN',
  },
  {
    id: 'M33 refusal templates de-flagged from Sharia approval',
    run: (d) => mutateYaml(d, REFUSALS, (doc) => { doc.requires_sharia_approval = false; }),
    expect: 'refusal templates must require Sharia approval',
  },
];

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
let failures = 0;
let broken = 0;
console.log('\nprompt-lint self-test — mutation detection\n' + '─'.repeat(86));

{
  const dir = scratch();
  const { code, out } = runLint(dir);
  rmSync(dir, { recursive: true, force: true });
  if (code !== 0) {
    console.log('  ABORT BASELINE — the unmutated library does not pass the linter:');
    console.log(out.split('\n').filter((l) => l.includes('ERROR')).map((l) => '        ' + l.trim()).join('\n'));
    console.log('─'.repeat(86) + '\n');
    process.exit(1);
  }
  console.log('  ok      BASELINE — unmutated copy passes (exit 0)');
}

for (const m of MUTATIONS) {
  const dir = scratch();
  let applied = true;
  try { m.run(dir); } catch (e) { applied = false; broken++; console.log(`  BROKEN  ${m.id}\n          mutation could not be applied: ${e.message}`); }
  if (applied) {
    const { code, out } = runLint(dir);
    const detected = code !== 0 && out.includes(m.expect);
    if (detected) {
      console.log(`  ok      ${m.id}`);
    } else {
      failures++;
      console.log(`  MISSED  ${m.id}`);
      console.log(`          expected the linter to report: ${m.expect}`);
      console.log(`          exit code: ${code}`);
      const reported = out.split('\n').filter((l) => l.includes('ERROR')).slice(0, 4);
      console.log(reported.length
        ? '          it reported:\n' + reported.map((l) => '            ' + l.trim()).join('\n')
        : '          it reported nothing');
    }
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log('─'.repeat(86));
console.log(`  ${MUTATIONS.length} mutations · ${MUTATIONS.length - failures - broken} detected · ${failures} MISSED · ${broken} BROKEN\n`);
if (failures) console.log('  A MISSED mutation means that check in lint.mjs is vacuous — it cannot fail.\n');
if (broken) console.log('  A BROKEN mutation means its anchor drifted: fix the mutation, do not delete it.\n');
process.exit(failures || broken ? 1 : 0);
