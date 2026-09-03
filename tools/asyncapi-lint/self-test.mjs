#!/usr/bin/env node
/**
 * asyncapi-lint mutation self-test
 *
 * Same discipline as every gate in this repository: each check must be seen to fail once. The
 * mutations reproduce defects that are real risks for an event contract — a renamed event that
 * silently disconnects a consumer, an SSE frame whose payload drifted from openapi.yaml, an event
 * payload field that has no column and no derivation, customer content smuggled into an internal
 * event.
 *
 * Usage: node tools/asyncapi-lint/self-test.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const SRC = join(root, 'specs', 'asyncapi.yaml');
const LINT = join(here, 'lint.mjs');

import yaml from 'js-yaml';

function readSpec() { return yaml.load(readFileSync(SRC, 'utf8')); }

function runLint(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'asyncapi-lint-'));
  const file = join(dir, 'asyncapi.yaml');
  writeFileSync(file, yaml.dump(spec, { lineWidth: 120 }), 'utf8');
  let r;
  try {
    const out = execFileSync(process.execPath, [LINT], {
      env: { ...process.env, ASYNCAPI_FILE: file }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    r = { code: 0, out };
  } catch (e) {
    r = { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
  rmSync(dir, { recursive: true, force: true });
  return r;
}

const ch = (s, k) => { const c = s.channels?.[k]; if (!c) throw new Error(`no channel ${k}`); return c; };
const msg = (s, k, n) => { const m = ch(s, k).messages?.[n]; if (!m?.['$ref']) throw new Error(`no message ${k}/${n}`); return m; };
const schema = (s, name) => {
  const sch = s.components?.schemas?.[name];
  if (!sch) throw new Error(`no schema ${name}`);
  return sch;
};
const eventMsg = (s, evt) => {
  const entry = Object.entries(s.components?.messages || {}).find(([, m]) => m['x-event-type'] === evt);
  if (!entry) throw new Error(`no event message ${evt}`);
  return entry[1];
};

const MUTATIONS = [
  // ── G — structure ───────────────────────────────────────────────────────────────────────────
  { id: 'M01 asyncapi pinned to an older minor', run: (s) => { s.asyncapi = '3.0.0'; }, expect: '[G01]' },
  { id: 'M02 the whole chat stream channel deleted', run: (s) => { delete s.channels.chatStream; }, expect: '[S01] channel "chatStream" is missing' },
  { id: 'M03 the accepted frame removed from the channel', run: (s) => { delete ch(s, 'chatStream').messages.accepted; }, expect: '[S01] chatStream message "accepted" is missing' },
  { id: 'M04 a receive operation points at a message of another channel', run: (s) => {
    const op = s.operations.receiveAnswerStream;
    op.messages = [{ $ref: '#/channels/reviewDecided/messages/event' }];
  }, expect: 'does not resolve to a message of the operation' },

  // ── S — SSE vs openapi.yaml / docs/08 §3.1 ──────────────────────────────────────────────────
  { id: 'M05 the frame name drift from the openapi const', run: (s) => {
    const m = resolveMsg(s, 'chatStream', 'accepted');
    m['x-event-name'] = 'accept'; m.name = 'accept';
  }, expect: '[S03] message accepted: x-event-name is "accept"' },
  { id: 'M06 a field added to the token payload (openapi drift)', run: (s) => {
    schema(s, 'SseTokenPayload').properties.delta2 = { type: 'string' };
  }, expect: '[S03] token: payload adds fields delta2' },
  { id: 'M07 a field dropped from the sources payload', run: (s) => {
    delete schema(s, 'SseSourcesPayload').properties.citations;
  }, expect: '[S03] sources: payload lacks openapi fields citations' },
  { id: 'M08 an invented stage value', run: (s) => {
    schema(s, 'SseStatusPayload').properties.stage.enum.push('DONE');
  }, expect: '[S03] status: stage enum differs' },
  { id: 'M09 sources moved after tokens in x-sse-sequence', run: (s) => {
    const seq = ch(s, 'chatStream')['x-sse-sequence'];
    ch(s, 'chatStream')['x-sse-sequence'] = [seq[0], seq[1], seq[3], seq[2], seq[4], seq[5]];
  }, expect: '[S02] x-sse-sequence puts "sources" after "token"' },
  { id: 'M10 terminal set loses the refusal frame', run: (s) => {
    ch(s, 'chatStream')['x-sse-rules']['terminal-exactly-one-of'] = ['answer', 'error'];
  }, expect: '[S02] x-sse-rules.terminal-exactly-one-of' },
  { id: 'M11 idle timeout contradicts docs/08 §3.1', run: (s) => {
    ch(s, 'chatStream')['x-sse-rules']['idle-timeout-ms'] = 5000;
  }, expect: '[S02] x-sse-rules.idle-timeout-ms' },
  { id: 'M12 the receive operation forgets the done frame', run: (s) => {
    s.operations.receiveAnswerStream.messages = s.operations.receiveAnswerStream.messages.filter((m) => !m.$ref.endsWith('/done'));
  }, expect: '[S01] receiveAnswerStream does not reference message "done"' },
  { id: 'M13 SendMessageRequest loses its required field', run: (s) => {
    const m = s.channels.chatStream.messages.sendMessage;
    const ref = m.$ref.split('/').pop();
    s.components.messages[ref].payload.required = [];
  }, expect: '[S04] SendMessageRequest required fields differ' },
  { id: 'M14 the request payload grows an unborn field', run: (s) => {
    const m = s.components.messages.SendMessageRequest;
    m.payload.properties.prompt = { type: 'string' };
  }, expect: '[S04] SendMessageRequest adds fields prompt' },

  // ── E — catalog, emitters, consumers, grounding ─────────────────────────────────────────────
  { id: 'M15 an internal event renamed (consumer silently disconnected)', run: (s) => {
    const m = eventMsg(s, 'review.decided');
    m['x-event-type'] = 'review.approved';
    const e = Object.entries(s.channels).find(([, c]) => c.address === 'app.event.review.decided')[1];
    e.address = 'app.event.review.approved';
  }, expect: '[E01] docs/08 §6 event `review.decided` is not declared' },
  { id: 'M16 a consumer added to content.published', run: (s) => {
    const op = Object.values(s.operations).find((o) => o['x-consumers'] && o.channel?.$ref === '#/channels/contentPublished' && o.action === 'receive');
    op['x-consumers'].push('marketing');
  }, expect: '[E02] content.published' },
  { id: 'M17 the emitter claimed by the wrong module', run: (s) => {
    const m = eventMsg(s, 'content.withdrawn');
    m['x-emitted-by'] = 'guardrails';
    const op = Object.values(s.operations).find((o) => o['x-emitted-by'] && o.channel?.$ref === '#/channels/contentWithdrawn' && o.action === 'send');
    op['x-emitted-by'] = 'guardrails';
  }, expect: '[E03] content.withdrawn' },
  { id: 'M18 an event fact with no storage', run: (s) => {
    schema(s, 'EvalCompletedPayload').properties.weather = { type: 'string' };
  }, expect: '[E05] eval.completed.weather' },
  { id: 'M19 a derived flag removed from a computed field', run: (s) => {
    delete schema(s, 'ContentPublishedPayload').properties.kbEpoch['x-derived'];
  }, expect: '[E05] content.published.kbEpoch' },
  { id: 'M20 a real column falsely marked derived', run: (s) => {
    schema(s, 'ContentPublishedPayload').properties.publishedAt['x-derived'] = true;
  }, expect: '[E05] content.published.publishedAt: marked x-derived' },
  { id: 'M21 x-table-ref names a table that does not exist', run: (s) => {
    eventMsg(s, 'eval.completed')['x-table-ref'] = ['eval_runs'];
  }, expect: '[E04] eval.completed: x-table-ref table `eval_runs`' },
  { id: 'M22 the envelope ref disappears from a payload', run: (s) => {
    const m = eventMsg(s, 'fatwa.request.opened');
    m.payload.allOf = m.payload.allOf.filter((x) => !(x.$ref || '').endsWith('/EventEnvelope'));
  }, expect: '[E07] fatwa.request.opened' },
  { id: 'M23 the type const disagrees with the event name', run: (s) => {
    const m = eventMsg(s, 'guardrail.blocked');
    const inline = m.payload.allOf.find((x) => !x.$ref);
    inline.properties.type.const = 'guardrail.block';
  }, expect: '[E07] guardrail.blocked' },
  { id: 'M24 an enum value outside the schema type', run: (s) => {
    schema(s, 'ReviewDecidedPayload').properties.decision.enum.push('CHANGES_REQUESTED');
  }, expect: '[E06] review.decided.decision' },
  { id: 'M25 customer question text smuggled into an internal event', run: (s) => {
    schema(s, 'FatwaRequestOpenedPayload').properties.questionAr = { type: 'string' };
  }, expect: '[P01] fatwa.request.opened.questionAr' },
  { id: 'M26 answer content smuggled into an internal event', run: (s) => {
    schema(s, 'ContentPublishedPayload').properties.answerMarkdown = { type: 'string' };
  }, expect: '[P01] content.published.answerMarkdown' },
  { id: 'M27 an SSE payload carrying a contact field', run: (s) => {
    schema(s, 'SseAnswerPayload').properties.contactEmail = { type: 'string' };
  }, expect: '[P02] answer' },
  { id: 'M28 the envelope loses its mandatory field', run: (s) => {
    schema(s, 'EventEnvelope').required = ['eventId', 'type', 'sourceModule'];
  }, expect: '[E08] EventEnvelope.required is missing "occurredAt"' },

  // ── negative controls ──────────────────────────────────────────────────────────────────────
  { id: 'N1 property order is not semantics', expectPass: true,
    run: (s) => {
      const p = schema(s, 'SseAnswerPayload').properties;
      const reordered = {};
      for (const k of Object.keys(p).reverse()) reordered[k] = p[k];
      s.components.schemas.SseAnswerPayload.properties = reordered;
    }, expect: null },
  { id: 'N2 an unknown x- extension is allowed', expectPass: true,
    run: (s) => { eventMsg(s, 'content.published')['x-note'] = 'free text'; }, expect: null },
  { id: 'N3 the description of the chat channel can change', expectPass: true,
    run: (s) => { ch(s, 'chatStream').description = 'updated copy'; }, expect: null },
];

function resolveMsg(s, chName, mName) {
  const ref = ch(s, chName).messages[mName].$ref;
  const name = ref.split('/').pop();
  const m = s.components.messages[name];
  if (!m) throw new Error(`no component message ${name}`);
  return m;
}

let failures = 0, broken = 0;
console.log('\nasyncapi-lint self-test — mutation detection\n' + '─'.repeat(86));

{
  const { code, out } = runLint(readSpec());
  if (code !== 0) {
    console.log('  ABORT BASELINE — the committed spec does not pass the linter:');
    console.log(out.split('\n').filter((l) => l.includes('ERROR')).map((l) => '        ' + l.trim()).join('\n'));
    console.log('─'.repeat(86) + '\n'); process.exit(1);
  }
  console.log('  ok      BASELINE — committed asyncapi.yaml passes (exit 0)');
}

for (const m of MUTATIONS) {
  const spec = readSpec();
  let applied = true;
  const before = JSON.stringify(spec);
  try { m.run(spec); } catch (e) { applied = false; broken++; console.log(`  BROKEN  ${m.id}\n          ${e.message}`); }
  if (applied && before === JSON.stringify(spec)) { applied = false; broken++; console.log(`  BROKEN  ${m.id}\n          mutation changed nothing — anchor drifted`); }
  if (applied) {
    const { code, out } = runLint(spec);
    const good = m.expectPass ? code === 0 : (code !== 0 && out.includes(m.expect));
    if (good) console.log(`  ok      ${m.id}${m.expectPass ? '  (negative control)' : ''}`);
    else {
      failures++;
      console.log(`  ${m.expectPass ? 'FALSE POSITIVE' : 'MISSED'}  ${m.id}`);
      console.log(m.expectPass ? '          a legitimate spec was flagged:' : `          expected: ${m.expect}`);
      console.log(`          exit code: ${code}`);
      const rep = out.split('\n').filter((l) => l.includes('ERROR')).slice(0, 3);
      console.log(rep.length ? '          reported:\n            ' + rep.map((l) => l.trim()).join('\n            ') : '          reported nothing');
    }
  }
}

console.log('─'.repeat(86));
console.log(`  ${MUTATIONS.length} mutations · ${MUTATIONS.length - failures - broken} detected · ${failures} MISSED · ${broken} BROKEN\n`);
process.exit(failures || broken ? 1 : 0);
