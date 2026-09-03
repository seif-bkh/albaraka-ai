#!/usr/bin/env node
/**
 * realm-lint mutation self-test
 *
 * Same discipline as the other two tools: every check must be seen to fail. Each mutation copies the
 * realm to a temp file, breaks one thing, and asserts the linter reports it.
 *
 * Several mutations reproduce bugs that were actually present in the first draft of the realm, which
 * is why they are worth pinning: `maxClassification: "AGENT"` (a value the `classification` enum in
 * schema.sql does not contain) and a flow `id` that was not a valid UUID.
 *
 * Usage: node tools/realm-lint/self-test.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const SRC = join(root, 'specs', 'keycloak', 'albaraka-realm.json');
const LINT = join(here, 'lint.mjs');

const load = () => JSON.parse(readFileSync(SRC, 'utf8'));

function runLint(realm) {
  const dir = mkdtempSync(join(tmpdir(), 'realm-lint-'));
  const file = join(dir, 'realm.json');
  writeFileSync(file, JSON.stringify(realm, null, 2), 'utf8');
  let r;
  try {
    const out = execFileSync(process.execPath, [LINT], {
      env: { ...process.env, REALM: file }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    r = { code: 0, out };
  } catch (e) {
    r = { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
  rmSync(dir, { recursive: true, force: true });
  return r;
}

const cl = (d, id) => {
  const c = (d.clients || []).find((x) => x.clientId === id);
  if (!c) throw new Error(`no client ${id}`);
  return c;
};
const rl = (d, name) => {
  const r = (d.roles?.realm || []).find((x) => x.name === name);
  if (!r) throw new Error(`no role ${name}`);
  return r;
};
const gr = (d, name) => {
  const g = (d.groups || []).find((x) => x.name === name);
  if (!g) throw new Error(`no group ${name}`);
  return g;
};
const flow = (d, alias) => {
  const f = (d.authenticationFlows || []).find((x) => x.alias === alias);
  if (!f) throw new Error(`no flow ${alias}`);
  return f;
};
const MFA_FLOW = 'backoffice browser — MFA required';
const MFA_SUB = 'backoffice mandatory second factor';

const MUTATIONS = [
  // ── realm hygiene ─────────────────────────────────────────────────────────────────────────────
  { id: 'M01 realm renamed', run: (d) => { d.realm = 'albaraka-dev'; }, expect: 'expected "albaraka"' },
  { id: 'M02 brute-force protection switched off', run: (d) => { d.bruteForceProtected = false; }, expect: 'realm.bruteForceProtected is false' },
  { id: 'M03 lockout threshold loosened to 3 failures', run: (d) => { d.failureFactor = 30; }, expect: 'failureFactor is 30, expected 10' },
  { id: 'M04 refresh-token reuse detection defeated', run: (d) => { d.refreshTokenMaxReuse = 5; }, expect: 'refreshTokenMaxReuse is 5' },
  { id: 'M05 self-service registration opened', run: (d) => { d.registrationAllowed = true; }, expect: 'realm.registrationAllowed is true' },
  { id: 'M06 password reset opened to anonymous callers', run: (d) => { d.resetPasswordAllowed = true; }, expect: 'realm.resetPasswordAllowed is true' },
  { id: 'M07 CSP frame-ancestors widened to *', run: (d) => { d.browserSecurityHeaders.contentSecurityPolicy = "frame-ancestors *; object-src 'none';"; }, expect: 'frame-ancestors allows *' },
  { id: 'M08 object-src no longer none', run: (d) => { d.browserSecurityHeaders.contentSecurityPolicy = "frame-ancestors 'self';"; }, expect: "object-src is not 'none'" },
  { id: 'M09 a supported locale dropped', run: (d) => { d.supportedLocales = ['fr', 'en']; }, expect: 'supportedLocales is missing ar' },

  // ── clients ───────────────────────────────────────────────────────────────────────────────────
  { id: 'M10 a documented client is deleted', run: (d) => { d.clients = d.clients.filter((c) => c.clientId !== 'albaraka-assistant-widget'); }, expect: 'client albaraka-assistant-widget from docs/07 §2.1 is missing' },
  { id: 'M11 PKCE downgraded to plain', run: (d) => { cl(d, 'albaraka-assistant-web').attributes['pkce.code.challenge.method'] = 'plain'; }, expect: 'expected "S256"' },
  { id: 'M12 PKCE attribute deleted on the backoffice', run: (d) => { delete cl(d, 'albaraka-backoffice-web').attributes['pkce.code.challenge.method']; }, expect: 'pkce.code.challenge.method is "undefined"' },
  { id: 'M13 implicit flow re-enabled', run: (d) => { cl(d, 'albaraka-assistant-web').implicitFlowEnabled = true; }, expect: 'implicit flow must stay disabled' },
  { id: 'M14 password grant re-enabled', run: (d) => { cl(d, 'albaraka-backoffice-web').directAccessGrantsEnabled = true; }, expect: 'direct access grants (password grant) must stay disabled' },
  { id: 'M15 a literal client secret committed', run: (d) => { cl(d, 'albaraka-assistant-service').secret = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'; }, expect: 'carries a literal client secret' },
  { id: 'M16 the audience mapper removed from a public client', run: (d) => { cl(d, 'albaraka-assistant-web').protocolMappers = []; }, expect: 'no audience mapper pinning albaraka-assistant-api' },
  { id: 'M17 the widget accepts any web origin', run: (d) => { cl(d, 'albaraka-assistant-widget').webOrigins = ['+']; }, expect: 'webOrigins "+" on a client embedded in a third-party page' },
  { id: 'M18 the widget gets a wildcard redirect URI', run: (d) => { cl(d, 'albaraka-assistant-widget').redirectUris = ['*']; }, expect: 'wildcard redirect URI' },
  { id: 'M19 backoffice token lifetime shortened below the documented 600 s', run: (d) => { cl(d, 'albaraka-backoffice-web').attributes['access.token.lifespan'] = '120'; }, expect: 'access.token.lifespan is 120, expected 600' },
  { id: 'M20 a public client turned confidential', run: (d) => { cl(d, 'albaraka-assistant-web').publicClient = false; }, expect: 'publicClient is false, expected true' },
  { id: 'M21 the resource server loses bearerOnly', run: (d) => { cl(d, 'albaraka-assistant-api').bearerOnly = false; }, expect: 'bearerOnly is false, expected true' },
  { id: 'M22 the widget granted full scope', run: (d) => { cl(d, 'albaraka-assistant-widget').fullScopeAllowed = true; }, expect: 'fullScopeAllowed is true' },
  { id: 'M23 an undeclared client scope referenced', run: (d) => { cl(d, 'albaraka-assistant-web').defaultClientScopes.push('internal-super-scope'); }, expect: 'neither built-in nor declared' },

  // ── MFA enforcement ───────────────────────────────────────────────────────────────────────────
  { id: 'M24 the MFA flow binding removed from the backoffice', run: (d) => { delete cl(d, 'albaraka-backoffice-web').authenticationFlowBindingOverrides; }, expect: 'MFA is not actually enforced' },
  { id: 'M25 the binding points at a flow that does not exist', run: (d) => { cl(d, 'albaraka-backoffice-web').authenticationFlowBindingOverrides.browser = '9c3f1f2a-6d1e-4b7a-9c05-a1ba4a1a0099'; }, expect: 'which does not exist' },
  { id: 'M26 the MFA subflow downgraded from REQUIRED to ALTERNATIVE', run: (d) => { flow(d, MFA_FLOW).authenticationExecutions.find((e) => e.authenticatorFlow).requirement = 'ALTERNATIVE'; }, expect: 'the MFA subflow is not REQUIRED' },
  { id: 'M27 a CONDITIONAL escape hatch added inside the MFA subflow', run: (d) => { flow(d, MFA_SUB).authenticationExecutions.push({ authenticator: 'conditional-user-configured', requirement: 'CONDITIONAL', priority: 5, authenticatorFlow: false, userSetupAllowed: false }); }, expect: 'CONDITIONAL execution' },
  { id: 'M28 TOTP disabled inside the MFA subflow', run: (d) => { flow(d, MFA_SUB).authenticationExecutions.find((e) => e.authenticator === 'auth-otp-form').requirement = 'DISABLED'; }, expect: 'is DISABLED' },
  { id: 'M29 a flow id that is not a UUID (the draft bug)', run: (d) => { flow(d, MFA_SUB).id = '9c3f1f2a-6d1e-4b7a-9c05-albarakamfa2'; }, expect: 'is not a UUID — Keycloak will reject the import' },

  // ── roles, enums and containment ──────────────────────────────────────────────────────────────
  { id: 'M30 a governance role renamed (identity drifts from docs/05)', run: (d) => { rl(d, 'sharia-officer').name = 'sharia-reviewer'; }, expect: 'absent from docs/05 §3' },
  { id: 'M31 a governance role deleted', run: (d) => { d.roles.realm = d.roles.realm.filter((r) => r.name !== 'analyst'); }, expect: 'role `analyst` from docs/05 §3 is not defined' },
  { id: 'M32 maxClassification set to AGENT — not a value of the classification enum (the draft bug)', run: (d) => { rl(d, 'branch-agent').attributes.maxClassification = ['AGENT']; }, expect: 'not in schema.sql CREATE TYPE classification' },
  { id: 'M33 audience set to a value the schema does not know', run: (d) => { rl(d, 'customer').attributes.audience = ['CUSTOMERS']; }, expect: 'not in schema.sql CREATE TYPE audience' },
  { id: 'M34 the audience attribute removed entirely', run: (d) => { delete rl(d, 'branch-agent').attributes.audience; }, expect: 'no `audience` attribute' },
  { id: 'M35 mfaRequired written as a boolean instead of a string', run: (d) => { rl(d, 'compliance').attributes.mfaRequired = [true]; }, expect: 'must be the string "true" or "false"' },
  { id: 'M36 MFA dropped from a mandated role', run: (d) => { rl(d, 'sharia-officer').attributes.mfaRequired = ['false']; }, expect: 'docs/07 §2.3 mandates MFA but mfaRequired is false' },
  { id: 'M37 MFA dropped from ai-engineer (the wrapped-line parsing bug)', run: (d) => { rl(d, 'ai-engineer').attributes.mfaRequired = ['false']; }, expect: 'mandates MFA but mfaRequired is false' },
  { id: 'M38 an AGENT-audience role restricted to PUBLIC classification', run: (d) => { rl(d, 'branch-agent').attributes.maxClassification = ['PUBLIC']; }, expect: 'requires maxClassification ≥ INTERNAL' },
  { id: 'M39 MFA added to a role with no recorded justification', run: (d) => { rl(d, 'kb-editor').attributes.mfaRequired = ['true']; }, expect: 'no justification is recorded in MFA_HARDENED_BEYOND_MANDATE' },

  // ── groups and default role ───────────────────────────────────────────────────────────────────
  { id: 'M40 a documented group deleted', run: (d) => { d.groups = d.groups.filter((g) => g.name !== 'comite-charia'); }, expect: 'group /comite-charia from docs/07 §2.2 is missing' },
  { id: 'M41 a group maps a role that does not exist', run: (d) => { gr(d, 'conformite').realmRoles.push('risk-officer'); }, expect: 'maps undefined role risk-officer' },
  { id: 'M42 a group maps no role at all', run: (d) => { gr(d, 'reseau-agences').realmRoles = []; }, expect: 'maps no realm role' },
  { id: 'M43 a group widened above every role it contains', run: (d) => { gr(d, 'direction-digitale').attributes.maxClassification = ['RESTRICTED']; }, expect: 'exceeds every role it contains' },
  // Negative control: /conformite membership already GRANTS sharia-auditor (RESTRICTED), so a group
  // attribute at RESTRICTED widens nobody — max(role, group) is unchanged for every member.
  { id: 'N1 a mixed group set to its members\' own ceiling', expectPass: true,
    run: (d) => { gr(d, 'conformite').attributes.maxClassification = ['RESTRICTED']; }, expect: null },
  { id: 'M44 a group path that does not match its name', run: (d) => { gr(d, 'conformite').path = '/compliance'; }, expect: 'must be "/conformite"' },
  { id: 'M45 a group given a classification outside the enum', run: (d) => { gr(d, 'direction-digitale').attributes.maxClassification = ['SECRET']; }, expect: 'not in schema.sql enum' },
  { id: 'M46 defaultRole silently grants platform-admin to everyone', run: (d) => { d.defaultRole.composites.realm.push('platform-admin'); }, expect: 'must be exactly ["customer"]' },
];

let failures = 0, broken = 0;
console.log('\nrealm-lint self-test — mutation detection\n' + '─'.repeat(86));

{
  const { code, out } = runLint(load());
  if (code !== 0) {
    console.log('  ABORT BASELINE — the committed realm does not pass the linter:');
    console.log(out.split('\n').filter((l) => l.includes('ERROR')).map((l) => '        ' + l.trim()).join('\n'));
    console.log('─'.repeat(86) + '\n'); process.exit(1);
  }
  console.log('  ok      BASELINE — committed realm passes (exit 0)');
}

for (const m of MUTATIONS) {
  const d = load();
  let applied = true;
  const before = JSON.stringify(d);
  try { m.run(d); } catch (e) { applied = false; broken++; console.log(`  BROKEN  ${m.id}\n          ${e.message}`); }
  if (applied && before === JSON.stringify(d)) { applied = false; broken++; console.log(`  BROKEN  ${m.id}\n          mutation changed nothing — anchor drifted`); }
  if (applied) {
    const { code, out } = runLint(d);
    const good = m.expectPass ? code === 0 : (code !== 0 && out.includes(m.expect));
    if (good) console.log(`  ok      ${m.id}${m.expectPass ? '  (negative control)' : ''}`);
    else {
      failures++;
      console.log(`  ${m.expectPass ? 'FALSE POSITIVE' : 'MISSED'}  ${m.id}`);
      console.log(m.expectPass ? '          a legitimate realm was flagged:' : `          expected: ${m.expect}`);
      console.log(`          exit code: ${code}`);
      const rep = out.split('\n').filter((l) => l.includes('ERROR')).slice(0, 3);
      console.log(rep.length ? '          reported:\n            ' + rep.map((l) => l.trim()).join('\n            ') : '          reported nothing');
    }
  }
}

console.log('─'.repeat(86));
console.log(`  ${MUTATIONS.length} mutations · ${MUTATIONS.length - failures - broken} detected · ${failures} MISSED · ${broken} BROKEN\n`);
process.exit(failures || broken ? 1 : 0);
