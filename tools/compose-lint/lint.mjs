#!/usr/bin/env node
/**
 * compose-lint — cross-spec validation of deploy/docker-compose.yml
 *
 * The compose file is the target-state local topology of docs/12 §2.2. Like every gate in this
 * repository it is validated against the authorities that give its values meaning:
 *
 *   docs/12-deployment-observability.md §2.2   the service set and the app/data plane split
 *   docs/02-repository-layout.md §3            `<pgvector.version>` — the pgvector image pin
 *   docs/adr/ADR-008-platform-versions.md      the Keycloak floor and the Redis/Postgres majors
 *   docs/03-data-model.md §8                   the cluster-encoding requirement (UTF8, else the
 *                                              Arabic FTS silently dies)
 *   .env.example                               every `${VAR}` used by compose is declared there
 *   specs/config/application*.yaml             the `${…}` placeholders the server container must
 *                                              satisfy — a required variable the container never
 *                                              receives is a container that fails to boot
 *
 * Exit 0 = pass, 1 = at least one ERROR.
 *
 * Usage: node tools/compose-lint/lint.mjs   [COMPOSE_FILE=…] [ENV_EXAMPLE=…] [CONFIG_DIR=…]
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const COMPOSE_PATH = process.env.COMPOSE_FILE || join(root, 'deploy', 'docker-compose.yml');
const ENV_EXAMPLE = process.env.ENV_EXAMPLE || join(root, '.env.example');
const CONFIG_DIR = process.env.CONFIG_DIR || join(root, 'specs', 'config');
const MAKEFILE_FILE = process.env.MAKEFILE_FILE || join(root, 'Makefile');
const ENV_SYNC_FILE = process.env.ENV_SYNC_FILE || join(root, 'tools', 'env-sync.sh');
const DOC02 = process.env.DOC02_FILE || join(root, 'docs', '02-repository-layout.md');
const DOC03 = process.env.DOC03_FILE || join(root, 'docs', '03-data-model.md');
const DOC12 = process.env.DOC12_FILE || join(root, 'docs', '12-deployment-observability.md');
const ADR008 = process.env.ADR008_FILE || join(root, 'docs', 'adr', 'ADR-008-platform-versions.md');

const errors = [], warns = [], ok = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);
const read = (p) => existsSync(p) ? readFileSync(p, 'utf8') : (err(`cannot read ${p}`), '');

const composeText = read(COMPOSE_PATH);
let compose;
try { compose = yaml.load(composeText); } catch (e) {
  console.log(`\ncompose-lint — FATAL\n  ${COMPOSE_PATH} is not valid YAML: ${e.message}\n`);
  process.exit(1);
}
const envExample = read(ENV_EXAMPLE);
const doc02 = read(DOC02), doc03 = read(DOC03), doc12 = read(DOC12), adr008 = read(ADR008);

const svc = (s) => compose.services?.[s] || null;
const envVars = (text) => [...new Set([...text.matchAll(/\$\{([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]))];

// ── authorities ────────────────────────────────────────────────────────────────────────────────
const PGVECTOR_VERSION = (doc02.match(/<pgvector\.version>([^<]+)</) || [])[1];
const KC_FLOOR = (adr008.match(/Keycloak\s*\|\s*\*\*≥ ([0-9.]+)\*\*/) || [])[1];
const REDIS_MAJOR = (adr008.match(/Redis\s*\|\s*\*\*(\d)\.x\*\*/) || [])[1];
const PG_MAJOR = (adr008.match(/PostgreSQL\s*\|\s*\*\*(\d+)\*\*/) || [])[1];
const UTF8_REQUIRED = /cluster encoding must be \*\*UTF8\*\*/.test(doc03);
const REQUIRED_SERVICES = ['postgres', 'redis', 'keycloak', 'minio', 'server', 'rag-assistant', 'frontoffice-web', 'backoffice-web', 'nginx'];
const ALLOWED_SERVICES = [...REQUIRED_SERVICES, 'minio-init'];
const APP_SERVICES = ['server', 'rag-assistant', 'frontoffice-web', 'backoffice-web', 'nginx'];

// config placeholders: required (no :default) vs optional
const cfgPlaceholders = { required: new Set(), optional: new Set() };
for (const f of ['application.yaml', 'application-dev.yaml', 'application-uat.yaml', 'application-prod.yaml']) {
  const t = read(join(CONFIG_DIR, f));
  if (!t) continue;
  // YAML comments must not count as configuration — the header of application.yaml explains the
  // env contract in prose ("Every credential is ${ENV_VAR}"), which is not a placeholder.
  const code = t.split('\n').map((l) => l.split('#')[0]).join('\n');
  for (const m of code.matchAll(/\$\{([A-Z_][A-Z0-9_]*)(:[^}]*)?\}/g)) {
    // ONPREM_* placeholders are prod-profile-only (ADR-002 exit profile); the dev compose never
    // enables on-prem inference, so they are excluded from the dev environment contract.
    if (m[1].startsWith('ONPREM_')) continue;
    (m[2] ? cfgPlaceholders.optional : cfgPlaceholders.required).add(m[1]);
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  G — services & profiles
// ══════════════════════════════════════════════════════════════════════════════════════════════
{
  if (compose.name !== 'albaraka-ai') err(`[G01] compose name is "${compose.name}", expected "albaraka-ai"`);
  const present = Object.keys(compose.services || {});
  for (const s of REQUIRED_SERVICES) if (!present.includes(s)) err(`[G02] service "${s}" from docs/12 §2.2 is missing`);
  for (const s of present) if (!ALLOWED_SERVICES.includes(s)) err(`[G02] service "${s}" is not in the documented topology — add it to docs/12 §2.2 or remove it`);
  for (const s of APP_SERVICES) {
    const c = svc(s);
    if (!c) continue;
    const profiles = c.profiles || [];
    if (JSON.stringify(profiles) !== JSON.stringify(['app'])) err(`[G03] ${s}: application-plane services must run under profiles: [app] (got ${JSON.stringify(profiles)}) — the data plane must stay usable in Phase 0`);
  }
  for (const s of ['postgres', 'redis', 'keycloak', 'minio', 'minio-init']) {
    const c = svc(s);
    if (c && c.profiles) err(`[G03] ${s}: infrastructure has a profiles key — the data plane must start without one`);
  }
  ok.push(`structure: ${present.length}/${REQUIRED_SERVICES.length} documented services, app plane behind the app profile`);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  I — image pins (derived from docs/02 §3 and ADR-008)
// ══════════════════════════════════════════════════════════════════════════════════════════════
{
  for (const [name, c] of Object.entries(compose.services || {})) {
    const img = c.image || '';
    // docs/12 §3: immutable tags. `:dev` is the documented local image line for locally built
    // application images; `latest`/`nightly`/`master` are floating everywhere.
    if (/:(latest|nightly|master)$/i.test(img)) err(`[I01] ${name}: image "${img}" is floating — docs/12 §3 requires immutable tags`);
    if (/:(latest|nightly|master)$/i.test(img) === false && !img.startsWith('albaraka-ai/') && /:dev$/.test(img)) {
      err(`[I01] ${name}: external image "${img}" must be version-pinned, not :dev`);
    }
  }
  const pg = svc('postgres')?.image || '';
  if (!pg.startsWith('pgvector/pgvector:')) err(`[I02] postgres image must be the pgvector/pgvector image, got "${pg}"`);
  else {
    if (!pg.includes(`-pg${PG_MAJOR}`)) err(`[I02] postgres image "${pg}" is not on PostgreSQL ${PG_MAJOR} as ADR-008 requires`);
    const v = (pg.match(/pgvector\/pgvector:([0-9.]+)-pg/) || [])[1];
    if (!v || v !== PGVECTOR_VERSION) err(`[I02] postgres image pins pgvector ${v}, docs/02 §3 pins ${PGVECTOR_VERSION}`);
  }
  const kc = svc('keycloak')?.image || '';
  const kcVer = (kc.match(/keycloak:([0-9.]+)$/) || [])[1];
  if (!kc.startsWith('quay.io/keycloak/keycloak:') || !kcVer) err(`[I03] keycloak image must be quay.io/keycloak/keycloak:<version>, got "${kc}"`);
  else if (kcVer && KC_FLOOR) {
    const [a, b, c] = kcVer.split('.').map(Number), [x, y, z] = KC_FLOOR.split('.').map(Number);
    if (a < x || (a === x && b < y) || (a === x && b === y && c < z)) err(`[I03] keycloak ${kcVer} is below the ADR-008 floor ${KC_FLOOR}`);
  }
  const red = svc('redis')?.image || '';
  if (!red.startsWith('redis:') || !red.match(new RegExp(`^redis:${REDIS_MAJOR}`))) err(`[I04] redis image must stay on the ADR-008 ${REDIS_MAJOR}.x line, got "${red}"`);
  for (const s of ['minio', 'minio-init']) {
    const img = svc(s)?.image || '';
    if (!/^quay\.io\/minio\/(minio|mc):RELEASE\./.test(img)) err(`[I05] ${s}: image must be a pinned MinIO RELEASE tag, got "${img}"`);
  }
  if (JSON.stringify(svc('minio')?.ports || []).length > 2) {
    err('[I07] minio must not publish host ports — every consumer (minio-init, server, rag-assistant) reaches it at http://minio:9000 over the compose network; a published port is the classic developer-host failure (port already in use by a local daemon or another stack) with zero functional benefit');
  }
  for (const s of ['server', 'rag-assistant', 'frontoffice-web', 'backoffice-web']) {
    const c = svc(s);
    if (!c) continue;
    if (c.image !== `albaraka-ai/${s}:dev`) err(`[I06] ${s}: image must be "albaraka-ai/${s}:dev", got "${c.image}"`);
    const df = c.build?.dockerfile || '';
    if (!/^deploy\/docker\/Dockerfile\./.test(df)) err(`[I06] ${s}: build.dockerfile must live under deploy/docker/, got "${df}" (Phase 1 targets)`);
    if (c.build?.context !== '..') err(`[I06] ${s}: build.context must be ".." (the monorepo root, so buildkit layering can cache)`);
  }
  ok.push(`images: pgvector ${PGVECTOR_VERSION}-pg${PG_MAJOR}, Keycloak ${kcVer ?? '—'} ≥ ${KC_FLOOR}, redis ${REDIS_MAJOR}.x, MinIO pinned, no floating tag`);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  P — postgres cluster: encoding, preload, health
// ══════════════════════════════════════════════════════════════════════════════════════════════
{
  const c = svc('postgres');
  if (c) {
    const initdb = String(c.environment?.POSTGRES_INITDB_ARGS || '');
    if (!UTF8_REQUIRED) err('[P01] docs/03 §8: the UTF8 requirement sentence is missing — the linter cannot derive the encoding rule');
    else if (!initdb.includes('--encoding=UTF8')) err('[P01] POSTGRES_INITDB_ARGS must force --encoding=UTF8 (docs/03 §8: on SQL_ASCII the Arabic FTS silently dies)');
    if (!initdb.includes('--locale=C.UTF-8')) err('[P01] POSTGRES_INITDB_ARGS should pin --locale=C.UTF-8 — a C locale cluster breaks collation-aware Arabic/French ordering');
    const cmd = JSON.stringify(c.command || []);
    if (!cmd.includes('shared_preload_libraries=vector')) err('[P02] postgres command must set shared_preload_libraries=vector — the pgvector image does not preload it, and HNSW fails at run time without it');
    if (c.environment?.POSTGRES_DB !== 'albaraka_ai') err('[P03] POSTGRES_DB must be albaraka_ai (application.yaml datasource default)');
    if (c.environment?.POSTGRES_USER !== 'albaraka') err('[P03] POSTGRES_USER must be albaraka (application.yaml ${DATABASE_USER:albaraka})');
    const health = JSON.stringify(c.healthcheck || {});
    if (!health.includes('pg_isready')) err('[P03] postgres needs a pg_isready healthcheck');
    const vols = JSON.stringify(c.volumes || []);
    if (!vols.includes('/docker-entrypoint-initdb.d')) err('[P03] postgres must mount deploy/postgres/init (the keycloak database is created there)');
    if (!vols.includes('/var/lib/postgresql/data')) err('[P03] postgres must use a named volume for data');
  }
  ok.push('postgres: UTF8 initdb, vector preloaded, albaraka_ai db, healthcheck, init scripts mounted');
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  K — keycloak: bootstrap env, realm import, wiring
// ══════════════════════════════════════════════════════════════════════════════════════════════
{
  const c = svc('keycloak');
  if (c) {
    const cvols = JSON.stringify(c.volumes || []);
    if (!cvols.includes('../specs/keycloak/albaraka-realm.json:/tmp/realm-template.json:ro')) {
      err('[K01] keycloak must mount ../specs/keycloak/albaraka-realm.json:/tmp/realm-template.json:ro — compose resolves relative paths against deploy/, so ./specs/… points at a directory and the sed import fails');
    }
    const env = JSON.stringify(c.environment || {});
    if (env.includes('KEYCLOAK_ADMIN')) err('[K01] KEYCLOAK_ADMIN / KEYCLOAK_ADMIN_PASSWORD are deprecated — use KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD');
    if (!env.includes('KC_BOOTSTRAP_ADMIN_USERNAME')) err('[K01] KC_BOOTSTRAP_ADMIN_USERNAME missing');
    const kcPw = String(c.environment?.KC_BOOTSTRAP_ADMIN_PASSWORD || '');
    if (!kcPw.startsWith('${')) err('[K01] KC_BOOTSTRAP_ADMIN_PASSWORD must come from the environment, not a literal');
    const entry = JSON.stringify(c.entrypoint || c.command || []);
    if (!entry.includes('--import-realm')) err('[K02] keycloak must start with --import-realm (specs/keycloak/README)');
    if (!entry.includes('realm-template.json')) err('[K02] the realm template must be mounted and substituted before import');
    if (!entry.includes('mkdir -p /opt/keycloak/data/import')) err('[K02] the entrypoint must mkdir -p /opt/keycloak/data/import before sed — the Keycloak 26 image does not ship that directory, so the redirect fails and the container crash-loops');
    for (const ph of ['FRONTOFFICE_URL', 'BACKOFFICE_URL', 'BANK_PUBLIC_URL', 'WIDGET_REDIRECT_URI']) {
      // in compose YAML the shell sees "$${VAR}" because "$$" escapes interpolation; the raw
      // file therefore contains '$$' + '{' + VAR + '}'
      if (!entry.includes('$$' + '{' + ph + '}')) err(`[K02] the entrypoint must substitute \$${ph} — Keycloak does not resolve redirectUris/webOrigins itself`);
      // the SEARCH pattern must be single-quoted: bash would otherwise expand ${VAR} and sed
      // would have nothing left to replace (the realm file holds the literal placeholder)
      if (!entry.includes("'s|$$" + '{' + ph + '}|')) err(`[K02] \$${ph} search pattern must be single-quoted ('s|\$\$${ph}|') — a double-quoted pattern is expanded by bash before sed sees it`);
      // the REPLACEMENT expands the container value, so the variable must be in `environment:` —
      // compose interpolation alone never re-injects into the container, and only the :-default
      // would ever be used
      if (!(ph in (c.environment || {}))) err(`[K02] \$${ph} must be in the keycloak environment — it is the replacement value the sed expands; compose-level .env values alone are ignored`);
    }
    if (!String(c.environment?.KC_HOSTNAME || '') && !String(c.environment?.KC_HOSTNAME_URL || '')) err('[K02] KC_HOSTNAME (or KC_HOSTNAME_URL) is required — it is the fifth realm placeholder, set on the container');
    const dbUrl = String(c.environment?.KC_DB_URL || '');
    if (!dbUrl.includes("postgres") || !dbUrl.includes("keycloak")) err("[K03] KC_DB_URL must point at the postgres service keycloak database (created by deploy/postgres/init)");
    if (String(c.environment?.KC_DB || '') !== 'postgres') err('[K03] KC_DB must be postgres');
    const health = JSON.stringify(c.healthcheck || {});
    if (!health.includes('openid-configuration')) err('[K04] keycloak healthcheck should probe /realms/albaraka/.well-known/openid-configuration');
    if (JSON.stringify(c.ports || []).includes('8080:8080') === false) err('[K05] keycloak publishes 8080:8080 — application.yaml default KEYCLOAK_URL=http://localhost:8080 and the token issuer depend on it');
    const deps = JSON.stringify(c.depends_on || {});
    if (!deps.includes('service_healthy')) err('[K04] keycloak must depend on postgres being healthy, not merely started');
  }
  ok.push('keycloak: KC_BOOTSTRAP_ADMIN_*, sed-substituted realm import, postgres-backed, healthcheck on the albaraka realm');
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  E — environment contract: .env.example, config placeholders, no literals
// ══════════════════════════════════════════════════════════════════════════════════════════════
{
  const declared = new Set([...envExample.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]));
  const usedInCompose = envVars(composeText);
  for (const v of usedInCompose) if (!declared.has(v)) err(`[E01] compose uses \${${v}} but ${'.env.example'} does not declare it`);
  if (!declared.size) err('[E01] .env.example declares no variables');

  // every variable compose demands with ${VAR:?} must ship a non-empty dev value in
  // .env.example — the KEYCLOAK_BRIDGE_CLIENT_SECRET regression: it is required in compose and
  // declared in .env.example, but an .env created earlier never gains it, so `make up` aborts
  // at interpolation before the first container starts
  const demanded = new Set([...composeText.matchAll(/\$\{([A-Z_][A-Z0-9_]*):\?/g)].map((m) => m[1]));
  const exampleVals = new Map([...envExample.matchAll(/^([A-Z_][A-Z0-9_]*)=(.*)$/gm)].map((m) => [m[1], m[2].trim()]));
  for (const v of demanded) {
    if (!exampleVals.has(v) || exampleVals.get(v) === '') {
      err('[E09] compose requires ${' + v + '} (${VAR:?}) but ' + '.env.example' + ' ships no non-empty dev value — a fresh `make up` aborts at interpolation');
    }
  }

  // `make up` must merge new/empty keys into an existing .env (additive sync, never a
  // blind overwrite): `cp -n` only helps the first run, so an older .env misses required
  // vars added later — this is exactly the regression E09 guards
  const makeText = read(MAKEFILE_FILE);
  if (!makeText.includes('tools/env-sync.sh')) err('[E10] Makefile `up` must invoke tools/env-sync.sh — it merges newly required keys into an existing .env without overwriting user values');
  if (makeText.includes('cp -n .env.example .env')) err('[E10] replace `cp -n .env.example .env` with tools/env-sync.sh — cp -n never updates an existing .env, so a stale .env misses new required vars and `make up` fails');

  // env-sync is the pre-flight guard: MinIO hard-requires a root password of ≥8 characters and
  // refuses to start with anything shorter (the container is then reported "unhealthy" while the
  // stack looks fine). Without this check a user hand-editing .env to MINIO_ROOT_PASSWORD=admin
  // gets an opaque health failure after compose has already started 10 containers.
  const envSync = read(ENV_SYNC_FILE);
  if (!envSync.includes('MINIO_ROOT_PASSWORD') || !envSync.includes('requires at least 8 characters')) {
    err('[E11] tools/env-sync.sh must reject MINIO_ROOT_PASSWORD shorter than 8 characters — MinIO refuses to start with a short root password and the container is reported "unhealthy" (the classic hand-edited .env trap)');
  }

  // `make clean` is the supported way to wipe state (down -v) WITHOUT the --env-file footgun:
  // a bare `docker compose -f deploy/docker-compose.yml down -v` resolves the project directory
  // to deploy/ and cannot see the repo-root .env, so interpolation aborts with "required
  // variable POSTGRES_PASSWORD is missing a value".
  if (!/^clean:.*\n\t\$\(COMPOSE\) down -v/m.test(makeText)) {
    err('[E12] Makefile must define `clean:` as `$(COMPOSE) down -v` — it is the only safe way to wipe volumes; a raw compose call without --env-file .env fails at interpolation (project directory resolves to deploy/)');
  }

  const srv = svc('server');
  const env = srv ? (srv.environment || {}) : {};
  const serverKeys = new Set(Object.keys(env));
  const SECRET_KEY = /PASSWORD|SECRET|KEY|TOKEN|CREDENTIAL/i;
  for (const v of [...cfgPlaceholders.required]) {
    // KEYCLOAK_URL feeds exactly two properties (issuer-uri / jwk-set-uri), and the compose
    // overrides both separately (browser-visible issuer, in-network JWK fetch), so it is
    // deliberately absent.
    if (v === 'KEYCLOAK_URL') {
      const hasPair = serverKeys.has('SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI')
        && serverKeys.has('SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_JWK_SET_URI');
      if (!hasPair) err('[E02] required \${KEYCLOAK_URL} is superseded by the explicit issuer-uri / jwk-set-uri pair — both must be present');
      continue;
    }
    if (!serverKeys.has(v)) err(`[E02] required config placeholder \${${v}} (specs/config) is not provided to the server container`);
    const val = String(env[v] ?? '');
    if (SECRET_KEY.test(v)) {
      const src = val.match(/^\$\{([A-Z_][A-Z0-9_]*)/)?.[1];
      if (!src || !declared.has(src)) err(`[E02] \${${v}} is secret-shaped and must come from a .env variable ("\${VAR}"), got "${val}"`);
    }
  }
  // every secret-looking value must come from the environment
  for (const [sname, c] of Object.entries(compose.services || {})) {
    for (const [key, val] of Object.entries(c.environment || {})) {
      if (/PASSWORD|SECRET|KEY|TOKEN|CREDENTIAL/i.test(key) && typeof val === 'string' && !val.startsWith('${')) {
        err(`[E04] ${sname}.${key}: a secret must be "\${VAR}" from .env, not a literal like "${val}"`);
      }
    }
  }
  // server wiring: profile, DB host, issuer/jwk split, mounts
  if (srv) {
    if (String(env.SPRING_PROFILES_ACTIVE) !== 'dev') err('[E05] server must run SPRING_PROFILES_ACTIVE=dev (application-dev.yaml is the compose contract)');
    if (!String(env.DATABASE_URL || '').includes('postgres:5432/albaraka_ai')) err('[E05] DATABASE_URL must point at postgres:5432/albaraka_ai');
    if (!String(env.DATABASE_PASSWORD || '').startsWith('${')) err('[E05] DATABASE_PASSWORD must come from the environment');
    const issuer = String(env.SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI || '');
    const jwk = String(env.SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_JWK_SET_URI || '');
    if (!issuer.includes(':8080/realms/albaraka')) err('[E05] issuer-uri must be the browser-visible Keycloak URL (localhost:8080) — the token issuer is what Spring validates');
    if (!jwk.includes('keycloak:8080/realms/albaraka/protocol/openid-connect/certs')) err('[E05] jwk-set-uri must be resolvable on the compose network (keycloak:8080)');
    const vols = JSON.stringify(srv.volumes || []);
    if (!vols.includes('../specs:/app/specs:ro')) err('[E05] server must mount ../specs:/app/specs:ro — Flyway seeds and the i18n spec files are filesystem paths in application.yaml');
    if (!vols.includes('/app/specs:ro')) err('[E05] server specs mount must be read-only');
    if (srv.depends_on?.postgres?.condition !== 'service_healthy') err('[E05] server must wait for postgres service_healthy (Flyway runs at boot)');
    const shealth = JSON.stringify(srv.healthcheck?.test || []);
    if (shealth.includes('/dev/tcp') && !shealth.includes('bash -c')) {
      err('[S01] server healthcheck must run through bash -c — eclipse-temurin:21-jre is Ubuntu, /bin/sh is dash, and /dev/tcp is a bash feature; under dash the check fails instantly and the container is marked unhealthy forever while the app runs fine');
    }
  }
  // ADR-009: internal RAG contract wiring
  if (srv) {
    for (const [k, v] of Object.entries(env)) {
      if (/^(GROQ_|GOOGLE_|ONPREM_)/.test(k)) {
        err(`[E08] server.${k}: provider credentials must NOT be handed to the Spring container — rag-assistant is the only egress (ADR-009). Move this variable to the rag-assistant service.`);
      }
    }

    if (!String(env.RAG_BASE_URL || '').includes('http://rag-assistant:8000')) err('[E06] server must set RAG_BASE_URL=http://rag-assistant:8000 (the only egress to providers is rag-assistant — ADR-009)');
    if (!String(env.RAG_SERVICE_TOKEN || '').startsWith('${')) err('[E06] RAG_SERVICE_TOKEN must come from .env, not a literal');
    if (String(env.RAG_CONTRACT || '') !== '1') err('[E06] RAG_CONTRACT must be 1 (docs/08 §8 contract negotiation)');
    if (srv.depends_on?.['rag-assistant']?.condition !== 'service_healthy') err('[E06] server must wait for rag-assistant service_healthy');
  }
  const rag = svc('rag-assistant');
  if (rag) {
    const renv = JSON.stringify(rag.environment || {});
    if (!renv.includes('RAG_SERVICE_TOKEN')) err('[E07] rag-assistant must receive RAG_SERVICE_TOKEN');
    if (!renv.includes('RAG_PROVIDER_MODE')) err('[E07] rag-assistant must declare RAG_PROVIDER_MODE (mock default)');
    if (!renv.includes('RAG_GROQ_API_KEY')) err('[E07] rag-assistant must receive RAG_GROQ_API_KEY (${GROQ_API_KEY:-} in dev — empty means mock)');
    if (!renv.includes('RAG_GOOGLE_API_KEY')) err('[E07] rag-assistant must receive RAG_GOOGLE_API_KEY (${GOOGLE_API_KEY:-} in dev — empty means mock)');
    const rhealth = JSON.stringify(rag.healthcheck || {});
    if (!rhealth.includes('/v1/rag/health')) err('[E07] rag-assistant needs a healthcheck on /v1/rag/health');
    if (!JSON.stringify(rag.ports || []).includes('8000:8000')) err('[E07] rag-assistant must publish 8000:8000 — CI and docs/12 probe http://localhost:8000/v1/rag/health from the host; without the mapping the probe always times out while the container is healthy');
    if (rag.depends_on?.postgres?.condition !== 'service_healthy') err('[E07] rag-assistant must wait for postgres service_healthy');
  }
  ok.push(`environment: ${usedInCompose.length} vars declared in .env.example, all required config placeholders provided, no literal secret`);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
//  R/redis + N/nginx edge
// ══════════════════════════════════════════════════════════════════════════════════════════════
{
  const r = svc('redis');
  if (r) {
    if (!JSON.stringify(r.command || []).includes('appendonly')) err('[R01] redis must run with --appendonly yes (cache + rate-limit state survives restarts)');
    if (!JSON.stringify(r.healthcheck?.test || []).includes('redis-cli') || !JSON.stringify(r.healthcheck?.test || []).includes('ping')) err('[R01] redis needs a redis-cli ping healthcheck');
    if (JSON.stringify(r.ports || []).length > 2) err('[R02] redis must not publish host ports — server/rag reach it at redis:6379 on the compose network, and a published 6379 is the classic developer-host failure (a local Redis daemon already holds the port)');
  }
  const n = svc('nginx');
  if (n) {
    const devEdge = (envExample.match(/BANK_PUBLIC_URL=http:\/\/localhost:(\d+)/) || [])[1];
    const ports = JSON.stringify(n.ports || []);
    if (devEdge && !ports.includes(`"${devEdge}:80"`)) err(`[N01] nginx must publish ${devEdge}:80 — the .env.example dev BANK_PUBLIC_URL (${devEdge}) is the widget origin`);
    if (!JSON.stringify(n.volumes || []).includes('./nginx/nginx.conf')) err('[N01] nginx must mount ./nginx/nginx.conf (deploy/nginx/ — Phase 1 target, frozen now)');
  }
  ok.push('redis: appendonly + healthcheck · nginx: edge port matches the .env.example dev origin');
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\ncompose-lint — deploy/docker-compose.yml\n' + '─'.repeat(86));
console.log(`  derived: pgvector ${PGVECTOR_VERSION} · keycloak ≥ ${KC_FLOOR} · redis ${REDIS_MAJOR}.x · pg ${PG_MAJOR} · required placeholders: ${[...cfgPlaceholders.required].join(', ') || '—'}`);
console.log('─'.repeat(86));
for (const o of ok) console.log('  ok    ' + o);
for (const w of warns) console.log('  WARN  ' + w);
for (const e of errors) console.log('  ERROR ' + e);
console.log('─'.repeat(86));
console.log(`  ${ok.length} groups checked · ${warns.length} warning(s) · ${errors.length} error(s)\n`);
process.exit(errors.length ? 1 : 0);
