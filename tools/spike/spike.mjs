#!/usr/bin/env node
/**
 * spike.mjs — provider & local dependency smoke test (Phase 0 deliverable, docs/13).
 *
 * Checks, in order:
 *   1. Groq      — key authenticated (GET /models), one minimal chat completion with a
 *                  spec-pinned chat model, one prompt-guard call (the cheapest guard path).
 *   2. Google    — key authenticated + one gemini-embedding-001 embedContent call with a
 *                  trilingual test string (the exact pipeline call, docs/02 §3 / docs/04 §4).
 *   3. local     — (--local only) postgres:9004, web edge:9000, keycloak OIDC
 *                  discovery for the `albaraka` realm — the data plane of deploy/docker-compose.yml.
 *
 * Exit code 0 = every *required* check passed. 1 = at least one failed. Skipped checks are
 * reported, never silently hidden. No network call needs anything beyond Node ≥ 20 (fetch).
 *
 * Usage:
 *   node spike.mjs                          # providers from .env (repo root), no local checks
 *   node spike.mjs --local                  # + the four local dependency checks
 *   node spike.mjs --mock                   # MOCK profile: keys not exercised, local checks only
 *   GROQ_API_KEY=… GOOGLE_API_KEY=… node spike.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

// ── spec-pinned contact points (docs/02 §3, docs/04 §4, specs/config/application.yaml) ─────────
const GROQ_BASE = (process.env.GROQ_BASE_URL || 'https://api.groq.com').replace(/\/$/, '');
const GROQ_API_URL = `${GROQ_BASE}/openai/v1`;
const GOOGLE_API_URL = 'https://generativelanguage.googleapis.com/v1beta';
const CHAT_MODEL = 'llama-3.3-70b-versatile';       // primary generator (docs/04 §6)
const CHAT_MODEL_FALLBACK = 'llama-3.1-8b-instant'; // fast-model step, budget ladder
const GUARD_MODEL = 'meta-llama/llama-prompt-guard-2-86m';
const EMBEDDING_MODEL = 'gemini-embedding-001';
const TRILINGUAL_SAMPLE = 'متى تفتح الوكالة؟ Quand ouvre l’agence ? When does the branch open?';

const args = new Set(process.argv.slice(2));
const doLocal = args.has('--local');
const mock = args.has('--mock');

// ── .env loading (the repo root .env, git-ignored; .env.example documents the shape) ───────────
function loadEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !m[1].startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = { ...loadEnv(join(root, '.env')), ...process.env };
const GROQ_KEY = env.GROQ_API_KEY || '';
const GOOGLE_KEY = env.GOOGLE_API_KEY || '';
const PROVIDER_MODE = mock ? 'MOCK' : (env.PROVIDER_MODE || '');

const rows = [];
let failed = 0, skipped = 0;
const report = (name, ok, detail) => {
  rows.push({ name, ok, detail });
  if (ok === null) skipped++;
  else if (!ok) failed++;
};
const color = (c, s) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);
const fmt = (r) => {
  const tag = r.ok === null ? 'SKIP' : r.ok ? 'ok  ' : 'FAIL';
  const c = r.ok === null ? 33 : r.ok ? 32 : 31;
  return `  ${color(c, tag)}  ${r.name.padEnd(30)} ${r.detail}`;
};

async function checkGroq() {
  if (!GROQ_KEY && !mock) { report('groq key', null, 'no GROQ_API_KEY in .env'); return; }
  if (mock) { report('groq key', null, 'MOCK profile — providers deliberately not called'); return; }
  const headers = { Authorization: `Bearer ${GROQ_KEY}` };
  const opts = { headers, signal: AbortSignal.timeout(15_000) };

  // 1. key + reachability
  try {
    const r = await fetch(`${GROQ_API_URL}/models`, opts);
    if (!r.ok) { report('groq /models', false, `HTTP ${r.status} — key rejected or endpoint changed`); return; }
    const { data } = await r.json();
    const ids = new Set((data || []).map((m) => m.id));
    report('groq /models', true, `${ids.size} models listed`);
    const hasChat = (m) => ids.has(m);
    const chat = hasChat(CHAT_MODEL) ? CHAT_MODEL
      : hasChat(CHAT_MODEL_FALLBACK) ? CHAT_MODEL_FALLBACK : null;
    if (!chat) {
      report('groq chat model', false, `neither ${CHAT_MODEL} nor ${CHAT_MODEL_FALLBACK} is listed — check model_config (docs/04 §6)`);
      return;
    }

    // 2. one minimal chat completion (max_tokens=1 keeps it ~free; validates payload shape)
    const body = { model: chat, messages: [{ role: 'user', content: 'السلام' }], max_tokens: 1, temperature: 0 };
    const c = await fetch(`${GROQ_API_URL}/chat/completions`, { ...opts, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const cj = await c.json().catch(() => ({}));
    if (!c.ok) { report(`groq chat (${chat})`, false, `HTTP ${c.status} ${cj.error?.message || ''}`.trim()); }
    else {
      const content = cj.choices?.[0]?.message?.content ?? '';
      report(`groq chat (${chat})`, true, `HTTP 200, 1 token out (${cj.usage?.completion_tokens ?? '?'} tokens)`);
      if (!content && !cj.choices?.[0]) report(`groq chat (${chat})`, false, '200 but no choice content — payload contract drifted (docs/04 §9 answer contract)');
    }

    // 3. prompt guard (the cheapest guard call; the guard bean path, docs/04 §5)
    const g = await fetch(`${GROQ_API_URL}/chat/completions`, {
      ...opts, method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: GUARD_MODEL, messages: [{ role: 'user', content: 'hello' }], max_tokens: 2 }),
    });
    if (g.status === 404) report('groq prompt guard', null, `${GUARD_MODEL} not exposed on this key/plan — guard path unverified`);
    else if (!g.ok) report('groq prompt guard', false, `HTTP ${g.status}`);
    else report('groq prompt guard', true, 'HTTP 200 (not a protected-model error)');
  } catch (e) {
    report('groq', false, e.name === 'TimeoutError' ? 'network timeout (> 15 s)' : e.message);
  }
}

async function checkGoogle() {
  if (!GOOGLE_KEY && !mock) { report('google key', null, 'no GOOGLE_API_KEY in .env'); return; }
  if (mock) { report('google key', null, 'MOCK profile — providers deliberately not called'); return; }
  try {
    const u = `${GOOGLE_API_URL}/models/${EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(GOOGLE_KEY)}`;
    const r = await fetch(u, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: `models/${EMBEDDING_MODEL}`, content: { parts: [{ text: TRILINGUAL_SAMPLE }] } }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      report(`google embed (${EMBEDDING_MODEL})`, false, `HTTP ${r.status} ${j.error?.message || ''}`.trim());
      return;
    }
    const dim = j.embedding?.values?.length || 0;
    report(`google embed (${EMBEDDING_MODEL})`, dim > 0, `HTTP 200, ${dim} dims · retrieval_config.embedding_variant expects "gemini-embedding-001@1536" (docs/04 §4)`);
  } catch (e) {
    report('google', false, e.name === 'TimeoutError' ? 'network timeout (> 15 s)' : e.message);
  }
}

async function checkLocal() {
  const probe = async (name, url, predicate = (txt) => txt.length > 0) => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const text = await r.text().catch(() => '');
      report(name, r.ok && predicate(text), `HTTP ${r.status}`);
    } catch (e) {
      report(name, false, e.name === 'TimeoutError' ? 'timeout (> 5 s) — is docker compose up running?' : e.message);
    }
  };
  await probe('postgres :9004', 'http://localhost:9004/').catch(() => report('postgres :9004', null, 'TCP probe not available via fetch — run `docker compose ps`'));
  await probe('web edge :9000', 'http://localhost:9000/', (t) => t.includes('<')).catch(() => report('web edge :9000', null, 'edge seems down — run `make up`'));
  await probe('keycloak oidc', 'http://localhost:9001/realms/albaraka/.well-known/openid-configuration', (t) => t.includes('issuer'));
}

console.log('\nal-Mouchir spike — provider & dependency smoke test (docs/13 Phase 0)\n' + '─'.repeat(86));
console.log(`  mode: ${mock ? 'MOCK' : PROVIDER_MODE || 'REAL keys from .env'} · local checks: ${doLocal ? 'ON' : 'off (--local)'}`);
await checkGroq();
await checkGoogle();
if (doLocal) await checkLocal();
console.log('─'.repeat(86));
for (const r of rows) console.log(fmt(r));
console.log('─'.repeat(86));
console.log(`  ${rows.filter((r) => r.ok === true).length} passed · ${failed} failed · ${skipped} skipped`);
console.log(failed ? '\n  RESULT: FAIL — see rows above; fix the key/endpoint or run with --mock (docs/02 §6 local-mock profile).\n'
  : `\n  RESULT: ${rows.length && rows.every((r) => r.ok !== false) ? 'PASS' : 'PASS (all required checks) — keys not exercised is logged above.'}\n`);
process.exit(failed ? 1 : 0);
