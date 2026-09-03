#!/usr/bin/env node
/**
 * compose-lint mutation self-test
 *
 * Every gate in this repository proves it can fail. These mutations break one thing at a time in a
 * throwaway copy of deploy/docker-compose.yml (and, for two of them, of an authority document) and
 * assert the expected check id appears. They reproduce the failures this file exists to prevent: a
 * cluster initialised LATIN1, a pgvector image that drifted from docs/02 §3, a Keycloak below the
 * ADR-008 floor, the deprecated KEYCLOAK_ADMIN pair, an environment variable the server needs but
 * .env does not declare.
 *
 * Usage: node tools/compose-lint/self-test.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const SRC = join(root, 'deploy', 'docker-compose.yml');
const LINT = join(here, 'lint.mjs');
const DOC02 = join(root, 'docs', '02-repository-layout.md');
const ADR008 = join(root, 'docs', 'adr', 'ADR-008-platform-versions.md');

const readCompose = () => yaml.load(readFileSync(SRC, 'utf8'));

function runLint(compose, { doc02, adr008 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'compose-lint-'));
  const env = { ...process.env, COMPOSE_FILE: join(dir, 'docker-compose.yml') };
  writeFileSync(env.COMPOSE_FILE, yaml.dump(compose, { lineWidth: 120 }), 'utf8');
  if (doc02) { env.DOC02_FILE = join(dir, 'doc02.md'); writeFileSync(env.DOC02_FILE, doc02, 'utf8'); }
  if (adr008) { env.ADR008_FILE = join(dir, 'adr.md'); writeFileSync(env.ADR008_FILE, adr008, 'utf8'); }
  let r;
  try {
    const out = execFileSync(process.execPath, [LINT], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    r = { code: 0, out };
  } catch (e) {
    r = { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
  rmSync(dir, { recursive: true, force: true });
  return r;
}

const svc = (c, n) => { const s = c.services?.[n]; if (!s) throw new Error(`no service ${n}`); return s; };

// authorities, mutated once each
const doc02Src = () => readFileSync(DOC02, 'utf8');
const adr008Src = () => readFileSync(ADR008, 'utf8');

const MUTATIONS = [
  // ── G — services & profiles ─────────────────────────────────────────────────────────────────
  { id: 'M01 postgres removed from the topology', run: (c) => { delete c.services.postgres; }, expect: '[G02] service "postgres"' },
  { id: 'M02 an undocumented service added', run: (c) => { c.services.notifications = { image: 'redis:7.4-alpine' }; }, expect: '[G02] service "notifications"' },
  { id: 'M03 the data plane pushed behind the app profile', run: (c) => { svc(c, 'postgres').profiles = ['app']; }, expect: '[G03] postgres: infrastructure has a profiles key' },
  { id: 'M04 the server escapes the app profile', run: (c) => { delete svc(c, 'server').profiles; }, expect: '[G03] server: application-plane services must run under profiles' },

  // ── I — image pins ──────────────────────────────────────────────────────────────────────────
  { id: 'M05 the pgvector image loses its version pin', run: (c) => { svc(c, 'postgres').image = 'pgvector/pgvector:pg17'; }, expect: '[I02]' },
  { id: 'M06 pgvector drifted from docs/02 §3', run: (c) => { svc(c, 'postgres').image = 'pgvector/pgvector:0.9.0-pg17'; }, expect: '[I02] postgres image pins pgvector 0.9.0' },
  { id: 'M07 Keycloak below the ADR-008 floor', run: (c) => { svc(c, 'keycloak').image = 'quay.io/keycloak/keycloak:26.5.1'; }, expect: '[I03] keycloak 26.5.1 is below' },
  { id: 'M08 redis jumped majors', run: (c) => { svc(c, 'redis').image = 'redis:8-alpine'; }, expect: '[I04] redis image must stay' },
  { id: 'M09 MinIO floats on latest', run: (c) => { svc(c, 'minio').image = 'minio/minio:latest'; }, expect: '[I05] minio' },
  { id: 'M10 the server image drifts from its dev line', run: (c) => { svc(c, 'server').image = 'albaraka-ai/server:latest'; }, expect: '[I01] server: image "albaraka-ai/server:latest" is floating' },
  { id: 'M11 the server build context moves', run: (c) => { svc(c, 'server').build = { context: './deploy', dockerfile: 'Dockerfile.server' }; }, expect: '[I06] server: build.context must be ".."' },

  // ── P — postgres ────────────────────────────────────────────────────────────────────────────
  { id: 'M12 the cluster is initialised LATIN1 (the Arabic-FTS killer)', run: (c) => { svc(c, 'postgres').environment.POSTGRES_INITDB_ARGS = '--encoding=LATIN1 --locale=C.UTF-8'; }, expect: '[P01] POSTGRES_INITDB_ARGS must force --encoding=UTF8' },
  { id: 'M13 shared_preload_libraries dropped', run: (c) => { svc(c, 'postgres').command = ['postgres']; }, expect: '[P02] postgres command must set shared_preload_libraries=vector' },
  { id: 'M14 the healthcheck removed', run: (c) => { delete svc(c, 'postgres').healthcheck; }, expect: '[P03] postgres needs a pg_isready healthcheck' },

  // ── K — keycloak ────────────────────────────────────────────────────────────────────────────
  { id: 'M15 the deprecated KEYCLOAK_ADMIN pair comes back', run: (c) => {
    const e = svc(c, 'keycloak').environment;
    e.KEYCLOAK_ADMIN = e.KC_BOOTSTRAP_ADMIN_USERNAME;
    e.KEYCLOAK_ADMIN_PASSWORD = e.KC_BOOTSTRAP_ADMIN_PASSWORD;
    delete e.KC_BOOTSTRAP_ADMIN_USERNAME; delete e.KC_BOOTSTRAP_ADMIN_PASSWORD;
  }, expect: '[K01] KEYCLOAK_ADMIN' },
  { id: 'M16 the realm import flag removed', run: (c) => {
    svc(c, 'keycloak').entrypoint = ['/bin/bash', '-ec', 'echo no import'];
  }, expect: '[K02] keycloak must start with --import-realm' },
  { id: 'M17 the fifth placeholder (KC_HOSTNAME) dropped', run: (c) => { delete svc(c, 'keycloak').environment.KC_HOSTNAME; }, expect: '[K02] KC_HOSTNAME' },
  { id: 'M18 keycloak pointed at its own database', run: (c) => { svc(c, 'keycloak').environment.KC_DB_URL = 'jdbc:postgresql://postgres:5432/albaraka_ai'; }, expect: '[K03] KC_DB_URL must point at the postgres service keycloak database' },

  // ── E — environment contract ────────────────────────────────────────────────────────────────
  { id: 'M19 a provider key is handed to the server (ADR-009)', run: (c) => { svc(c, 'server').environment.GROQ_API_KEY = '${GROQ_API_KEY:-}'; }, expect: '[E08] server.GROQ_API_KEY' },
  { id: 'M19b the rag service loses its provider key wiring', run: (c) => { delete svc(c, 'rag-assistant').environment.RAG_GROQ_API_KEY; }, expect: '[E07] rag-assistant must receive RAG_GROQ_API_KEY' },
  { id: 'M-import-dir keycloak does not create the import directory',
    run: (c) => { svc(c, 'keycloak').entrypoint[2] = svc(c, 'keycloak').entrypoint[2].replace('mkdir -p /opt/keycloak/data/import\n', ''); },
    expect: '[K02] the entrypoint must mkdir' },
  { id: 'M-realm-mount the realm template resolves inside deploy/ (directory mount)',
    run: (c) => { svc(c, 'keycloak').volumes = ['- ./specs/keycloak/albaraka-realm.json:/tmp/realm-template.json:ro']; },
    expect: '[K01] keycloak must mount' },
  { id: 'M20 a literal storage secret committed in the compose file', run: (c) => { svc(c, 'server').environment.STORAGE_SECRET_KEY = 'hunter2'; }, expect: '[E02] ${STORAGE_SECRET_KEY} is secret-shaped' },
  { id: 'M21 a variable from nowhere', run: (c) => { svc(c, 'server').environment.SPRING_DATASOURCE_HIKARI_POOL_SIZE = '${UNDECLARED_VAR}'; }, expect: '[E01] compose uses ${UNDECLARED_VAR}' },
  { id: 'M22 the issuer/jwk split collapses', run: (c) => {
    const e = svc(c, 'server').environment;
    delete e.SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_ISSUER_URI;
    delete e.SPRING_SECURITY_OAUTH2_RESOURCESERVER_JWT_JWK_SET_URI;
  }, expect: '[E02] required ${KEYCLOAK_URL} is superseded' },
  { id: 'M23 the server boots without the dev profile', run: (c) => { svc(c, 'server').environment.SPRING_PROFILES_ACTIVE = 'prod'; }, expect: '[E05] server must run SPRING_PROFILES_ACTIVE=dev' },
  { id: 'M24 the specs mount becomes read-write', run: (c) => {
    svc(c, 'server').volumes = svc(c, 'server').volumes.map((v) => v.replace(':ro', ''));
  }, expect: '[E05] server specs mount must be read-only' },

  // ── R / N ───────────────────────────────────────────────────────────────────────────────────
  { id: 'M25 redis loses appendonly', run: (c) => { svc(c, 'redis').command = ['redis-server']; }, expect: '[R01] redis must run with --appendonly yes' },
  { id: 'M26 the nginx edge port leaves the documented dev origin', run: (c) => { svc(c, 'nginx').ports = ['8083:80']; }, expect: '[N01] nginx must publish 8082:80' },

  // ── authority-drift mutations: the same linter must follow the documents ─────────────────────
  { id: 'M27 docs/02 bumps pgvector to 0.9.0', run: () => {}, expect: '[I02]', file: 'doc02',
    prepare: () => doc02Src().replace('<pgvector.version>0.8.1</pgvector.version>', '<pgvector.version>0.9.0</pgvector.version>') },
  { id: 'M28 ADR-008 raises the Keycloak floor to 26.7.0', run: () => {}, expect: '[I03] keycloak 26.6.3 is below the ADR-008 floor', file: 'adr008',
    prepare: () => adr008Src().replace('Keycloak | **≥ 26.6.3**', 'Keycloak | **≥ 26.7.0**') },

  { id: 'M29 the FRONTOFFICE_URL sed pattern gets double-quoted (bash expands it → nothing left to replace)', run: (c) => {
    const e = svc(c, 'keycloak').entrypoint;
    e[e.length - 1] = e[e.length - 1].replace("'s|$${FRONTOFFICE_URL}|'", '"s|$${FRONTOFFICE_URL}|"');
  }, expect: '[K02] $FRONTOFFICE_URL search pattern must be single-quoted' },
  { id: 'M30 a realm placeholder never reaches the keycloak container', run: (c) => { delete svc(c, 'keycloak').environment.FRONTOFFICE_URL; }, expect: '[K02] $FRONTOFFICE_URL must be in the keycloak environment' },

  // ── negative controls ───────────────────────────────────────────────────────────────────────
  { id: 'N1 a label is not a contract change', expectPass: true, run: (c) => { svc(c, 'redis').labels = { 'dev.notes': 'local cache' }; }, expect: null },
  { id: 'N2 a restart policy change is not checked', expectPass: true, run: (c) => { svc(c, 'minio-init').restart = 'unless-stopped'; }, expect: null },
  { id: 'N3 an extra tmpfs volume on postgres stays allowed', expectPass: true, run: (c) => { svc(c, 'postgres').volumes.push('pgstats:/var/lib/postgresql/pgstats'); }, expect: null },
];

let failures = 0, broken = 0;
console.log('\ncompose-lint self-test — mutation detection\n' + '─'.repeat(86));

{
  const { code, out } = runLint(readCompose());
  if (code !== 0) {
    console.log('  ABORT BASELINE — the committed compose file does not pass the linter:');
    console.log(out.split('\n').filter((l) => l.includes('ERROR')).map((l) => '        ' + l.trim()).join('\n'));
    console.log('─'.repeat(86) + '\n'); process.exit(1);
  }
  console.log('  ok      BASELINE — committed docker-compose.yml passes (exit 0)');
}

for (const m of MUTATIONS) {
  const compose = readCompose();
  const doc02 = m.file === 'doc02' ? m.prepare() : undefined;
  const adr008 = m.file === 'adr008' ? m.prepare() : undefined;
  let applied = true;
  const before = JSON.stringify(compose);
  try { if (m.run) m.run(compose); } catch (e) { applied = false; broken++; console.log(`  BROKEN  ${m.id}\n          ${e.message}`); }
  if (m.file && !m.prepare) { applied = false; broken++; console.log(`  BROKEN  ${m.id}\n          authority mutation has no preparation`); }
  if (applied && !m.file && before === JSON.stringify(compose)) { applied = false; broken++; console.log(`  BROKEN  ${m.id}\n          mutation changed nothing — anchor drifted`); }
  if (applied) {
    const { code, out } = runLint(compose, { doc02, adr008 });
    const good = m.expectPass ? code === 0 : (code !== 0 && out.includes(m.expect));
    if (good) console.log(`  ok      ${m.id}${m.expectPass ? '  (negative control)' : ''}`);
    else {
      failures++;
      console.log(`  ${m.expectPass ? 'FALSE POSITIVE' : 'MISSED'}  ${m.id}`);
      console.log(m.expectPass ? '          a legitimate compose file was flagged:' : `          expected: ${m.expect}`);
      console.log(`          exit code: ${code}`);
      const rep = out.split('\n').filter((l) => l.includes('ERROR')).slice(0, 3);
      console.log(rep.length ? '          reported:\n            ' + rep.map((l) => l.trim()).join('\n            ') : '          reported nothing');
    }
  }
}

console.log('─'.repeat(86));
console.log(`  ${MUTATIONS.length} mutations · ${MUTATIONS.length - failures - broken} detected · ${failures} MISSED · ${broken} BROKEN\n`);
process.exit(failures || broken ? 1 : 0);
