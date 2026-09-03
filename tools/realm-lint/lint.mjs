#!/usr/bin/env node
/**
 * realm-lint — cross-spec validation of specs/keycloak/albaraka-realm.json
 *
 * The realm is configuration-as-code that a typo can turn into a privilege escalation. This linter
 * does not check the realm against itself: it checks it against the two other specifications that
 * give its values meaning —
 *
 *   specs/db/schema.sql   the `audience` and `classification` enums. A realm attribute naming a
 *                         value the database does not know is not a cosmetic drift: the retrieval
 *                         scope and the content gate both compare against those enums.
 *   docs/05 §3            the governance role table, whose right-hand column names the Keycloak
 *                         role for each governance role.
 *   docs/07 §2.1/§2.3     the client table and the MFA mandate.
 *
 * Exit 0 = pass, 1 = at least one ERROR.
 *
 * Usage: node tools/realm-lint/lint.mjs   [REALM=path/to/realm.json]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const REALM_PATH = process.env.REALM || join(root, 'specs', 'keycloak', 'albaraka-realm.json');
const SCHEMA = join(root, 'specs', 'db', 'schema.sql');
const DOC05 = join(root, 'docs', '05-sharia-governance.md');
const DOC07 = join(root, 'docs', '07-security-iam-compliance.md');

const errors = [], warns = [], ok = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

// ── read the enums out of the DDL rather than restating them ─────────────────────────────────────
function enumFromSchema(name) {
  if (!existsSync(SCHEMA)) { err(`cannot read ${SCHEMA}`); return []; }
  const sql = readFileSync(SCHEMA, 'utf8');
  const m = sql.match(new RegExp(`CREATE TYPE\\s+${name}\\s+AS\\s+ENUM\\s*\\(([^)]*)\\)`, 'i'));
  if (!m) { err(`schema.sql: no CREATE TYPE ${name} AS ENUM — the realm cannot be validated against it`); return []; }
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}
const AUDIENCE = enumFromSchema('audience');
const CLASSIFICATION = enumFromSchema('classification');
const rank = (list, v) => list.indexOf(v);

// ── read the governance → Keycloak role mapping out of docs/05 §3 ────────────────────────────────
function documentedRoles() {
  if (!existsSync(DOC05)) { err(`cannot read ${DOC05}`); return new Map(); }
  const md = readFileSync(DOC05, 'utf8');
  const section = md.slice(md.indexOf('## 3.'), md.indexOf('## 4.'));
  const map = new Map();
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const gov = (cells[1].match(/\*\*([A-Z_]+)\*\*/) || [])[1];
    const kc = [...cells[2].matchAll(/`([a-z][a-z0-9-]*)`/g)].map((x) => x[1]);
    if (gov && kc.length) map.set(gov, kc[0]);
  }
  return map;
}
const GOV_TO_KC = documentedRoles();

// ── MFA mandate from docs/07 §2.3 ────────────────────────────────────────────────────────────────
/**
 * Roles hardened beyond what docs/07 §2.3 mandates, with the reason. Recording the deviation here
 * turns a CI warning nobody reads into a decision somebody signed.
 */
const MFA_HARDENED_BEYOND_MANDATE = {
  analyst: 'Reads conversation-derived analytics; a compromised analyst account is a personal-data exposure even though the role cannot write.',
};

/**
 * Parse the mandate out of docs/07 §2.3. The bullet wraps across lines and mixes two lists
 * ("mandatory for X; strongly recommended for Y"), so: gather the bullet plus its continuation
 * lines, then keep only the segment before the semicolon.
 */
function mfaMandated() {
  if (!existsSync(DOC07)) { err(`cannot read ${DOC07}`); return new Set(); }
  const lines = readFileSync(DOC07, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^\*\s*\*\*MFA\*\*/.test(l));
  if (start < 0) { err('docs/07 §2.3: could not locate the MFA mandate bullet'); return new Set(); }
  let text = lines[start];
  for (let i = start + 1; i < lines.length; i++) {
    // a continuation line is indented and is not itself a bullet
    if (/^\s+\S/.test(lines[i]) && !/^\s*[*-]\s/.test(lines[i])) text += ' ' + lines[i].trim();
    else break;
  }
  const mandatory = text.slice(text.indexOf('mandatory for')).split(';')[0];
  const out = new Set();
  for (const tok of mandatory.match(/`([^`]+)`/g) || []) {
    const name = tok.replace(/`/g, '');
    if (name.endsWith('*')) {
      const prefix = name.slice(0, -1);
      for (const r of GOV_TO_KC.values()) if (r.startsWith(prefix)) out.add(r);
    } else if ([...GOV_TO_KC.values()].includes(name)) out.add(name);
    else err(`docs/07 §2.3 mandates MFA for "${name}", which is not a role in docs/05 §3`);
  }
  if (out.size === 0) err('docs/07 §2.3: parsed an empty MFA mandate');
  return out;
}
const MFA_REQUIRED = mfaMandated();

// ── load the realm ───────────────────────────────────────────────────────────────────────────────
let realm;
try {
  realm = JSON.parse(readFileSync(REALM_PATH, 'utf8'));
} catch (e) {
  console.log(`\nrealm-lint — FATAL\n  ${REALM_PATH} is not valid JSON: ${e.message}\n`);
  process.exit(1);
}

const client = (id) => (realm.clients || []).find((c) => c.clientId === id);
const role = (name) => (realm.roles?.realm || []).find((r) => r.name === name);
const group = (name) => (realm.groups || []).find((g) => g.name === name);
const attr = (o, k) => (o?.attributes?.[k] || [])[0];

// ── 1. realm hygiene ─────────────────────────────────────────────────────────────────────────────
{
  if (realm.realm !== 'albaraka') err(`realm name is "${realm.realm}", expected "albaraka"`);
  if (realm.enabled !== true) err('realm is disabled');
  for (const [k, want] of [
    ['registrationAllowed', false], ['resetPasswordAllowed', false], ['editUsernameAllowed', false],
    ['duplicateEmailsAllowed', false], ['rememberMe', false], ['adminPermissionsEnabled', false],
    ['bruteForceProtected', true], ['permanentLockout', true], ['revokeRefreshToken', true],
    ['internationalizationEnabled', true], ['eventsEnabled', true], ['adminEventsEnabled', true],
  ]) if (realm[k] !== want) err(`realm.${k} is ${realm[k]}, expected ${want}`);
  if (realm.failureFactor !== 10) err(`realm.failureFactor is ${realm.failureFactor}, expected 10 (docs/07 §2.3)`);
  if ((realm.refreshTokenMaxReuse ?? 99) > 1) err(`realm.refreshTokenMaxReuse is ${realm.refreshTokenMaxReuse} — reuse detection needs ≤1`);
  if (realm.accessTokenLifespan !== 300) err(`realm.accessTokenLifespan is ${realm.accessTokenLifespan}, expected 300`);
  if (realm.sslRequired !== 'external') err(`realm.sslRequired is "${realm.sslRequired}"`);
  for (const L of ['fr', 'ar', 'en']) if (!(realm.supportedLocales || []).includes(L)) err(`realm.supportedLocales is missing ${L}`);
  const csp = realm.browserSecurityHeaders?.contentSecurityPolicy || '';
  if (!csp.includes('frame-ancestors')) err('browserSecurityHeaders: no frame-ancestors directive');
  else if (/frame-ancestors[^;]*\*/.test(csp)) err('browserSecurityHeaders: frame-ancestors allows *');
  if (!/object-src\s+'none'/.test(csp)) err('browserSecurityHeaders: object-src is not \'none\'');
  if ((realm.enabledEventTypes || []).includes('TOKEN_EXCHANGE') === false) warn('TOKEN_EXCHANGE is not in enabledEventTypes — attempts would go unaudited');
  ok.push(`realm hygiene: brute-force lockout after ${realm.failureFactor}, refresh-token reuse detection, registration and password reset closed, CSP frame-ancestors pinned`);
}

// ── 2. clients against docs/07 §2.1 ──────────────────────────────────────────────────────────────
const CLIENT_SPEC = [
  { id: 'albaraka-assistant-web', publicClient: true, bearerOnly: false, standardFlow: true, serviceAccounts: false, pkce: 'S256', tokenLife: 300 },
  { id: 'albaraka-assistant-widget', publicClient: true, bearerOnly: false, standardFlow: true, serviceAccounts: false, pkce: 'S256', tokenLife: 300 },
  { id: 'albaraka-backoffice-web', publicClient: true, bearerOnly: false, standardFlow: true, serviceAccounts: false, pkce: 'S256', tokenLife: 600 },
  { id: 'albaraka-assistant-service', publicClient: false, bearerOnly: false, standardFlow: false, serviceAccounts: true, pkce: null, tokenLife: 900 },
  { id: 'albaraka-assistant-api', publicClient: false, bearerOnly: true, standardFlow: false, serviceAccounts: false, pkce: null, tokenLife: null },
];
{
  const ids = (realm.clients || []).map((c) => c.clientId);
  for (const s of CLIENT_SPEC) if (!ids.includes(s.id)) err(`client ${s.id} from docs/07 §2.1 is missing`);
  for (const id of ids) if (!CLIENT_SPEC.some((s) => s.id === id)) warn(`client ${id} is not in the docs/07 §2.1 table — add it there or remove it`);

  for (const s of CLIENT_SPEC) {
    const c = client(s.id);
    if (!c) continue;
    if (c.publicClient !== s.publicClient) err(`${s.id}: publicClient is ${c.publicClient}, expected ${s.publicClient}`);
    if (c.bearerOnly !== s.bearerOnly) err(`${s.id}: bearerOnly is ${c.bearerOnly}, expected ${s.bearerOnly}`);
    if (c.standardFlowEnabled !== s.standardFlow) err(`${s.id}: standardFlowEnabled is ${c.standardFlowEnabled}, expected ${s.standardFlow}`);
    if (c.serviceAccountsEnabled !== s.serviceAccounts) err(`${s.id}: serviceAccountsEnabled is ${c.serviceAccountsEnabled}, expected ${s.serviceAccounts}`);
    if (c.implicitFlowEnabled !== false) err(`${s.id}: implicit flow must stay disabled`);
    if (c.directAccessGrantsEnabled !== false) err(`${s.id}: direct access grants (password grant) must stay disabled`);
    if (c.enabled !== true) err(`${s.id}: client is disabled`);
    // no committed secret, ever
    if (typeof c.secret === 'string' && c.secret && !c.secret.startsWith('${')) err(`${s.id}: carries a literal client secret — secrets are provisioned from Vault at deploy time`);
    if (typeof c.secret === 'string' && c.secret.startsWith('${')) warn(`${s.id}: secret is a \${…} placeholder; confirm the deploy resolves it before import, Keycloak will not`);
    // PKCE
    const pkce = c.attributes?.['pkce.code.challenge.method'];
    if (s.pkce) {
      if (pkce !== s.pkce) err(`${s.id}: pkce.code.challenge.method is "${pkce}", expected "${s.pkce}"`);
    } else if (pkce) warn(`${s.id}: sets PKCE but the spec does not require it for this client type`);
    // token lifetime
    if (s.tokenLife !== null) {
      const life = Number(c.attributes?.['access.token.lifespan']);
      if (life !== s.tokenLife) err(`${s.id}: access.token.lifespan is ${life}, expected ${s.tokenLife}`);
    }
    // audience pinning, except on the resource server itself
    if (!s.bearerOnly) {
      const aud = (c.protocolMappers || []).filter((m) => m.protocolMapper === 'oidc-audience-mapper')
        .map((m) => m.config?.['included.client.audience']);
      if (!aud.includes('albaraka-assistant-api')) err(`${s.id}: no audience mapper pinning albaraka-assistant-api — Spring's \`audiences\` check would reject every token`);
    }
  }
  // the embedded widget must not accept a wildcard origin
  const w = client('albaraka-assistant-widget');
  if (w && (w.webOrigins || []).includes('+')) err('albaraka-assistant-widget: webOrigins "+" on a client embedded in a third-party page is a cross-origin exposure');
  if (w && (w.redirectUris || []).some((u) => u === '*' || u === '/*')) err('albaraka-assistant-widget: wildcard redirect URI');
  ok.push(`clients: ${CLIENT_SPEC.length} clients match docs/07 §2.1 (type, flows, PKCE S256, token lifetimes, audience pinning, no committed secret)`);
}

// ── 3. MFA on the backoffice is structural, not advisory ─────────────────────────────────────────
{
  const bo = client('albaraka-backoffice-web');
  const bindingId = bo?.authenticationFlowBindingOverrides?.browser;
  if (!bindingId) {
    err('albaraka-backoffice-web: no browser authentication-flow binding — MFA is not actually enforced');
  } else {
    const flow = (realm.authenticationFlows || []).find((f) => f.id === bindingId);
    if (!flow) err(`albaraka-backoffice-web: browser binding points at flow id ${bindingId}, which does not exist`);
    else {
      const mfaSub = (flow.authenticationExecutions || []).find((e) => e.authenticatorFlow && e.requirement === 'REQUIRED');
      if (!mfaSub) err(`flow "${flow.alias}": the MFA subflow is not REQUIRED — a user could log in without a second factor`);
      else {
        const sub = (realm.authenticationFlows || []).find((f) => f.alias === mfaSub.flowAlias);
        if (!sub) err(`flow "${flow.alias}": references subflow "${mfaSub.flowAlias}" which does not exist`);
        else {
          const execs = sub.authenticationExecutions || [];
          const kinds = execs.map((e) => e.authenticator);
          if (!kinds.includes('auth-otp-form') && !kinds.includes('webauthn-authenticator')) err(`subflow "${sub.alias}": offers neither TOTP nor WebAuthn`);
          for (const e of execs) {
            if (e.requirement === 'DISABLED') err(`subflow "${sub.alias}": execution ${e.authenticator} is DISABLED`);
            if (e.requirement === 'CONDITIONAL') err(`subflow "${sub.alias}": CONDITIONAL execution ${e.authenticator} is an escape hatch around mandatory MFA`);
          }
          if (!execs.some((e) => e.requirement === 'ALTERNATIVE')) warn(`subflow "${sub.alias}": no ALTERNATIVE execution — confirm the REQUIRED subflow can actually be satisfied`);
          ok.push(`MFA: backoffice browser flow "${flow.alias}" → REQUIRED subflow "${sub.alias}" (${kinds.join(' + ')}), no conditional escape`);
        }
      }
      // every flow id must be a valid UUID or Keycloak refuses the import
      for (const f of realm.authenticationFlows || []) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(f.id)) err(`flow "${f.alias}": id "${f.id}" is not a UUID — Keycloak will reject the import`);
      }
    }
  }
}

// ── 4. roles: membership, attributes and enum membership ─────────────────────────────────────────
{
  const defined = (realm.roles?.realm || []).map((r) => r.name);
  const documented = [...GOV_TO_KC.values()];
  if (documented.length !== 9) warn(`docs/05 §3 yielded ${documented.length} Keycloak roles, expected 9 — check the parser`);
  for (const r of documented) if (!defined.includes(r)) err(`role \`${r}\` from docs/05 §3 is not defined in the realm`);
  for (const r of defined) if (!documented.includes(r)) err(`role \`${r}\` is defined in the realm but absent from docs/05 §3 — governance and identity have drifted`);

  const hardened = [];
  for (const r of realm.roles?.realm || []) {
    const a = r.attributes || {};
    const aud = (a.audience || [])[0];
    const cls = (a.maxClassification || [])[0];
    const mfa = (a.mfaRequired || [])[0];
    if (!aud) err(`role ${r.name}: no \`audience\` attribute — retrieval scoping cannot be derived`);
    else if (!AUDIENCE.includes(aud)) err(`role ${r.name}: audience "${aud}" is not in schema.sql CREATE TYPE audience (${AUDIENCE.join('|')})`);
    if (!cls) err(`role ${r.name}: no \`maxClassification\` attribute`);
    else if (!CLASSIFICATION.includes(cls)) err(`role ${r.name}: maxClassification "${cls}" is not in schema.sql CREATE TYPE classification (${CLASSIFICATION.join('|')})`);
    if (mfa !== 'true' && mfa !== 'false') err(`role ${r.name}: mfaRequired must be the string "true" or "false", got ${JSON.stringify(mfa)}`);
    // scope containment: the classification a role may read must cover the audience it serves
    if (aud && cls && AUDIENCE.includes(aud) && CLASSIFICATION.includes(cls)) {
      const minCls = aud === 'PUBLIC' ? 'PUBLIC' : 'INTERNAL';   // AGENT and INTERNAL both need INTERNAL+
      if (rank(CLASSIFICATION, cls) < rank(CLASSIFICATION, minCls)) {
        err(`role ${r.name}: audience ${aud} requires maxClassification ≥ ${minCls}, got ${cls} — the role could not read the content it is scoped to serve`);
      }
    }
    // MFA mandate
    const must = MFA_REQUIRED.has(r.name);
    if (must && mfa !== 'true') err(`role ${r.name}: docs/07 §2.3 mandates MFA but mfaRequired is ${mfa}`);
    if (!must && mfa === 'true') {
      if (MFA_HARDENED_BEYOND_MANDATE[r.name]) hardened.push(`${r.name} (${MFA_HARDENED_BEYOND_MANDATE[r.name]})`);
      else err(`role ${r.name}: requires MFA although docs/07 §2.3 does not mandate it, and no justification is recorded in MFA_HARDENED_BEYOND_MANDATE — an unexplained deviation from the documented baseline is drift`);
    }
    if (!r.description || r.description.length < 20) warn(`role ${r.name}: description too short to serve as an audit trail`);
  }
  ok.push(`roles: ${defined.length} realm roles, 1:1 with docs/05 §3, all carrying audience/maxClassification inside the schema.sql enums`);
  ok.push(`MFA: mandated for ${[...MFA_REQUIRED].sort().join(', ')} (${MFA_REQUIRED.size} roles)`);
  if (hardened.length) ok.push(`MFA hardened beyond the mandate, with recorded justification: ${hardened.join('; ')}`);
}

// ── 5. groups ────────────────────────────────────────────────────────────────────────────────────
{
  const EXPECTED_GROUPS = ['direction-digitale', 'conformite', 'comite-charia', 'reseau-agences'];
  const names = (realm.groups || []).map((g) => g.name);
  for (const g of EXPECTED_GROUPS) if (!names.includes(g)) err(`group /${g} from docs/07 §2.2 is missing`);
  for (const g of names) if (!EXPECTED_GROUPS.includes(g)) warn(`group /${g} is not in the docs/07 §2.2 list`);

  const defined = (realm.roles?.realm || []).map((r) => r.name);
  for (const g of realm.groups || []) {
    if (g.path !== `/${g.name}`) err(`group ${g.name}: path "${g.path}" must be "/${g.name}"`);
    for (const r of g.realmRoles || []) if (!defined.includes(r)) err(`group ${g.name}: maps undefined role ${r}`);
    if (!(g.realmRoles || []).length) err(`group ${g.name}: maps no realm role — membership would grant nothing`);
    const aud = attr(g, 'audience'), cls = attr(g, 'maxClassification');
    if (!AUDIENCE.includes(aud)) err(`group ${g.name}: audience "${aud}" not in schema.sql enum (${AUDIENCE.join('|')})`);
    if (!CLASSIFICATION.includes(cls)) err(`group ${g.name}: maxClassification "${cls}" not in schema.sql enum (${CLASSIFICATION.join('|')})`);
    // a group obeys the same containment rule as a role
    if (AUDIENCE.includes(aud) && CLASSIFICATION.includes(cls)) {
      const minCls = aud === 'PUBLIC' ? 'PUBLIC' : 'INTERNAL';
      if (rank(CLASSIFICATION, cls) < rank(CLASSIFICATION, minCls)) {
        err(`group ${g.name}: audience ${aud} requires maxClassification ≥ ${minCls}, got ${cls}`);
      }
    }
    // Authority is max(role, group), so a group can only ever WIDEN its members. The privilege-creep
    // risk is therefore a group granting more than every role inside it already has: that would lift
    // the least-privileged member to the most-privileged one's ceiling.
    const memberCls = (g.realmRoles || []).map((r) => attr(role(r), 'maxClassification')).filter(Boolean);
    if (cls && memberCls.length) {
      const ceiling = memberCls.reduce((a, b) => (rank(CLASSIFICATION, b) > rank(CLASSIFICATION, a) ? b : a));
      if (rank(CLASSIFICATION, cls) > rank(CLASSIFICATION, ceiling)) {
        err(`group ${g.name}: maxClassification ${cls} exceeds every role it contains (highest is ${ceiling}) — membership would widen ${g.realmRoles.join(', ')} beyond what their roles grant`);
      }
    }
    if (cls && !memberCls.length) warn(`group ${g.name}: sets maxClassification but maps no role whose classification could be checked`);
  }
  ok.push(`groups: ${names.length} groups, paths consistent, every mapped role defined, no group widens its members beyond their own roles`);
}

// ── 6. default role and client scopes ────────────────────────────────────────────────────────────
{
  const dr = realm.defaultRole;
  if (!dr) err('no defaultRole block');
  else {
    const comp = dr.composites?.realm || [];
    if (comp.length !== 1 || comp[0] !== 'customer') err(`defaultRole composites must be exactly ["customer"], got ${JSON.stringify(comp)}`);
  }
  const custom = new Set((realm.clientScopes || []).map((s) => s.name));
  const BUILTIN = ['openid', 'profile', 'email', 'address', 'phone', 'roles', 'web-origins',
    'offline_access', 'microprofile-jwt', 'acr', 'basic', 'service_account', 'webauthn'];
  for (const c of realm.clients || []) {
    for (const s of [...(c.defaultClientScopes || []), ...(c.optionalClientScopes || [])]) {
      if (!custom.has(s) && !BUILTIN.includes(s)) err(`${c.clientId}: client scope "${s}" is neither built-in nor declared in realm.clientScopes`);
    }
    if (c.fullScopeAllowed === true && c.clientId !== 'albaraka-backoffice-web') {
      err(`${c.clientId}: fullScopeAllowed is true — every realm role would land in its tokens`);
    }
  }
  ok.push('defaultRole grants customer only; every referenced client scope is built-in or declared');
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\nrealm-lint — specs/keycloak/albaraka-realm.json\n' + '─'.repeat(86));
console.log(`  enums read from schema.sql: audience(${AUDIENCE.join('|')}) classification(${CLASSIFICATION.join('|')})`);
console.log(`  roles read from docs/05 §3: ${GOV_TO_KC.size}  ·  MFA mandate from docs/07 §2.3: ${MFA_REQUIRED.size}`);
console.log('─'.repeat(86));
for (const o of ok) console.log('  ok    ' + o);
for (const w of warns) console.log('  WARN  ' + w);
for (const e of errors) console.log('  ERROR ' + e);
console.log('─'.repeat(86));
console.log(`  ${ok.length} groups checked · ${warns.length} warning(s) · ${errors.length} error(s)\n`);
process.exit(errors.length ? 1 : 0);
