#!/usr/bin/env node
/**
 * asyncapi-lint — cross-spec validation of specs/asyncapi.yaml
 *
 * The event contract has three authorities, and each part of the file is validated against the
 * one it derives from:
 *
 *   docs/08-api-design.md §3.1 + specs/openapi.yaml   the SSE turn-event grammar (event order,
 *                                                       payload shapes, enums)
 *   docs/08-api-design.md §6                          the internal event catalog (names, emitters,
 *                                                       consumers) — the table, not a copy of it
 *   specs/db/schema.sql                               the payload grounding (x-table-ref columns,
 *                                                       enum membership). A payload property that is
 *                                                       neither a column nor explicitly x-derived
 *                                                       is an error, because it is an invented fact
 *                                                       with no storage.
 *
 * The PII rule is also enforced here: internal events are references, not content. Questions,
 * comments, answers and contact data stay in the database; consumers re-read what they need.
 *
 * Exit 0 = pass, 1 = at least one ERROR.
 *
 * Usage: node tools/asyncapi-lint/lint.mjs   [ASYNCAPI_FILE=…] [DOC08_FILE=…] [OPENAPI_FILE=…] [SCHEMA_FILE=…]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const SPEC_PATH = process.env.ASYNCAPI_FILE || join(root, 'specs', 'asyncapi.yaml');
const DOC08_PATH = process.env.DOC08_FILE || join(root, 'docs', '08-api-design.md');
const OPENAPI_PATH = process.env.OPENAPI_FILE || join(root, 'specs', 'openapi.yaml');
const SCHEMA_PATH = process.env.SCHEMA_FILE || join(root, 'specs', 'db', 'schema.sql');

const errors = [], warns = [], ok = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  helpers
// ══════════════════════════════════════════════════════════════════════════════════════════════
const camelToSnake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

let spec;
try {
  spec = yaml.load(readFileSync(SPEC_PATH, 'utf8'));
} catch (e) {
  console.log(`\nasyncapi-lint — FATAL\n  ${SPEC_PATH} is not valid YAML: ${e.message}\n`);
  process.exit(1);
}

function schemaEnum(name) {
  if (!existsSync(SCHEMA_PATH)) { err(`cannot read ${SCHEMA_PATH}`); return []; }
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  const m = sql.match(new RegExp(`CREATE TYPE\\s+${name}\\s+AS\\s+ENUM\\s*\\(([^)]*)\\)`, 'i'));
  if (!m) { err(`schema.sql: no CREATE TYPE ${name} AS ENUM`); return []; }
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function schemaTableCols(name) {
  if (!existsSync(SCHEMA_PATH)) { err(`cannot read ${SCHEMA_PATH}`); return new Set(); }
  const sql = readFileSync(SCHEMA_PATH, 'utf8');
  const m = sql.match(new RegExp(`CREATE TABLE\\s+${name}\\s*\\((.*?)\\)\\s*;`, 'is'));
  if (!m) return null;
  const cols = new Set();
  for (const line of m[1].split('\n')) {
    const tok = line.trim().split(/\s+/)[0] || '';
    if (/^[a-z_][a-z0-9_]*$/.test(tok) && !/^(constraint|primary|unique|foreign|check|references|partition|like|exclude)$/i.test(tok)) cols.add(tok);
  }
  return cols;
}

/** Resolve a local `$ref` pointer inside the asyncapi document. */
function resolveDocRef(ref) {
  if (!ref || !ref.startsWith('#/')) return null;
  const parts = ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = spec;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[p];
  }
  return cur;
}

/** Resolve local `$ref` pointers inside an OpenAPI/OpenAPI-style schema object. */
function deref(oapi, obj, depth = 0) {
  if (depth > 4 || obj == null) return obj;
  if (obj.$ref && obj.$ref.startsWith('#/')) {
    const parts = obj.$ref.slice(2).split('/').map((p) => p.replace(/~1/g, '/'));
    let cur = oapi;
    for (const p of parts) { if (cur == null) return obj; cur = cur[p]; }
    return deref(oapi, cur, depth + 1) ?? obj;
  }
  return obj;
}

const isRef = (o) => o && typeof o === 'object' && typeof o.$ref === 'string';
const isArr = (o) => Array.isArray(o);

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  authority: openapi.yaml SSE schemas
// ══════════════════════════════════════════════════════════════════════════════════════════════
let oapi = null;
try { oapi = yaml.load(readFileSync(OPENAPI_PATH, 'utf8')); } catch (e) { err(`cannot read ${OPENAPI_PATH}: ${e.message}`); }

/** event name → { schema, dataProps } from the openapi text/event-stream oneOf. */
const OAPI_SSE = {};
if (oapi) {
  const op = oapi.paths?.['/api/v1/assistant/conversations/{conversationId}/messages']?.post;
  const med = op?.responses?.['200']?.content?.['text/event-stream']?.schema;
  for (const entry of med?.oneOf ?? []) {
    const sch = deref(oapi, entry);
    const evt = (sch?.properties?.event?.const) || (sch?.properties?.event?.enum || [])[0];
    const data = deref(oapi, sch?.properties?.data);
    const props = new Set(Object.keys(data?.properties ?? {}));
    if (evt && sch) OAPI_SSE[evt] = { schema: sch.name || sch.title || evt, dataProps: props };
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  authority: docs/08 §3.1 (SSE order) and §6 (event catalog)
// ══════════════════════════════════════════════════════════════════════════════════════════════
const DOC08 = existsSync(DOC08_PATH) ? readFileSync(DOC08_PATH, 'utf8') : (err(`cannot read ${DOC08_PATH}`), '');

function docOrderEvents() {
  const start = DOC08.indexOf('### 3.1 SSE streaming contract');
  if (start < 0) { err('docs/08 §3.1: section not found'); return []; }
  const blocks = [...DOC08.slice(start).matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
  const main = (blocks[0] || '').split('\n').map((l) => l.match(/^event:\s*(\w+)/)?.[1]).filter(Boolean);
  if (!main.length) { err('docs/08 §3.1: no `event:` frames found in the normative example'); return []; }
  // the “alternative terminal events” block is the one that follows the phrase
  const altAt = DOC08.indexOf('Alternative terminal events instead', start);
  const alt = altAt > 0 ? [...DOC08.slice(altAt).matchAll(/```\n([\s\S]*?)```/g)][0]?.[1] : '';
  const altEvents = (alt || '').split('\n').map((l) => l.match(/^event:\s*(\w+)/)?.[1]).filter(Boolean);
  return { main, altEvents };
}
const DOC_ORDER = docOrderEvents();

/** docs/08 §6: event name → { emitter, consumers } */
function docEvents() {
  const start = DOC08.indexOf('## 6. Internal events (AsyncAPI)');
  const end = DOC08.indexOf('## 7.', start);
  if (start < 0 || end < 0) { err('docs/08 §6: section not found'); return new Map(); }
  const map = new Map();
  for (const line of DOC08.slice(start, end).split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const name = (cells[1] && cells[1].match(/`([^`]+)`/))?.[1];
    if (!name) continue;
    const emitter = (cells[3] || '').match(/`([^`]+)`/)?.[1] || cells[3].trim();
    const consumers = (cells[4] || '').split(',').map((c) => c.trim().replace(/`/g, '')).filter(Boolean);
    if (name && consumers.length) map.set(name, { emitter, consumers });
  }
  return map;
}
const DOC_EVENTS = docEvents();

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  G — structure & hygiene
// ══════════════════════════════════════════════════════════════════════════════════════════════
{
  if (spec.asyncapi !== '3.1.0') err('[G01] asyncapi is "' + spec.asyncapi + '", expected "3.1.0" (current 3.x release; verified with @asyncapi/parser)');
  if (!spec.info?.title || !spec.info?.version) err('[G02] info.title / info.version are required');
  if (!spec.defaultContentType) err('[G02] defaultContentType is required (application/json)');

  const channels = Object.entries(spec.channels || {});
  if (!channels.length) err('[G03] no channels declared');
  const allChannels = new Map();
  for (const [key, ch] of channels) {
    if (!ch.address) err(`[G03] channel ${key}: address is required`);
    if (!ch.messages || !Object.keys(ch.messages).length) err(`[G03] channel ${key}: messages map is empty`);
    allChannels.set(key, ch);
  }

  const ops = Object.entries(spec.operations || {});
  if (!ops.length) err('[G03] no operations declared');
  const seenAddresses = new Map();
  for (const [key, op] of ops) {
    if (!['send', 'receive'].includes(op.action)) err(`[G03] operation ${key}: action must be send or receive, got "${op.action}"`);
    const chRef = op.channel?.$ref;
    const chName = chRef?.replace('#/channels/', '');
    if (!chRef || !allChannels.has(chName)) err(`[G03] operation ${key}: channel ref "${chRef}" does not resolve`);
    else {
      const address = allChannels.get(chName).address;
      if (!seenAddresses.has(address)) seenAddresses.set(address, { send: [], receive: [] });
      seenAddresses.get(address)[op.action].push(key);
    }
    const msgs = op.messages || [];
    if (!msgs.length) err(`[G03] operation ${key}: messages list is empty`);
    for (const m of msgs) {
      const ref = m?.$ref || '';
      const parts = ref.replace('#/', '').split('/');
      const ch = parts[1] && allChannels.get(parts[1]);
      if (!ch || !ch.messages?.[parts[3]] || parts[1] !== chName) {
        err(`[G03] operation ${key}: message ref "${ref}" does not resolve to a message of the operation's channel (${chName})`);
      }
    }
  }
  // every channel must have exactly one send and one receive operation (the bus is in-process:
  // publishers and consumers are the contract's two halves)
  for (const [address, { send, receive }] of seenAddresses) {
    if (send.length !== 1) err(`[G04] channel ${address}: ${send.length} send operations, expected exactly 1`);
    if (receive.length !== 1) err(`[G04] channel ${address}: ${receive.length} receive operations, expected exactly 1`);
  }
  for (const [, ch] of allChannels) if (!seenAddresses.has(ch.address)) err(`[G04] channel ${ch.address}: not referenced by any operation`);
  ok.push(`structure: ${channels.length} channels, ${ops.length} operations, every ref resolves, one send + one receive per channel`);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  S — SSE stream: order rules and payload parity with openapi.yaml
// ══════════════════════════════════════════════════════════════════════════════════════════════
const SSE_NAMES = ['accepted', 'status', 'sources', 'token', 'answer', 'refusal', 'error', 'done'];
{
  const chat = spec.channels?.chatStream;
  if (!chat) err('[S01] channel "chatStream" is missing — the SSE stream is not documented');
  const msgList = Object.fromEntries(['sendMessage', ...SSE_NAMES].map((n) => [n, (chat?.messages || {})[n]]));

  // S01 — the documented event set (channel message keys are the SSE frame names)
  const declared = new Set(Object.keys(chat?.messages || {}).filter((k) => k !== 'sendMessage'));
  const expected = new Set(SSE_NAMES);
  for (const n of expected) if (!declared.has(n)) err(`[S01] chatStream message "${n}" is missing`);
  for (const n of declared) if (!expected.has(n)) err(`[S01] chatStream declares message "${n}" which is not a documented SSE event`);

  // every message referenced by the receive operation must be one of the eight
  const receiveMsgs = new Set((spec.operations?.receiveAnswerStream?.messages || []).map((m) => m.$ref.split('/').pop()));
  for (const n of SSE_NAMES) if (!receiveMsgs.has(n)) err(`[S01] receiveAnswerStream does not reference message "${n}"`);
  for (const n of receiveMsgs) if (!SSE_NAMES.includes(n)) err(`[S01] receiveAnswerStream references "${n}" which is not an SSE event`);

  // S02 — the order rules (authority: docs/08 §3.1 example blocks)
  const seq = chat?.['x-sse-sequence'] || [];
  if (JSON.stringify(seq) !== JSON.stringify(['accepted', 'status', 'sources', 'token', 'TERMINAL', 'done'])) {
    err('[S02] x-sse-sequence is not the documented frame order accepted → status* → sources → token* → TERMINAL → done');
  }
  if (seq.includes('sources') && seq.includes('token') && seq.indexOf('sources') > seq.indexOf('token')) {
    err('[S02] x-sse-sequence puts "sources" after "token" — citations must precede the first token');
  }
  if (seq[seq.length - 1] !== 'done') err('[S02] x-sse-sequence must end with "done"');
  if (chat?.['x-sse-rules']?.['sources-before-first-token'] !== true) err('[S02] x-sse-rules.sources-before-first-token must be true');
  const term = chat?.['x-sse-rules']?.['terminal-exactly-one-of'] || [];
  if (JSON.stringify(term) !== JSON.stringify(['answer', 'refusal', 'error'])) err('[S02] x-sse-rules.terminal-exactly-one-of must be [answer, refusal, error]');
  if (chat?.['x-sse-rules']?.['done-always-last'] !== true) err('[S02] x-sse-rules.done-always-last must be true');

  // derived from the doc prose: idle timeout and Last-Event-ID behaviour
  const idle = DOC08.match(/after a (\d+) s idle timeout/);
  if (!idle) err('[S02] docs/08 §3.1: the 30 s idle timeout sentence is missing');
  else if (Number(chat?.['x-sse-rules']?.['idle-timeout-ms']) !== Number(idle[1]) * 1000) {
    err(`[S02] x-sse-rules.idle-timeout-ms is ${chat?.['x-sse-rules']?.['idle-timeout-ms']}, docs/08 §3.1 says ${idle[1]} s`);
  }
  const resume = DOC08.includes('Last-Event-ID') && /not[\s*]+supported/.test(DOC08);
  if (!resume) err('[S02] docs/08 §3.1: the Last-Event-ID non-resumption sentence is missing');
  if (chat?.['x-sse-rules']?.['last-event-id-resume'] !== false) err('[S02] x-sse-rules.last-event-id-resume must be false');

  // authority cross-check: the docs example order
  if (DOC_ORDER.main?.length) {
    if (DOC_ORDER.main[0] !== 'accepted') err('[S02] docs/08 §3.1 order: first event must be "accepted"');
    const sourceAt = DOC_ORDER.main.indexOf('sources'), tokenAt = DOC_ORDER.main.indexOf('token');
    if (sourceAt >= 0 && tokenAt >= 0 && sourceAt > tokenAt) err('[S02] docs/08 §3.1 shows "sources" after "token" — the rule and the example disagree');
    if (DOC_ORDER.main.at(-1) !== 'done') err('[S02] docs/08 §3.1 order: last event must be "done"');
  }
  if (DOC_ORDER.altEvents?.length) {
    // the doc's terminal set = the one terminal in the main example + the alternative block's
    const docTerminals = [...new Set([...(DOC_ORDER.main || []).filter((e) => ['answer', 'refusal', 'error'].includes(e)), ...DOC_ORDER.altEvents])];
    if (JSON.stringify(docTerminals) !== JSON.stringify(term)) {
      err(`[S02] docs/08 §3.1 terminal set is [${docTerminals.join(', ')}], x-sse-rules says [${term.join(', ')}]`);
    }
  }

  // S03 — payload parity with openapi.yaml (property sets + event const)
  const oapiSseName = (evt) => 'Sse' + evt[0].toUpperCase() + evt.slice(1);
  for (const evt of SSE_NAMES) {
    const open = OAPI_SSE[evt];
    if (!open) { err(`[S03] openapi.yaml has no Sse${evt[0].toUpperCase()}${evt.slice(1)} schema in the SSE oneOf`); continue; }
    const msgRef = msgList[evt]?.$ref;
    const msg = msgRef ? resolveDocRef(msgRef) : null;
    if (!msg) { err(`[S03] chatStream message "${evt}" ref does not resolve`); continue; }
    const payload = msg.payload?.$ref ? resolveDocRef(msg.payload.$ref) : msg.payload;
    if (!payload) { err(`[S03] message ${evt}: payload does not resolve`); continue; }
    // event name
    const evtName = msg['x-event-name'];
    const oapiConst = Object.keys(OAPI_SSE).find((k) => k === evt);
    if (evtName !== evt) err(`[S03] message ${evt}: x-event-name is "${evtName}", expected "${evt}" — the SSE frame name and the openapi const must agree`);
    if (oapiConst && msg.name !== evt) err(`[S03] message ${evt}: name must be the lowercase SSE frame name "${evt}"`);
    // property set
    const mine = new Set(Object.keys(payload.properties || {}));
    const missing = [...open.dataProps].filter((p) => !mine.has(p));
    const extra = [...mine].filter((p) => !open.dataProps.has(p));
    if (missing.length) err(`[S03] ${evt}: payload lacks openapi fields ${missing.join(', ')}`);
    if (extra.length) err(`[S03] ${evt}: payload adds fields ${extra.join(', ')} not present in openapi ${open.schema}`);
    // enums derived from openapi authorities
    if (evt === 'status') {
      const stage = payload.properties?.stage;
      const oapiStage = deref(oapi, oapi?.components?.schemas?.['SseStatus']?.properties?.data)?.properties?.stage;
      if (stage?.enum && oapiStage?.enum && JSON.stringify(stage.enum) !== JSON.stringify(oapiStage.enum)) {
        err('[S03] status: stage enum differs from openapi SseStatus — ' + stage.enum.join('|') + ' vs ' + oapiStage.enum.join('|'));
      }
    }
  }
  // S04 — request parity
  {
    const msg = resolveDocRef(msgList.sendMessage?.$ref || '');
    const open = oapi?.components?.schemas?.['SendMessageRequest'];
    if (!msg || !open) err('[S04] SendMessageRequest is missing from the spec or openapi.yaml');
    else {
      const mine = new Set(Object.keys(msg.payload?.properties || {}));
      const theirs = new Set(Object.keys(open.properties || {}));
      const missing = [...theirs].filter((p) => !mine.has(p));
      const extra = [...mine].filter((p) => !theirs.has(p));
      if (missing.length) err(`[S04] SendMessageRequest lacks openapi fields ${missing.join(', ')}`);
      if (extra.length) err(`[S04] SendMessageRequest adds fields ${extra.join(', ')} not in openapi`);
      if (JSON.stringify(msg.payload.required || []) !== JSON.stringify(open.required || [])) err('[S04] SendMessageRequest required fields differ from openapi');
    }
  }
  // S05 — shared enums (locale, dir, refusalCode) equal their openapi authorities
  const ENUM_AUTH = {
    locale: { open: 'Locale', fields: ['locale', 'language', 'questionLocale'] },
    dir: { open: 'Direction', fields: ['dir'] },
    refusalCode: { open: 'RefusalCode', fields: ['refusalCode'] },
  };
  for (const [key, { open, fields }] of Object.entries(ENUM_AUTH)) {
    const authority = oapi?.components?.schemas?.[open]?.enum;
    if (!authority) { err(`[S05] openapi has no ${open} enum`); continue; }
    for (const msgName of SSE_NAMES) {
      const msg = resolveDocRef(msgList[msgName]?.$ref || '');
      const payload = msg?.payload?.$ref ? resolveDocRef(msg.payload.$ref) : msg?.payload;
      for (const f of fields) {
        const vals = payload?.properties?.[f]?.enum;
        if (vals && JSON.stringify(vals) !== JSON.stringify(authority)) {
          err(`[S05] ${msgName}.${f} enum differs from openapi ${open} (${vals.join('|')} vs ${authority.join('|')})`);
        }
      }
    }
  }
  ok.push(`SSE: 8 frames, order pinned by docs/08 §3.1, payloads and enums equal to openapi.yaml Sse* schemas`);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  E — internal events: catalog, emitters, consumers, grounding
// ══════════════════════════════════════════════════════════════════════════════════════════════
const ENVELOPE_PROPS = new Set(['eventId', 'type', 'occurredAt', 'correlationId', 'actor', 'sourceModule']);
const INTERNAL_CHANNELS = Object.entries(spec.channels || {}).filter(([, ch]) => ch.address?.startsWith('app.event.'));
const PAYLOAD_ENUMS = {
  DocumentVersionSubmittedPayload: { riskTier: 'risk_tier' },
  ReviewDecidedPayload: { state: 'review_state', decision: 'review_decision' },
  GuardrailBlockedPayload: { severity: 'guardrail_severity', decision: 'guardrail_decision', refusalCode: 'refusal_code' },
  FeedbackReceivedPayload: { rating: 'feedback_rating', status: 'feedback_status' },
  FatwaRequestOpenedPayload: { questionLocale: 'locale_code' },
  PromptActivatedPayload: { locale: 'locale_code' },
  ModelActivatedPayload: { provider: 'provider_code' },
  EvalCompletedPayload: { gate: 'gate_result' },
  BudgetThresholdCrossedPayload: { provider: 'provider_code', purpose: 'model_role' },
};
const PII_FIELD = /^(question|answer|comment|body|content|contact|text|markdown|excerpt|address|phone|email|cin|iban|rib)(_.*)?$/i;

{
  const specEvents = new Map();
  for (const [key, ch] of INTERNAL_CHANNELS) {
    const msg = resolveDocRef(Object.values(ch.messages || {})[0]?.$ref || '');
    if (!msg) { err(`[E01] channel ${key}: message ref does not resolve`); continue; }
    const evt = msg['x-event-type'];
    const expectAddr = 'app.event.' + evt;
    if (ch.address !== expectAddr) err(`[E01] channel ${key}: address "${ch.address}" must equal app.event. + x-event-type ("${expectAddr}")`);
    if (!evt) { err(`[E01] message ${msg.name}: no x-event-type`); continue; }
    if (specEvents.has(evt)) err(`[E01] duplicate event type "${evt}"`);
    specEvents.set(evt, { channelKey: key, message: msg, channel: ch });
  }

  // E01 — catalog parity with docs/08 §6 (derive, don't copy)
  const documented = [...DOC_EVENTS.keys()].sort();
  const declared = [...specEvents.keys()].sort();
  for (const n of documented) if (!declared.includes(n)) err(`[E01] docs/08 §6 event \`${n}\` is not declared in asyncapi.yaml`);
  for (const n of declared) if (!documented.includes(n)) err(`[E01] asyncapi.yaml declares \`${n}\` which is not in docs/08 §6 — add it to the doc or remove it`);

  // E02/E03 — consumers and emitters
  for (const [evt, { message, channelKey, channel }] of specEvents) {
    const doc = DOC_EVENTS.get(evt);
    if (!doc) continue;
    const recv = Object.entries(spec.operations || {}).find(([, op]) => op.action === 'receive' && op.channel?.$ref === `#/channels/${channelKey}`);
    const send = Object.entries(spec.operations || {}).find(([, op]) => op.action === 'send' && op.channel?.$ref === `#/channels/${channelKey}`);
    const consumers = recv?.[1]['x-consumers'] || [];
    if (JSON.stringify(consumers) !== JSON.stringify(doc.consumers)) {
      err(`[E02] ${evt}: x-consumers [${consumers.join(', ')}] differs from docs/08 §6 [${doc.consumers.join(', ')}]`);
    }
    if (send?.[1]['x-emitted-by'] !== doc.emitter) {
      err(`[E03] ${evt}: send op x-emitted-by is "${send?.[1]['x-emitted-by']}", docs/08 §6 says "${doc.emitter}"`);
    }
    if (message['x-emitted-by'] !== doc.emitter) err(`[E03] ${evt}: message x-emitted-by is "${message['x-emitted-by']}", docs/08 §6 says "${doc.emitter}"`);
    if (channel['x-emitted-by']) warn(`[E03] ${evt}: x-emitted-by belongs on the operation/message, not the channel`);
  }

  // E04–E06 — table grounding, derived discipline, enum membership
  for (const [evt, { message }] of specEvents) {
    const tables = Array.isArray(message['x-table-ref']) ? message['x-table-ref'] : (message['x-table-ref'] ? [message['x-table-ref']] : []);
    if (!tables.length) { err(`[E04] ${evt}: no x-table-ref — payload grounding cannot be verified`); continue; }
    const cols = new Set();
    for (const t of tables) {
      const c = schemaTableCols(t);
      if (!c) { err(`[E04] ${evt}: x-table-ref table \`${t}\` does not exist in schema.sql`); continue; }
      for (const x of c) cols.add(x);
    }
    // E07 — the payload must be composed exactly as the contract says: one envelope ref and one
    // inline `type` const equal to the event name
    const allOf = message.payload?.allOf || [];
    const envelopeRefs = allOf.filter((s) => (s.$ref || '').endsWith('/EventEnvelope'));
    if (envelopeRefs.length !== 1) err(`[E07] ${evt}: payload allOf must reference EventEnvelope exactly once (found ${envelopeRefs.length})`);
    const typeConsts = allOf.filter((s) => !s.$ref);
    const constValue = typeConsts[0]?.properties?.type?.const;
    if (typeConsts.length !== 1 || constValue !== evt) {
      err(`[E07] ${evt}: payload allOf must constrain type to the const "${evt}" (got ${JSON.stringify(constValue)})`);
    }

    // specific payload = the allOf member that is neither the envelope nor the inline `type` const
    const specificRef = allOf.find((s) => !(s.$ref || '').endsWith('/EventEnvelope') && !s.type);
    const specific = specificRef?.$ref ? resolveDocRef(specificRef.$ref) : specificRef;
    const specificName = (specificRef?.$ref || '').split('/').pop() || '';
    if (!specific) { err(`[E04] ${evt}: specific payload not found in allOf`); continue; }

    const enumMap = PAYLOAD_ENUMS[specificName] || {};
    for (const [name, prop] of Object.entries(specific.properties || {})) {
      // E05 — column, x-derived, or (envelope-held) error
      if (ENVELOPE_PROPS.has(name)) { err(`[E05] ${evt}.${name} duplicates an envelope field`); continue; }
      const snake = camelToSnake(name);
      if (PII_FIELD.test(snake) && !snake.endsWith('_locale')) {
        err(`[P01] ${evt}.${name}: internal events are references, not content — content-bearing fields stay in the database (docs/08 §6, docs/07 §5)`);
        continue;
      }
      const derived = prop['x-derived'] === true;
      const isCol = cols.has(snake) || (name === 'id' && tables.some((t) => schemaTableCols(t)?.has('id')));
      if (isCol && derived) err(`[E05] ${evt}.${name}: marked x-derived but is a real column (${snake}) — the marker is stale`);
      if (!isCol && !derived) err(`[E05] ${evt}.${name}: neither a column of [${tables.join(', ')}] (as ${snake}) nor x-derived — an event fact with no storage`);
      // E06 — enum membership against schema.sql
      const enumName = enumMap[name];
      if (enumName && prop?.enum) {
        const allowed = schemaEnum(enumName);
        const bad = (prop.enum || []).filter((v) => !allowed.includes(v));
        if (bad.length) err(`[E06] ${evt}.${name}: enum values [${bad.join(', ')}] are not in schema.sql ${enumName} (${allowed.join('|')})`);
      }
    }
  }
  // E08 — the envelope itself is complete: the four mandated fields must exist and be required
  const envelope = resolveDocRef('#/components/schemas/EventEnvelope');
  if (!envelope) err('[E08] EventEnvelope schema is missing from components.schemas');
  else {
    const req = envelope.required || [];
    for (const f of ['eventId', 'type', 'occurredAt', 'sourceModule']) {
      if (!req.includes(f)) err(`[E08] EventEnvelope.required is missing "${f}"`);
      if (!envelope.properties?.[f]) err(`[E08] EventEnvelope has no "${f}" property`);
    }
  }
  ok.push(`events: ${specEvents.size}/${documented.length} catalog parity with docs/08 §6, emitters and consumers 1:1, payloads DB-grounded`);
}

// payload grounding of the SSE stream: citations/messages must never leak PII either
{
  for (const [, ch] of Object.entries(spec.channels || {})) {
    if (!ch.address?.startsWith('/api/')) continue;
    for (const [, m] of Object.entries(ch.messages || {})) {
      const msg = resolveDocRef(m.$ref || '');
      const payload = msg?.payload?.$ref ? resolveDocRef(msg.payload.$ref) : msg?.payload;
      const props = payload?.properties || {};
      for (const name of Object.keys(props)) {
        if (/^(contact|phone|email|address|cin|iban|rib|pii)/i.test(name)) {
          err(`[P02] ${msg?.name}: SSE payload field "${name}" — customer contact/PII fields are never streamed; they stay on the request path (docs/07 §5)`);
        }
      }
    }
  }
  ok.push('PII: no content-bearing or contact fields in any event payload');
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  output
// ══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\nasyncapi-lint — specs/asyncapi.yaml\n' + '─'.repeat(86));
console.log(`  SSE frames from openapi.yaml: ${Object.keys(OAPI_SSE).join(', ') || '—'}`);
console.log(`  internal events from docs/08 §6: ${DOC_EVENTS.size}  ·  declared: ${[...new Set(INTERNAL_CHANNELS.map(([, c]) => c.address))].length}`);
console.log('─'.repeat(86));
for (const o of ok) console.log('  ok    ' + o);
for (const w of warns) console.log('  WARN  ' + w);
for (const e of errors) console.log('  ERROR ' + e);
console.log('─'.repeat(86));
console.log(`  ${ok.length} groups checked · ${warns.length} warning(s) · ${errors.length} error(s)\n`);
process.exit(errors.length ? 1 : 0);
