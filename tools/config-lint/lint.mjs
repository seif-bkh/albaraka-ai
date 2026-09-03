#!/usr/bin/env node
/**
 * config-lint — executable checks over specs/config/
 *
 * Configuration is the one artefact in this repository where a plausible-looking mistake is
 * invisible in review and catastrophic in production: a debug actuator endpoint, a fail-open
 * guardrail, a redaction flag left false, a seeded retrieval parameter quietly outside the range
 * the architecture document promises. None of those read as wrong in a diff.
 *
 * So the rules here are derived, not copied. The tunable ranges come from docs/04 §18, the seed
 * defaults from the column DEFAULTs in specs/db/schema.sql, the model roles and providers from the
 * database enums. If a document changes, this linter's expectations change with it.
 *
 * Files checked
 *   specs/config/application.yaml          shared base: wiring + first-boot seeds
 *   specs/config/application-dev.yaml      local / shared development
 *   specs/config/application-uat.yaml      pre-production, prod-shaped
 *   specs/config/application-prod.yaml     production
 *
 * Check groups
 *   S  Structure: files parse, required sections present, profiles override only keys the base
 *      declares (an unknown key in a profile is a typo that silently does nothing), env matches file
 *   X  Secrets: no literal credential, no default value for a credential outside dev, no key-shaped
 *      string anywhere
 *   P  Production hardening: actuator surface, health detail, log redaction, log levels, mock
 *      provider, Flyway safety, egress enforcement, kill-switch discipline, Sharia gate fail-closed,
 *      object lock, access logs, classification ceiling, datasource wiring
 *   D  Dev-only leakage: every relaxation permitted in dev is asserted absent from uat and prod
 *   T  Tunables: every documented parameter is seeded, inside its documented range, and equal to the
 *      schema DEFAULT; embedding variant agrees with the seeded EMBEDDING model
 *   M  Models: seeded roles are exactly the model_role enum, providers valid, embeddings never on
 *      Groq, deterministic roles at temperature 0, fallbacks resolve, budgets and guard timeouts sane
 *   C  Consistency: values declared in more than one file agree, and the invariants that must hold
 *      everywhere (streaming, cache epoching, TND 3 decimals, locales, disclaimers server-side) do
 *
 * Exit 0 = pass, 1 = at least one ERROR. WARN never fails the build.
 *
 * Usage: node tools/config-lint/lint.mjs
 *          [CONFIG_DIR=/path/to/specs/config] [SCHEMA_FILE=…] [DOC04_FILE=…]
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const CONFIG = process.env.CONFIG_DIR ? process.env.CONFIG_DIR : join(root, 'specs', 'config');
// The two authorities are overridable so the self-test can prove the expectations are derived from
// them: mutating a copy of docs/04 or of schema.sql must change what this linter demands.
const SCHEMA = process.env.SCHEMA_FILE ? process.env.SCHEMA_FILE : join(root, 'specs', 'db', 'schema.sql');
const DOC04 = process.env.DOC04_FILE ? process.env.DOC04_FILE : join(root, 'docs', '04-rag-pipeline.md');

const errors = [];
const warns = [];
const ok = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const PROFILES = ['dev', 'uat', 'prod'];

// A seed value that intentionally differs from the schema DEFAULT, with the reason. Empty: nothing
// in specs/config currently deviates, and adding an entry here is a reviewed act, not a silent one.
const JUSTIFIED_SEED_OVERRIDES = new Map();

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  Loading and flattening
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function loadYaml(path, label) {
  if (!existsSync(path)) { err(`${label}: file not found at ${path}`); return null; }
  try {
    const doc = yaml.load(readFileSync(path, 'utf8'));
    if (!doc || typeof doc !== 'object') { err(`${label}: parsed to a non-object (${typeof doc})`); return null; }
    return doc;
  } catch (e) {
    err(`${label}: YAML parse failure — ${e.reason || e.message}${e.mark ? ` at line ${e.mark.line + 1}` : ''}`);
    return null;
  }
}

/** Flatten to dotted paths. Arrays expand to `path[i]` so profile/base key sets are comparable. */
function flatten(obj, prefix = '', out = new Map()) {
  if (obj === null || obj === undefined) { out.set(prefix, obj); return out; }
  if (Array.isArray(obj)) {
    out.set(prefix, obj);
    obj.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  out.set(prefix, obj);
  return out;
}

function deepMerge(base, over) {
  if (over === null || over === undefined) return base;
  if (Array.isArray(over)) return over.slice();
  if (typeof over !== 'object') return over;
  const out = Array.isArray(base) ? {} : { ...(base && typeof base === 'object' ? base : {}) };
  for (const [k, v] of Object.entries(over)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out;
}

const get = (obj, path) => {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
};

const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim()) ? Number(v.trim()) : NaN);
const near = (a, b) => Math.abs(num(a) - num(b)) < 1e-9;

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  Authority: docs/04 §18 parameter sheet
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const cleanSpaces = (s) => s.replace(/[\u00A0\u2007\u202F\u2009]/g, ' ').replace(/\s+/g, ' ').trim();

function parseParamSheet(text) {
  const sheet = new Map();
  let inSection = false;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (/^##\s+\d+\.\s+Default parameter sheet/.test(line)) { inSection = true; continue; }
    if (inSection && /^##\s/.test(line)) break;
    if (!inSection || !line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => cleanSpaces(c));
    if (cells.length < 3) continue;
    const nameCell = cells[0].replace(/`/g, '').replace(/\([^)]*\)/g, '').trim();
    if (!nameCell || /^parameter$/i.test(nameCell) || /^[-:\s]+$/.test(nameCell)) continue;
    const names = nameCell.split('/').map((s) => s.trim()).filter(Boolean);
    const defaults = cells[1].replace(/`/g, '').split('/').map((s) => cleanSpaces(s));
    const rangeCell = cells[2].replace(/`/g, '').trim();
    let min = null; let max = null;
    const m = rangeCell.replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, '').match(/^(-?[\d.]+)-(-?[\d.]+)$/);
    if (m) { min = Number(m[1]); max = Number(m[2]); }
    names.forEach((n, i) => {
      if (!n) return;
      const dv = defaults.length === names.length ? defaults[i] : defaults.length === 1 ? defaults[0] : null;
      sheet.set(n, { default: dv === null ? null : dv.replace(/\s+/g, ''), min, max, row: cells[0] });
    });
  }
  return sheet;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  Authority: specs/db/schema.sql
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function parseEnum(sql, typeName) {
  const re = new RegExp(`CREATE TYPE\\s+${typeName}\\s+AS\\s+ENUM\\s*\\(([\\s\\S]*?)\\);`);
  const m = sql.match(re);
  if (!m) { err(`schema.sql: could not find enum ${typeName}`); return []; }
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function parseTableDefaults(sql, tableName) {
  const start = sql.indexOf(`CREATE TABLE ${tableName} (`);
  if (start < 0) { err(`schema.sql: could not find CREATE TABLE ${tableName}`); return new Map(); }
  const body = sql.slice(start, sql.indexOf('\n);', start));
  const out = new Map();
  for (const line of body.split('\n')) {
    const m = line.match(/^\s{2}([a-z_]+)\s+\S+.*?DEFAULT\s+('[^']*'|[\w.-]+)/);
    if (m) out.set(m[1], m[2].replace(/^'|'$/g, ''));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  Load everything
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const docs = { base: loadYaml(join(CONFIG, 'application.yaml'), 'application.yaml') };
for (const p of PROFILES) docs[p] = loadYaml(join(CONFIG, `application-${p}.yaml`), `application-${p}.yaml`);

const schema = existsSync(SCHEMA) ? readFileSync(SCHEMA, 'utf8') : (err(`schema.sql not found at ${SCHEMA}`), '');
const doc04 = existsSync(DOC04) ? readFileSync(DOC04, 'utf8') : (err(`docs/04 not found at ${DOC04}`), '');

const MODEL_ROLE = parseEnum(schema, 'model_role');
const PROVIDER = parseEnum(schema, 'provider_code');
const CHANNEL = parseEnum(schema, 'channel');
const CLASSIFICATION = parseEnum(schema, 'classification');
const RETRIEVAL_DEFAULTS = parseTableDefaults(schema, 'retrieval_config');
const SHEET = parseParamSheet(doc04);

const flat = {};
for (const k of ['base', ...PROFILES]) flat[k] = docs[k] ? flatten(docs[k]) : new Map();
const merged = {};
for (const p of PROFILES) merged[p] = docs.base && docs[p] ? deepMerge(docs.base, docs[p]) : (docs[p] || docs.base || {});
const mergedFlat = {};
for (const p of PROFILES) mergedFlat[p] = flatten(merged[p]);

const seed = get(docs.base || {}, 'albaraka.seed') || {};
const seedModels = Array.isArray(seed.models) ? seed.models : [];
const seedRetrieval = seed.retrieval || {};
const seedGeneration = seed.generation || {};

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  S — structure
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function checkStructure() {
  // Paths, not top-level keys: the seed block is nested under `albaraka`, and a check written
  // against top-level names would not see it.
  const required = ['spring.datasource', 'spring.flyway', 'spring.ai.openai', 'server.port',
    'management.endpoints', 'albaraka.env', 'albaraka.egress', 'albaraka.pipeline',
    'albaraka.guardrails', 'albaraka.kill-switch', 'albaraka.feature-flags',
    'albaraka.seed.mode', 'albaraka.seed.models', 'albaraka.seed.retrieval'];
  const missing = required.filter((k) => get(docs.base || {}, k) === undefined);
  if (missing.length) err(`S02 application.yaml: missing required section(s) ${missing.join(', ')}`);
  else ok.push(`S02 structure: base declares all ${required.length} required sections`);

  // S03 — a profile may only override what the base declares.
  const baseKeys = new Set([...flat.base.keys()].map((k) => k.replace(/\[\d+\]/g, '[]')));
  let unknown = 0;
  for (const p of PROFILES) {
    if (!docs[p]) continue;
    for (const k of flat[p].keys()) {
      const norm = k.replace(/\[\d+\]/g, '[]');
      if (baseKeys.has(norm)) continue;
      // a prefix of a known key is fine (intermediate nodes appear when a whole subtree is overridden)
      if ([...baseKeys].some((b) => b.startsWith(`${norm}.`) || b.startsWith(`${norm}[`))) continue;
      err(`S03 application-${p}.yaml: overrides \`${k}\`, which application.yaml does not declare — a new key in a profile is either a typo or an undeclared control`);
      unknown++;
    }
  }
  if (!unknown) ok.push(`S03 structure: all three profiles override only keys the base declares`);

  // S04 — albaraka.env must match the file it lives in.
  for (const p of PROFILES) {
    const v = get(docs[p] || {}, 'albaraka.env');
    if (v === undefined) continue;
    if (v !== p) err(`S04 application-${p}.yaml: albaraka.env = "${v}" but the profile is "${p}" — metrics and audit rows would carry the wrong environment`);
  }
  const baseEnv = get(docs.base || {}, 'albaraka.env');
  if (typeof baseEnv === 'string' && !baseEnv.startsWith('${')) warn(`S04 application.yaml: albaraka.env is a literal "${baseEnv}"; it should stay env-driven`);
  ok.push('S04 structure: albaraka.env agrees with its profile in every file');

  // S05 — profiles must be additive on the same shape: no profile may redefine the seed models list.
  for (const p of PROFILES) {
    if (get(docs[p] || {}, 'albaraka.seed.models') !== undefined) {
      err(`S05 application-${p}.yaml: redefines albaraka.seed.models — model routing is one list, seeded once; per-environment routing is a model_config activation, not a YAML fork`);
    }
  }
  ok.push('S05 structure: the seed block is declared once, in the base');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  X — secrets
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const CREDENTIAL_KEY = /(password|api-key|apikey|secret-key|secret|access-key|client-secret|private-key|token)$/i;
const KEY_SHAPED = /\b(?:gsk_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/;

function checkSecrets() {
  let literals = 0;
  for (const label of ['base', ...PROFILES]) {
    if (!docs[label]) continue;
    const file = label === 'base' ? 'application.yaml' : `application-${label}.yaml`;
    for (const [path, value] of flat[label]) {
      const leaf = path.split('.').pop().replace(/\[\d+\]$/, '');
      if (typeof value !== 'string') continue;
      if (KEY_SHAPED.test(value)) { err(`X03 ${file}: \`${path}\` contains a key-shaped literal — rotate it and remove it from version control`); literals++; continue; }
      if (!CREDENTIAL_KEY.test(leaf)) continue;
      if (value === '' || value.startsWith('${')) continue;
      err(`X01 ${file}: \`${path}\` holds a literal credential; it must be \${ENV_VAR} resolved from Vault`);
      literals++;
    }
  }
  if (!literals) ok.push('X01/X03 secrets: no literal credential and no key-shaped string in any config file');

  // X02 — a credential with a baked-in default is a credential in git, with extra steps.
  let defaults = 0;
  for (const p of ['uat', 'prod']) {
    if (!docs[p]) continue;
    for (const [path, value] of flat[p]) {
      const leaf = path.split('.').pop().replace(/\[\d+\]$/, '');
      if (typeof value !== 'string' || !CREDENTIAL_KEY.test(leaf)) continue;
      const m = value.match(/^\$\{[A-Za-z_][A-Za-z0-9_]*:([^}]*)\}$/);
      if (m && m[1].trim() !== '') { err(`X02 application-${p}.yaml: \`${path}\` defaults to "${m[1]}" — production must fail to start without the real secret`); defaults++; }
    }
  }
  if (!defaults) ok.push('X02 secrets: no credential carries a fallback default in uat or prod');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  P — production hardening
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_ACTUATORS = ['env', 'loggers', 'flyway', 'heapdump', 'threaddump', 'beans', 'configprops', 'shutdown', 'mappings', 'jolokia', 'httpexchanges'];
const CLASS_ORDER = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];

function checkProdHardening() {
  for (const p of ['uat', 'prod']) {
    const cfg = mergedFlat[p];
    const f = `application-${p}.yaml`;
    const at = (path) => cfg.get(path);

    // P01 actuator surface
    const exposed = at('management.endpoints.web.exposure.include');
    const list = Array.isArray(exposed) ? exposed : typeof exposed === 'string' ? exposed.split(',') : [];
    const bad = list.map((s) => String(s).trim()).filter((s) => FORBIDDEN_ACTUATORS.includes(s));
    if (bad.length) err(`P01 ${f}: exposes actuator endpoint(s) ${bad.join(', ')} — /actuator/env leaks every secret reference and /actuator/loggers is a runtime debug switch`);

    // P02 health detail
    if (String(at('management.endpoint.health.show-details')) === 'always') err(`P02 ${f}: health show-details=always publishes datasource and Redis topology to any caller`);

    // P03 log redaction
    for (const k of ['redact-question-text', 'redact-answer-text']) {
      if (at(`albaraka.observability.log.${k}`) !== true) err(`P03 ${f}: albaraka.observability.log.${k} must be true — application logs carry ids and metrics, never customer text`);
    }

    // P04 log levels
    for (const [k, v] of cfg) {
      if (!k.startsWith('logging.level.')) continue;
      if (['DEBUG', 'TRACE'].includes(String(v).toUpperCase())) err(`P04 ${f}: ${k} = ${v} in ${p} — debug output includes prompt and retrieval payloads`);
    }

    // P06 Flyway
    if (at('spring.flyway.clean-disabled') !== true) err(`P06 ${f}: spring.flyway.clean-disabled must be true`);
    if (at('spring.flyway.out-of-order') !== false) err(`P06 ${f}: spring.flyway.out-of-order must be false — governance migrations must never be reordered`);
    const loc = String(at('spring.flyway.locations') || '');
    if (loc.includes('filesystem:')) err(`P06 ${f}: flyway locations read from the filesystem (${loc}); the release bundle must carry migrations on the classpath so the checksum set is immutable`);

    // P07 egress
    if (at('albaraka.egress.enforce') !== true) err(`P07 ${f}: albaraka.egress.enforce must be true`);
    if (at('albaraka.egress.deny-by-default') !== true) err(`P07 ${f}: albaraka.egress.deny-by-default must be true`);
    if (at('albaraka.egress.pii.fail-closed') !== true) err(`P07 ${f}: albaraka.egress.pii.fail-closed must be true — a PII detection error blocks the call, it never lets it through`);
    if (at('albaraka.egress.budget.hard-stop') !== true) err(`P07 ${f}: albaraka.egress.budget.hard-stop must be true`);

    // P08 kill switch
    if (at('albaraka.kill-switch.requires-second-approver') !== true) err(`P08 ${f}: kill-switch.requires-second-approver must be true (docs/05 §7)`);
    if (at('albaraka.kill-switch.audit') !== 'ALWAYS') err(`P08 ${f}: kill-switch.audit must be ALWAYS`);
    const prop = num(at('albaraka.kill-switch.max-propagation-seconds'));
    if (!(prop <= 900)) err(`P08 ${f}: kill-switch.max-propagation-seconds = ${prop}; the mandate is ≤ 900 s end to end`);

    // P09 Sharia gate fail-closed
    if (at('albaraka.guardrails.output.sharia-judge.enabled') !== true) err(`P09 ${f}: the Sharia judge must be enabled`);
    if (String(at('albaraka.guardrails.output.sharia-judge.on-unavailable')).toUpperCase() !== 'REFUSE') err(`P09 ${f}: sharia-judge.on-unavailable must be REFUSE — an unverified answer is never delivered`);

    // P10 immutability of originals
    if (at('albaraka.storage.versioning-required') !== true) err(`P10 ${f}: storage.versioning-required must be true`);
    if (at('albaraka.storage.object-lock.enabled') !== true) err(`P10 ${f}: storage.object-lock.enabled must be true — originals are the Sharia evidence base`);
    if (String(at('albaraka.storage.object-lock.mode')) !== 'COMPLIANCE') err(`P10 ${f}: object-lock.mode must be COMPLIANCE, not GOVERNANCE (GOVERNANCE can be lifted by a privileged user)`);

    // P11 access logs
    if (at('server.tomcat.accesslog.enabled') !== false) err(`P11 ${f}: tomcat accesslog must be disabled — request logging would capture question text`);

    // P12 classification ceiling
    const ceiling = String(at('albaraka.egress.classification-ceiling') || '');
    if (!CLASS_ORDER.includes(ceiling)) err(`P12 ${f}: egress.classification-ceiling "${ceiling}" is not a classification enum value`);
    else if (CLASS_ORDER.indexOf(ceiling) > CLASS_ORDER.indexOf('INTERNAL')) err(`P12 ${f}: egress.classification-ceiling = ${ceiling} exceeds INTERNAL; v1 sends nothing above INTERNAL offshore (docs/07 §5)`);
    const offshore = String(at('albaraka.egress.max-classification-offshore') || '');
    if (offshore && CLASS_ORDER.indexOf(offshore) > CLASS_ORDER.indexOf('INTERNAL')) err(`P12 ${f}: max-classification-offshore = ${offshore} exceeds INTERNAL`);

    // P13 datasource
    const url = String(at('spring.datasource.url') || '');
    if (!url.startsWith('${DATABASE_URL}')) err(`P13 ${f}: spring.datasource.url must be \${DATABASE_URL} with no baked-in default, got "${url}"`);
  }

  // P05 — mock provider must be a literal false in prod, not an env-driven value.
  const mockProd = get(merged.prod, 'albaraka.providers.mock.enabled');
  if (mockProd !== false) err(`P05 application-prod.yaml: albaraka.providers.mock.enabled must be the literal false (got ${JSON.stringify(mockProd)}) — an environment variable here is an environment variable that can be set`);
  const mockUat = get(merged.uat, 'albaraka.providers.mock.enabled');
  if (mockUat !== false) err(`P05 application-uat.yaml: albaraka.providers.mock.enabled must be false in UAT (got ${JSON.stringify(mockUat)}) — the release gate must run against real providers`);

  ok.push('P01–P13 hardening: actuator surface, redaction, Flyway, egress, kill switch, Sharia gate, object lock and datasource wiring verified for uat and prod');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  D — dev-only leakage (each relaxation must stay in dev)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function checkDevOnly() {
  const devCfg = mergedFlat.dev;
  // The relaxation must actually exist in dev, otherwise this group is vacuous.
  if (devCfg.get('albaraka.kill-switch.requires-second-approver') !== false) warn('D01 dev does not relax kill-switch.requires-second-approver; the leakage assertion below is untested');
  if (devCfg.get('albaraka.observability.log.redact-question-text') !== false) warn('D02 dev does not relax log redaction; the leakage assertion below is untested');

  const forbidden = [
    ['D01', 'albaraka.kill-switch.requires-second-approver', (v) => v === false, 'kill-switch second approver waived'],
    ['D02', 'albaraka.observability.log.redact-question-text', (v) => v === false, 'question text logged in clear'],
    ['D02', 'albaraka.observability.log.redact-answer-text', (v) => v === false, 'answer text logged in clear'],
    ['D02', 'albaraka.observability.log.structured', (v) => v === false, 'unstructured logs (no redaction pipeline)'],
    ['D03', 'albaraka.guardrails.output.sharia-judge.autonomy', (v) => v === true, 'Sharia judge autonomous'],
    ['D05', 'management.endpoint.health.show-details', (v) => String(v) === 'always', 'health details public'],
    ['D06', 'albaraka.storage.object-lock.enabled', (v) => v === false, 'object lock disabled'],
  ];
  let leaked = 0;
  for (const p of ['uat', 'prod']) {
    for (const [id, path, bad, desc] of forbidden) {
      if (bad(mergedFlat[p].get(path))) { err(`${id} application-${p}.yaml: ${desc} (\`${path}\`) — this relaxation is dev-only`); leaked++; }
    }
    // D04 rate limits must not exceed dev-style generosity
    const anonDay = num(mergedFlat[p].get('albaraka.ratelimit.anonymous.per-day'));
    const prodRef = num(flat.base.get('albaraka.ratelimit.anonymous.per-day'));
    if (anonDay > 500) { err(`D04 application-${p}.yaml: anonymous per-day = ${anonDay}, a dev-scale limit (base is ${prodRef})`); leaked++; }
  }
  if (!leaked) ok.push('D01–D06 leakage: no dev-only relaxation appears in uat or prod');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  T — tunables against docs/04 §18 and schema defaults
// ─────────────────────────────────────────────────────────────────────────────────────────────────

const kebab = (s) => s.replace(/_/g, '-');

function checkTunables() {
  if (!SHEET.size) { err('T00 docs/04 §18 parameter sheet could not be parsed — the tunable checks would be vacuous'); return; }
  ok.push(`T00 tunables: parsed ${SHEET.size} documented parameters from docs/04 §18`);

  let missing = 0; let outOfRange = 0; let drifted = 0;

  for (const [param, spec] of SHEET) {
    const key = kebab(param);
    const inRetrieval = key in seedRetrieval;
    const inGeneration = key in seedGeneration;
    if (!inRetrieval && !inGeneration) {
      err(`T01 \`${param}\` is documented as runtime-tunable but is not seeded in albaraka.seed.retrieval or albaraka.seed.generation — a fresh database would start without it`);
      missing++;
      continue;
    }
    const value = inRetrieval ? seedRetrieval[key] : seedGeneration[key];

    // T02 range
    if (spec.min !== null && spec.max !== null) {
      const v = num(value);
      if (Number.isNaN(v)) err(`T02 \`${param}\` seeded as "${value}", which is not numeric, but docs/04 gives the range ${spec.min}–${spec.max}`);
      else if (v < spec.min || v > spec.max) { err(`T02 \`${param}\` seeded as ${v}, outside the documented range ${spec.min}–${spec.max}`); outOfRange++; }
    }
    // docs default agreement
    if (spec.default !== null) {
      const dv = num(spec.default);
      const sv = num(value);
      const agree = Number.isNaN(dv) || Number.isNaN(sv)
        ? String(spec.default).toLowerCase() === String(value).toLowerCase()
        : near(dv, sv);
      if (!agree) { err(`T02 \`${param}\` seeded as ${value} but docs/04 documents the default ${spec.default}`); outOfRange++; }
    }

  }

  // T03 — every seeded retrieval value must equal the column DEFAULT in schema.sql, and every
  // seeded key must name a column that exists. This loop covers the whole seed, not just the
  // parameters docs/04 happens to list: `embedding_variant`, `min_score_fts`, `boost_recent_days`
  // and `canary_percent` are not runtime tunables anyone adjusts from a lab, but a seed that
  // disagrees with the schema still produces a database whose defaults mean something else.
  for (const [key, value] of Object.entries(seedRetrieval)) {
    const col = key.replace(/-/g, '_');
    if (!RETRIEVAL_DEFAULTS.has(col)) {
      err(`T07 seed.retrieval.\`${key}\` names no retrieval_config column — the seeded row would not insert`);
      drifted++;
      continue;
    }
    if (JUSTIFIED_SEED_OVERRIDES.has(col)) continue;
    const schemaDefault = RETRIEVAL_DEFAULTS.get(col);
    const sv = num(value); const dv = num(schemaDefault);
    const agree = Number.isNaN(sv) || Number.isNaN(dv)
      ? String(schemaDefault).toLowerCase() === String(value).toLowerCase()
      : near(sv, dv);
    if (!agree) {
      err(`T03 seed.retrieval.\`${key}\` = ${JSON.stringify(value)} but retrieval_config.${col} DEFAULTs to ${schemaDefault} — the seed and the schema disagree about what "default" means`);
      drifted++;
    }
  }

  // T06 channel
  if (seedRetrieval.channel && CHANNEL.length && !CHANNEL.includes(seedRetrieval.channel)) {
    err(`T06 seed.retrieval.channel "${seedRetrieval.channel}" is not in the channel enum (${CHANNEL.join(', ')})`);
  }

  // T05 embedding variant must agree with the seeded EMBEDDING model
  const emb = seedModels.find((m) => m.code === 'EMBEDDING');
  if (emb && seedRetrieval['embedding-variant']) {
    const expected = `${emb['model-id']}@${emb['embedding-dim']}`;
    if (seedRetrieval['embedding-variant'] !== expected) {
      err(`T05 seed.retrieval.embedding-variant "${seedRetrieval['embedding-variant']}" disagrees with the seeded EMBEDDING model "${expected}" — chunks and queries would live in different vector spaces`);
    }
  }

  if (!missing && !outOfRange && !drifted) {
    ok.push(`T01–T07 tunables: all ${SHEET.size} documented parameters seeded and in range; all ${Object.keys(seedRetrieval).length} seeded retrieval values equal their schema DEFAULT`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  M — seeded model routing
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function checkModels() {
  if (!seedModels.length) { err('M01 albaraka.seed.models is empty'); return; }
  const codes = seedModels.map((m) => m.code);

  // M01 exact set equality with the enum
  const extra = codes.filter((c) => !MODEL_ROLE.includes(c));
  const absent = MODEL_ROLE.filter((r) => !codes.includes(r));
  if (extra.length) err(`M01 seeded model role(s) ${extra.join(', ')} are not in the model_role enum (${MODEL_ROLE.join(', ')})`);
  if (absent.length) err(`M01 model_role value(s) ${absent.join(', ')} have no seeded configuration — the pipeline would start with an unrouted role`);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dupes.length) err(`M01 duplicate seeded model role(s): ${[...new Set(dupes)].join(', ')}`);
  if (!extra.length && !absent.length && !dupes.length) ok.push(`M01 models: seeded roles are exactly the model_role enum (${codes.length} roles)`);

  // M02 providers
  for (const m of seedModels) {
    if (PROVIDER.length && !PROVIDER.includes(m.provider)) err(`M02 ${m.code}: provider "${m.provider}" is not in provider_code (${PROVIDER.join(', ')})`);
  }

  // M03 / M04 embeddings
  const emb = seedModels.find((m) => m.code === 'EMBEDDING');
  if (emb) {
    if (emb.provider === 'GROQ') err(`M04 EMBEDDING must not be routed to GROQ — Groq serves no embeddings endpoint`);
    if (emb.provider !== 'GOOGLE') warn(`M03 EMBEDDING is routed to ${emb.provider}; the architecture assumes Google GenAI (ADR-002 §3)`);
    if (!emb['embedding-dim']) err(`M03 EMBEDDING has no embedding-dim — ck_model_embedding_dim would reject the row`);
    else if (num(emb['embedding-dim']) !== 1536) warn(`M03 EMBEDDING dim is ${emb['embedding-dim']}, not the 1536 default of docs/03 §4`);
    if (!emb['task-type']) err(`M03 EMBEDDING has no task-type; gemini-embedding-001 requires RETRIEVAL_DOCUMENT at index time`);
  }

  // M05 required fields
  for (const m of seedModels) {
    for (const [field, test, msg] of [
      ['timeout-ms', (v) => num(v) > 0, 'must be a positive timeout'],
      ['retries', (v) => num(v) >= 0, 'must be a non-negative retry count'],
      ['rate-limit-per-min', (v) => num(v) > 0, 'must declare a rate limit — an unlimited role can exhaust the provider budget'],
      ['daily-budget-usd', (v) => num(v) > 0, 'must declare a daily budget'],
      // Embedding models take no sampling parameters; demanding a temperature here would force a
      // meaningless field into the configuration.
      ['temperature', (v) => num(v) >= 0 && num(v) <= 1, 'must be a temperature in 0–1', ['EMBEDDING']],
    ]) {
      const exempt = field === 'temperature' && m.code === 'EMBEDDING';
      if (exempt) continue;
      if (!(field in m)) err(`M05 ${m.code}: no ${field}`);
      else if (!test(m[field])) err(`M05 ${m.code}: ${field} = ${m[field]}, ${msg}`);
    }
  }

  // M06 fallbacks
  for (const m of seedModels) {
    const fb = m.fallback || m['fallback-config-id'];
    if (!fb) continue;
    if (fb === m.code) err(`M06 ${m.code}: fallback points at itself — ck_model_no_self_fallback would reject the row`);
    else if (!codes.includes(fb)) err(`M06 ${m.code}: fallback "${fb}" is not a seeded model role`);
  }

  // M07 deterministic roles
  // EMBEDDING is excluded: it samples nothing, so it has no temperature to pin.
  for (const role of ['CHAT_FAST', 'RERANKER', 'GUARD_SAFETY', 'GUARD_INJECTION']) {
    const m = seedModels.find((x) => x.code === role);
    if (!m) continue;
    if (!('temperature' in m)) err(`M07 ${role}: no temperature declared — a sampling role without a pinned temperature is not replayable`);
    else if (num(m.temperature) !== 0) err(`M07 ${role}: temperature ${m.temperature} — classification, reranking and guard decisions must be deterministic and replayable`);
  }

  // M08 no single role may out-budget the platform
  const platform = num(get(docs.base || {}, 'albaraka.egress.budget.daily-usd'));
  const platformBudget = Number.isNaN(platform) ? num(String(get(docs.base || {}, 'albaraka.egress.budget.daily-usd') || '').replace(/^\$\{[^:]*:/, '').replace(/\}$/, '')) : platform;
  for (const m of seedModels) {
    if (!Number.isNaN(platformBudget) && num(m['daily-budget-usd']) > platformBudget) {
      err(`M08 ${m.code}: daily-budget-usd ${m['daily-budget-usd']} exceeds the platform daily budget ${platformBudget}`);
    }
  }

  // M09 guard latency budget
  for (const role of ['GUARD_SAFETY', 'GUARD_INJECTION']) {
    const m = seedModels.find((x) => x.code === role);
    if (m && num(m['timeout-ms']) > 2000) err(`M09 ${role}: timeout-ms ${m['timeout-ms']} exceeds the 2 000 ms guard budget of docs/04 §15 — a slow guard is a guard users route around`);
  }

  // M10 the primary answering model must have a fallback
  const primary = seedModels.find((m) => m.code === 'CHAT_PRIMARY');
  if (primary && !primary.fallback) err('M10 CHAT_PRIMARY declares no fallback; a Groq outage would fail every answer instead of degrading to REF-05');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
//  C — cross-file consistency
// ─────────────────────────────────────────────────────────────────────────────────────────────────

function mustAgree(path, expect, id, why) {
  for (const p of PROFILES) {
    const v = mergedFlat[p].get(path);
    if (v === undefined) continue;
    const same = Array.isArray(expect) ? JSON.stringify(v) === JSON.stringify(expect) : v === expect;
    if (!same) err(`${id} application-${p}.yaml: \`${path}\` = ${JSON.stringify(v)}, expected ${JSON.stringify(expect)} — ${why}`);
  }
}

function checkConsistency() {
  mustAgree('albaraka.i18n.currency.decimals', 3, 'C02', 'TND is quoted to three decimals (docs/06); a two-decimal rendering misstates every tariff');
  mustAgree('albaraka.i18n.currency.code', 'TND', 'C02', 'the currency is the Tunisian dinar');
  mustAgree('albaraka.pipeline.streaming', true, 'C04', 'answers stream over SSE (docs/08 §4)');
  mustAgree('albaraka.pipeline.sources-before-first-token', true, 'C04', 'citations must reach the client before prose so a refusal can render sources');
  mustAgree('albaraka.pipeline.semantic-cache.key-includes-kb-epoch', true, 'C08', 'a knowledge-base promotion must invalidate every cached answer');
  mustAgree('albaraka.feature-flags.source', 'assistant_config', 'C05', 'flags are admin-editable at runtime; a YAML flag cannot be changed without a deploy');
  mustAgree('albaraka.feature-flags.unknown-flag-default', false, 'C05', 'an unrecognised flag must be OFF');
  mustAgree('albaraka.guardrails.disclaimers.appended-by', 'SERVER', 'C09', 'disclaimers are appended by the server, never generated by a model');
  mustAgree('albaraka.retention.conversation-anonymise-after-months', 24, 'C06', 'the 24-month anonymisation mandate (docs/07 §7)');
  mustAgree('albaraka.retention.audit-event-retain-years', 10, 'C06', 'audit events are retained 10 years');
  mustAgree('albaraka.egress.pii.mode', 'TOKENIZE', 'C07', 'PII is tokenised reversibly, not dropped — the answer must name the customer');
  mustAgree('spring.ai.openai.embedding.enabled', false, 'C10', 'Groq has no embeddings endpoint');
  mustAgree('albaraka.assistant.default-locale', 'fr-FR', 'C11', 'the default locale is French (docs/06)');

  // C01 kill-switch modes
  const baseModes = get(docs.base || {}, 'albaraka.kill-switch.modes');
  if (Array.isArray(baseModes)) {
    for (const p of ['prod', 'uat']) {
      const v = get(docs[p] || {}, 'albaraka.kill-switch.modes');
      if (v && JSON.stringify(v) !== JSON.stringify(baseModes)) err(`C01 application-${p}.yaml: kill-switch.modes ${JSON.stringify(v)} differs from the base ${JSON.stringify(baseModes)} — the ladder (docs/05 §7) is one ladder`);
    }
  }

  // C03 locales
  const baseLocales = get(docs.base || {}, 'albaraka.assistant.supported-locales');
  if (Array.isArray(baseLocales)) {
    for (const p of PROFILES) {
      const v = get(docs[p] || {}, 'albaraka.assistant.supported-locales');
      if (v && JSON.stringify(v) !== JSON.stringify(baseLocales)) err(`C03 application-${p}.yaml: supported-locales differs from the base`);
    }
    const expected = ['fr-FR', 'ar-TN', 'en-GB'];
    if (JSON.stringify(baseLocales) !== JSON.stringify(expected)) err(`C03 supported-locales ${JSON.stringify(baseLocales)} ≠ ${JSON.stringify(expected)} — the assistant is trilingual`);
  }

  // C12 egress allowlist must cover the seeded offshore providers and must not name localhost
  const allow = get(docs.base || {}, 'albaraka.egress.allowlist') || [];
  const usedHosts = new Map([['GROQ', 'api.groq.com'], ['GOOGLE', 'generativelanguage.googleapis.com']]);
  for (const m of seedModels) {
    const host = usedHosts.get(m.provider);
    if (host && !allow.includes(host)) err(`C12 egress.allowlist omits ${host}, required by the seeded ${m.code} role on ${m.provider} — deny-by-default would block every ${m.provider} call`);
  }
  for (const p of ['uat', 'prod']) {
    const list = get(merged[p], 'albaraka.egress.allowlist') || allow;
    for (const h of list) {
      if (/^(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(String(h))) err(`C12 application-${p}.yaml: egress.allowlist contains ${h} — a local endpoint in production egress is a tunnel`);
    }
  }

  // C13 sampling and timeouts: prod must not trace more than uat
  const sProd = num(get(docs.prod || {}, 'management.otlp.tracing.sampling.probability'));
  const sUat = num(get(docs.uat || {}, 'management.otlp.tracing.sampling.probability'));
  if (!Number.isNaN(sProd) && !Number.isNaN(sUat) && sProd > sUat) err(`C13 prod trace sampling ${sProd} exceeds uat ${sUat}; production samples less, never more`);

  ok.push('C01–C13 consistency: cross-file invariants (currency, locales, streaming, cache epoching, flags, retention, egress allowlist) hold');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────

if (docs.base) checkStructure(); else err('S01 application.yaml could not be loaded; downstream checks are suppressed');
checkSecrets();
if (docs.base && docs.prod && docs.uat) { checkProdHardening(); checkDevOnly(); }
checkTunables();
checkModels();
if (docs.base) checkConsistency();

console.log('\nconfig-lint — specs/config/\n' + '─'.repeat(88));
for (const o of ok) console.log('  ok    ' + o);
for (const w of warns) console.log('  WARN  ' + w);
for (const e of errors) console.log('  ERROR ' + e);
console.log('─'.repeat(88));
console.log(`  ${1 + PROFILES.length} config files · ${SHEET.size} documented tunables · ${seedModels.length} seeded model roles · ${MODEL_ROLE.length} enum roles`);
console.log(`  ${ok.length} groups checked · ${warns.length} warning(s) · ${errors.length} error(s)\n`);
process.exit(errors.length ? 1 : 0);
