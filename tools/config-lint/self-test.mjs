#!/usr/bin/env node
/**
 * config-lint self-test — proves every check can actually fire.
 *
 * A linter that has never failed proves nothing: it may be reading the wrong path, comparing the
 * wrong types, or short-circuiting before the assertion. So each mutation below introduces exactly
 * one defect into a throwaway copy of specs/config (or of the two authority documents) and asserts
 * that the expected check id appears in the output. The last three are negative controls: they
 * change something that *looks* like a defect but is sanctioned, and assert that the linter stays
 * silent — which is what stops the suite from passing by flagging everything.
 *
 * Mutations of docs/04 §18 and of schema.sql matter as much as mutations of the YAML. They are the
 * evidence that the tunable ranges, the seed defaults and the model-role enum are derived from the
 * documents rather than copied into this tool: change the document, and the linter's demands change.
 *
 * Usage: node tools/config-lint/self-test.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const CONFIG = join(root, 'specs', 'config');
const SCHEMA = join(root, 'specs', 'db', 'schema.sql');
const DOC04 = join(root, 'docs', '04-rag-pipeline.md');
const LINT = join(here, 'lint.mjs');

const FILES = {
  base: 'application.yaml',
  dev: 'application-dev.yaml',
  uat: 'application-uat.yaml',
  prod: 'application-prod.yaml',
};

const readDocs = () => {
  const out = {};
  for (const [k, f] of Object.entries(FILES)) out[k] = yaml.load(readFileSync(join(CONFIG, f), 'utf8'));
  return out;
};

function setPath(doc, path, value) {
  const parts = path.split('.');
  let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return doc;
}

function delPath(doc, path) {
  const parts = path.split('.');
  let cur = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur || typeof cur !== 'object') return doc;
    cur = cur[parts[i]];
  }
  if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
  return doc;
}

const models = (docs) => docs.base.albaraka.seed.models;
const model = (docs, code) => models(docs).find((m) => m.code === code);
const retrieval = (docs) => docs.base.albaraka.seed.retrieval;

/** Run the linter against a mutated copy. Returns { code, out }. */
function run(docs, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cfglint-'));
  try {
    for (const [k, f] of Object.entries(FILES)) {
      if (opts.raw && opts.raw[k] !== undefined) writeFileSync(join(dir, f), opts.raw[k]);
      else writeFileSync(join(dir, f), yaml.dump(docs[k], { lineWidth: 200, noRefs: true }));
    }
    const env = { ...process.env, CONFIG_DIR: dir };
    if (opts.schema) {
      const p = join(dir, 'schema.sql');
      writeFileSync(p, opts.schema(readFileSync(SCHEMA, 'utf8')));
      env.SCHEMA_FILE = p;
    }
    if (opts.doc04) {
      const p = join(dir, 'doc04.md');
      writeFileSync(p, opts.doc04(readFileSync(DOC04, 'utf8')));
      env.DOC04_FILE = p;
    }
    let out = ''; let code = 0;
    try {
      out = execFileSync(process.execPath, [LINT], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      out = `${e.stdout || ''}${e.stderr || ''}`;
      code = e.status === undefined ? 2 : e.status;
    }
    return { code, out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  Mutations. `expect` is a substring that must appear; `silent` marks a negative control.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const M = [];
const mut = (id, desc, apply, expect, extra = {}) => M.push({ id, desc, apply, expect, ...extra });

// ── S structure ─────────────────────────────────────────────────────────────────────────────────
mut('S01', 'prod YAML is syntactically broken', (d) => d, 'application-prod.yaml: YAML parse failure',
  { raw: { prod: 'spring:\n  datasource:\n   url: "unclosed\n' } });
mut('S02a', 'base loses the kill-switch section', (d) => delPath(d.base, 'albaraka.kill-switch'), 'S02');
mut('S02b', 'base loses the seed block', (d) => delPath(d.base, 'albaraka.seed.models'), 'S02');
mut('S02c', 'base loses the egress section', (d) => delPath(d.base, 'albaraka.egress'), 'S02');
mut('S03', 'prod invents a key the base never declared', (d) => setPath(d.prod, 'albaraka.nonsense.flag', true), 'S03');
mut('S04', 'prod claims to be the dev environment', (d) => setPath(d.prod, 'albaraka.env', 'dev'), 'S04');
mut('S05', 'dev forks the seeded model list', (d) => setPath(d.dev, 'albaraka.seed.models', [{ code: 'CHAT_PRIMARY' }]), 'S05');

// ── X secrets ───────────────────────────────────────────────────────────────────────────────────
mut('X01', 'base carries a literal database password', (d) => setPath(d.base, 'spring.datasource.password', 'S3cret!'), 'X01');
mut('X01b', 'prod carries a literal storage secret key', (d) => setPath(d.prod, 'albaraka.storage.secret-key', 'wJalrXUtnFEMI'), 'X01');
mut('X02', 'prod credentials fall back to a baked-in default', (d) => setPath(d.prod, 'spring.datasource.password', '${DATABASE_PASSWORD:changeme}'), 'X02');
mut('X03', 'a Groq-shaped key is committed in a comment-free field',
  (d) => setPath(d.base, 'albaraka.assistant.name', 'gsk_AbC1234567890AbCdEfG'), 'X03');

// ── P production hardening ──────────────────────────────────────────────────────────────────────
mut('P01', 'prod exposes /actuator/env', (d) => setPath(d.prod, 'management.endpoints.web.exposure.include', 'health,info,prometheus,env'), 'P01');
mut('P01b', 'uat exposes /actuator/loggers', (d) => setPath(d.uat, 'management.endpoints.web.exposure.include', ['health', 'loggers']), 'P01');
mut('P02', 'prod publishes health details to anyone', (d) => setPath(d.prod, 'management.endpoint.health.show-details', 'always'), 'P02');
mut('P03', 'prod logs question text in clear', (d) => setPath(d.prod, 'albaraka.observability.log.redact-question-text', false), 'P03');
mut('P03b', 'prod logs answer text in clear', (d) => setPath(d.prod, 'albaraka.observability.log.redact-answer-text', false), 'P03');
mut('P04', 'prod turns on DEBUG for the RAG package', (d) => setPath(d.prod, 'logging.level.tn.albaraka.ai.rag', 'DEBUG'), 'P04');
mut('P04b', 'prod sets the root logger to TRACE', (d) => setPath(d.prod, 'logging.level.root', 'TRACE'), 'P04');
mut('P05', 'prod enables the MOCK provider', (d) => setPath(d.prod, 'albaraka.providers.mock.enabled', true), 'P05');
mut('P05b', 'prod makes the MOCK provider an environment variable', (d) => setPath(d.prod, 'albaraka.providers.mock.enabled', '${MOCK:false}'), 'P05');
mut('P05c', 'uat enables the MOCK provider', (d) => setPath(d.uat, 'albaraka.providers.mock.enabled', true), 'P05');
mut('P06a', 'prod allows flyway clean', (d) => setPath(d.prod, 'spring.flyway.clean-disabled', false), 'P06');
mut('P06b', 'prod allows out-of-order migrations', (d) => setPath(d.prod, 'spring.flyway.out-of-order', true), 'P06');
mut('P06c', 'prod reads migrations from the filesystem', (d) => setPath(d.prod, 'spring.flyway.locations', 'classpath:db/migration,filesystem:/opt/migrations'), 'P06');
mut('P07a', 'prod switches the egress guard off', (d) => setPath(d.prod, 'albaraka.egress.enforce', false), 'P07');
mut('P07b', 'prod egress allows unknown hosts', (d) => setPath(d.prod, 'albaraka.egress.deny-by-default', false), 'P07');
mut('P07c', 'prod PII guard fails open', (d) => setPath(d.prod, 'albaraka.egress.pii.fail-closed', false), 'P07');
mut('P07d', 'prod lets the budget overrun', (d) => setPath(d.prod, 'albaraka.egress.budget.hard-stop', false), 'P07');
mut('P08a', 'prod waives the kill-switch second approver', (d) => setPath(d.prod, 'albaraka.kill-switch.requires-second-approver', false), 'P08');
mut('P08b', 'prod stops auditing kill-switch use', (d) => setPath(d.prod, 'albaraka.kill-switch.audit', 'BEST_EFFORT'), 'P08');
mut('P08c', 'prod allows an hour to propagate the kill switch', (d) => setPath(d.prod, 'albaraka.kill-switch.max-propagation-seconds', 3600), 'P08');
mut('P09a', 'prod disables the Sharia judge', (d) => setPath(d.prod, 'albaraka.guardrails.output.sharia-judge.enabled', false), 'P09');
mut('P09b', 'prod passes answers through when the judge is down', (d) => setPath(d.prod, 'albaraka.guardrails.output.sharia-judge.on-unavailable', 'PASS'), 'P09');
mut('P10a', 'prod drops versioning on the originals bucket', (d) => setPath(d.prod, 'albaraka.storage.versioning-required', false), 'P10');
mut('P10b', 'prod disables object lock', (d) => setPath(d.prod, 'albaraka.storage.object-lock.enabled', false), 'P10');
mut('P10c', 'prod downgrades object lock to GOVERNANCE', (d) => setPath(d.prod, 'albaraka.storage.object-lock.mode', 'GOVERNANCE'), 'P10');
mut('P11', 'prod enables the Tomcat access log', (d) => setPath(d.prod, 'server.tomcat.accesslog.enabled', true), 'P11');
mut('P12a', 'prod raises the offshore ceiling to CONFIDENTIAL', (d) => setPath(d.prod, 'albaraka.egress.classification-ceiling', 'CONFIDENTIAL'), 'P12');
mut('P12b', 'prod sends RESTRICTED content offshore', (d) => setPath(d.prod, 'albaraka.egress.max-classification-offshore', 'RESTRICTED'), 'P12');
mut('P12c', 'prod invents a classification value', (d) => setPath(d.prod, 'albaraka.egress.classification-ceiling', 'SECRET'), 'P12');
mut('P13', 'prod hard-codes a localhost datasource', (d) => setPath(d.prod, 'spring.datasource.url', 'jdbc:postgresql://localhost:5432/albaraka_ai'), 'P13');

// ── D dev-only leakage ──────────────────────────────────────────────────────────────────────────
mut('D01', 'uat waives the kill-switch second approver', (d) => setPath(d.uat, 'albaraka.kill-switch.requires-second-approver', false), 'D01');
mut('D02', 'uat stops redacting question text', (d) => setPath(d.uat, 'albaraka.observability.log.redact-question-text', false), 'D02');
mut('D02b', 'prod switches to unstructured logs', (d) => setPath(d.prod, 'albaraka.observability.log.structured', false), 'D02');
mut('D03', 'prod makes the Sharia judge autonomous at launch', (d) => setPath(d.prod, 'albaraka.guardrails.output.sharia-judge.autonomy', true), 'D03');
mut('D04', 'prod adopts dev-scale anonymous rate limits', (d) => setPath(d.prod, 'albaraka.ratelimit.anonymous.per-day', 5000), 'D04');
mut('D06', 'prod disables object lock (dev posture)', (d) => setPath(d.prod, 'albaraka.storage.object-lock.enabled', false), 'D06');

// ── T tunables ──────────────────────────────────────────────────────────────────────────────────
mut('T01', 'a documented tunable is not seeded', (d) => delPath(d.base, 'albaraka.seed.retrieval.top-k-dense'), 'T01');
mut('T01b', 'answer_word_limit is not seeded', (d) => delPath(d.base, 'albaraka.seed.generation.answer-word-limit'), 'T01');
mut('T02a', 'top_k_dense is seeded tenfold out of range', (d) => setPath(d.base, 'albaraka.seed.retrieval.top-k-dense', 500), 'T02');
mut('T02b', 'temperature is seeded above the documented maximum', (d) => setPath(d.base, 'albaraka.seed.generation.temperature', 0.9), 'T02');
mut('T02c', 'semantic cache similarity is seeded below the floor', (d) => setPath(d.base, 'albaraka.seed.generation.semantic-cache-similarity', 0.8), 'T02');
mut('T02d', 'mmr_lambda is seeded as a non-numeric string', (d) => setPath(d.base, 'albaraka.seed.retrieval.mmr-lambda', 'high'), 'T02');
mut('T02-doc', 'docs/04 tightens the rrf_k range so the shipped seed falls outside it',
  (d) => d, 'T02', { doc04: (t) => t.replace('| `rrf_k` | 60 | 10–100 |', '| `rrf_k` | 60 | 70–100 |') });
mut('T03', 'schema.sql changes the rrf_k DEFAULT away from the seed',
  (d) => d, 'T03', { schema: (t) => t.replace('rrf_k                          integer     NOT NULL DEFAULT 60,', 'rrf_k                          integer     NOT NULL DEFAULT 30,') });
mut('T03b', 'schema.sql changes the embedding_variant DEFAULT',
  (d) => d, 'T03', { schema: (t) => t.replace("embedding_variant              text        NOT NULL DEFAULT 'gemini-embedding-001@1536'", "embedding_variant              text        NOT NULL DEFAULT 'gemini-embedding-001@3072'") });
mut('T03c', 'schema.sql changes the min_score_fts DEFAULT, a value docs/04 never lists',
  (d) => d, 'T03', { schema: (t) => t.replace('min_score_fts                  numeric(4,3) NOT NULL DEFAULT 0.050,', 'min_score_fts                  numeric(4,3) NOT NULL DEFAULT 0.500,') });
mut('T07', 'the seed names a retrieval column that does not exist', (d) => setPath(d.base, 'albaraka.seed.retrieval.top-k-sparse', 5), 'T07');
mut('T05', 'the seeded embedding variant disagrees with the seeded model', (d) => setPath(d.base, 'albaraka.seed.retrieval.embedding-variant', 'gemini-embedding-001@3072'), 'T05');
mut('T06', 'the seed targets a channel that does not exist', (d) => setPath(d.base, 'albaraka.seed.retrieval.channel', 'TELEGRAM'), 'T06');

// ── M models ────────────────────────────────────────────────────────────────────────────────────
mut('M01a', 'a model role is seeded that the enum does not define', (d) => { models(d).push({ code: 'CHAT_TURBO', provider: 'GROQ', 'model-id': 'x', temperature: 0, 'timeout-ms': 1000, retries: 1, 'rate-limit-per-min': 10, 'daily-budget-usd': 1 }); return d; }, 'M01');
mut('M01b', 'a model_role value is left unrouted', (d) => { const i = models(d).findIndex((m) => m.code === 'GUARD_SAFETY'); models(d).splice(i, 1); return d; }, 'M01');
mut('M01c', 'a model role is seeded twice', (d) => { models(d).push({ ...model(d, 'RERANKER') }); return d; }, 'M01');
mut('M02', 'a role is routed to a provider outside the enum', (d) => { model(d, 'CHAT_PRIMARY').provider = 'OPENAI'; return d; }, 'M02');
mut('M03', 'the EMBEDDING role declares no dimension', (d) => { delete model(d, 'EMBEDDING')['embedding-dim']; return d; }, 'M03');
mut('M03b', 'the EMBEDDING role declares no task type', (d) => { delete model(d, 'EMBEDDING')['task-type']; return d; }, 'M03');
mut('M04', 'embeddings are routed to Groq', (d) => { model(d, 'EMBEDDING').provider = 'GROQ'; return d; }, 'M04');
mut('M05', 'CHAT_PRIMARY declares no timeout', (d) => { delete model(d, 'CHAT_PRIMARY')['timeout-ms']; return d; }, 'M05');
mut('M05b', 'a role declares no rate limit', (d) => { delete model(d, 'CHAT_FAST')['rate-limit-per-min']; return d; }, 'M05');
mut('M05c', 'a role declares no daily budget', (d) => { delete model(d, 'RERANKER')['daily-budget-usd']; return d; }, 'M05');
mut('M06a', 'CHAT_PRIMARY falls back to itself', (d) => { model(d, 'CHAT_PRIMARY').fallback = 'CHAT_PRIMARY'; return d; }, 'M06');
mut('M06b', 'CHAT_PRIMARY falls back to a role that is not seeded', (d) => { model(d, 'CHAT_PRIMARY').fallback = 'CHAT_TURBO'; return d; }, 'M06');
mut('M07', 'the reranker samples instead of deciding', (d) => { model(d, 'RERANKER').temperature = 0.7; return d; }, 'M07');
mut('M07b', 'the injection guard loses its pinned temperature', (d) => { delete model(d, 'GUARD_INJECTION').temperature; return d; }, 'M07');
mut('M08', 'one role out-budgets the whole platform', (d) => { model(d, 'CHAT_PRIMARY')['daily-budget-usd'] = 500; return d; }, 'M08');
mut('M09', 'the safety guard is given an eight-second timeout', (d) => { model(d, 'GUARD_SAFETY')['timeout-ms'] = 8000; return d; }, 'M09');
mut('M10', 'CHAT_PRIMARY has no fallback at all', (d) => { delete model(d, 'CHAT_PRIMARY').fallback; return d; }, 'M10');
mut('M01-enum', 'schema.sql adds a model role the seed does not route',
  (d) => d, 'M01', { schema: (t) => t.replace("'GUARD_INJECTION','EMBEDDING'", "'GUARD_INJECTION','GUARD_PII','EMBEDDING'") });

// ── C consistency ───────────────────────────────────────────────────────────────────────────────
mut('C01', 'prod narrows the kill-switch ladder', (d) => setPath(d.prod, 'albaraka.kill-switch.modes', ['FULL', 'OFF']), 'C01');
mut('C02', 'prod quotes the dinar to two decimals', (d) => setPath(d.prod, 'albaraka.i18n.currency.decimals', 2), 'C02');
mut('C02b', 'uat changes the currency', (d) => setPath(d.uat, 'albaraka.i18n.currency.code', 'EUR'), 'C02');
mut('C03', 'prod drops Arabic from the supported locales', (d) => setPath(d.prod, 'albaraka.assistant.supported-locales', ['fr-FR', 'en-GB']), 'C03');
mut('C03b', 'the base is no longer trilingual', (d) => setPath(d.base, 'albaraka.assistant.supported-locales', ['fr-FR', 'ar-TN']), 'C03');
mut('C04', 'prod stops streaming', (d) => setPath(d.prod, 'albaraka.pipeline.streaming', false), 'C04');
mut('C04b', 'prod lets prose arrive before its sources', (d) => setPath(d.prod, 'albaraka.pipeline.sources-before-first-token', false), 'C04');
mut('C05', 'prod moves feature flags into YAML', (d) => setPath(d.prod, 'albaraka.feature-flags.source', 'yaml'), 'C05');
mut('C05b', 'an unknown flag defaults to ON', (d) => setPath(d.prod, 'albaraka.feature-flags.unknown-flag-default', true), 'C05');
mut('C06', 'prod shortens conversation retention to 12 months', (d) => setPath(d.prod, 'albaraka.retention.conversation-anonymise-after-months', 12), 'C06');
mut('C06b', 'prod shortens the audit trail to 5 years', (d) => setPath(d.prod, 'albaraka.retention.audit-event-retain-years', 5), 'C06');
mut('C07', 'prod redacts PII instead of tokenising it', (d) => setPath(d.prod, 'albaraka.egress.pii.mode', 'REDACT'), 'C07');
mut('C08', 'prod caches answers without the knowledge epoch', (d) => setPath(d.prod, 'albaraka.pipeline.semantic-cache.key-includes-kb-epoch', false), 'C08');
mut('C09', 'prod lets the model write its own disclaimer', (d) => setPath(d.prod, 'albaraka.guardrails.disclaimers.appended-by', 'MODEL'), 'C09');
mut('C10', 'the RAG provider-mode declaration disappears (ADR-009)', (d) => setPath(d.base, 'albaraka.rag.provider-mode', undefined), 'C10');
mut('C11', 'the default locale becomes English', (d) => setPath(d.base, 'albaraka.assistant.default-locale', 'en-GB'), 'C11');
mut('C12a', 'the egress allowlist omits the Groq host a role needs', (d) => { d.base.albaraka.egress.allowlist = ['generativelanguage.googleapis.com']; return d; }, 'C12');
mut('C12b', 'prod allows egress to localhost', (d) => setPath(d.prod, 'albaraka.egress.allowlist', ['api.groq.com', 'localhost:11434']), 'C12');
mut('C13', 'prod traces more heavily than uat', (d) => { setPath(d.uat, 'management.otlp.tracing.sampling.probability', 0.5); setPath(d.prod, 'management.otlp.tracing.sampling.probability', 1.0); return d; }, 'C13');

// ── negative controls: sanctioned differences the linter must NOT flag ──────────────────────────
mut('N1', 'no mutation at all', (d) => d, null, { silent: true });
mut('N2', 'dev keeps its sanctioned relaxations (redaction off, judge autonomous, single approver)',
  (d) => {
    setPath(d.dev, 'albaraka.observability.log.redact-question-text', false);
    setPath(d.dev, 'albaraka.guardrails.output.sharia-judge.autonomy', true);
    setPath(d.dev, 'albaraka.kill-switch.requires-second-approver', false);
    return d;
  }, null, { silent: true });
mut('N3', 'prod tightens logging below the base level', (d) => setPath(d.prod, 'logging.level.tn.albaraka.ai.rag', 'WARN'), null, { silent: true });
mut('N4', 'uat runs the judge with autonomy off and prod leaves it env-gated',
  (d) => { setPath(d.uat, 'albaraka.guardrails.output.sharia-judge.autonomy', false); return d; }, null, { silent: true });
mut('N5', 'prod raises a rate limit within the documented ceiling', (d) => setPath(d.prod, 'albaraka.ratelimit.anonymous.per-day', 60), null, { silent: true });
mut('N6', 'the EMBEDDING role carries no temperature, as it must not', (d) => { delete model(d, 'EMBEDDING').temperature; return d; }, null, { silent: true });

// ─────────────────────────────────────────────────────────────────────────────────────────────────

console.log('\nconfig-lint self-test\n' + '─'.repeat(88));
let pass = 0; const fail = [];
for (const m of M) {
  const docs = readDocs();
  // Mutations edit `docs` in place. The return value is deliberately ignored: some helpers return
  // the sub-document they touched, and honouring that here would dump the wrong object.
  try { m.apply(docs); } catch (e) { fail.push([m.id, `mutation threw: ${e.message}`]); continue; }
  const { code, out } = run(docs, m);
  if (m.silent) {
    if (code === 0) { pass++; console.log(`  ok    ${m.id.padEnd(9)} silent — ${m.desc}`); }
    else {
      const errs = out.split('\n').filter((l) => l.includes('ERROR')).slice(0, 3).map((l) => l.trim());
      fail.push([m.id, `expected silence, got ${errs.join(' | ') || `exit ${code}`}`]);
    }
    continue;
  }
  if (out.includes(m.expect) && code !== 0) { pass++; console.log(`  ok    ${m.id.padEnd(9)} fires ${m.expect} — ${m.desc}`); }
  else fail.push([m.id, `"${m.expect}" ${out.includes(m.expect) ? 'present but exit 0' : 'absent'} — ${m.desc}`]);
}
console.log('─'.repeat(88));
for (const [id, why] of fail) console.log(`  FAIL  ${id.padEnd(9)} ${why}`);
console.log(`  ${pass}/${M.length} mutations behaved as expected · ${fail.length} failure(s)\n`);
process.exit(fail.length ? 1 : 0);
