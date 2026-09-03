#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//  Al-Mouchir — schema verifier
//
//  Boots a throwaway PostgreSQL cluster (embedded-postgres), executes specs/db/schema.sql and
//  specs/db/tests/schema_test.sql statement by statement, and reports:
//    · every statement that fails to execute (syntax, FK ordering, constraint or trigger errors)
//    · the assertion notices emitted by the behavioural test suite (G1 gate, G2 audit, G3 two-eyes)
//    · an inventory of the created objects
//
//  Usage:
//    cd tools/db-verify && npm install && npm run verify
//    node verify-schema.mjs ../../specs/db/schema.sql ../../specs/db/tests/schema_test.sql
//
//  Exit code is non-zero if any statement fails, so this runs as a CI gate.
//
//  The throwaway database is created with ENCODING 'UTF8' from template0. This is not cosmetic: on a
//  SQL_ASCII cluster the default parser classifies every non-ASCII token as `blank`, so Arabic full-
//  text search indexes nothing and the G4 assertions would test the harness instead of the schema.
//
//  NOTE ON pgvector: the embedded distribution ships the standard contrib modules (pg_trgm,
//  unaccent, pgcrypto) but not pgvector, so `vector(1536)` / `halfvec(1536)` columns and the HNSW
//  index are stubbed with `real[]` for this run. Everything else — enums, tables, partitions,
//  generated columns, triggers, functions, views, constraints — is executed verbatim.
//  Run the unstubbed schema against the pgvector-enabled container (`make dev`) before release.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [path.resolve(here, '../../specs/db/schema.sql'),
     path.resolve(here, '../../specs/db/tests/schema_test.sql')];

const src = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n\n');

// ── stub the pgvector-only pieces ──────────────────────────────────────────────────────────────
let sql = src
  .replace(/CREATE EXTENSION IF NOT EXISTS vector;[^\n]*/, '-- (stubbed) CREATE EXTENSION vector;')
  .replace(/halfvec\(1536\)/g, 'real[]')
  .replace(/\bvector\(1536\)/g, 'real[]')
  .replace(/CREATE INDEX idx_chunk_emb_hnsw[\s\S]*?WITH \(m = 16, ef_construction = 128\);/,
           '-- (stubbed) CREATE INDEX idx_chunk_emb_hnsw ... USING hnsw (embedding_h halfvec_cosine_ops);');

// ── statement splitter: respects $$ dollar quoting, 'strings', -- and /* */ comments ───────────
function splitStatements(text) {
  const out = [];
  let buf = '', i = 0, quote = null, dollarTag = null;
  while (i < text.length) {
    const c = text[i], two = text.substr(i, 2);
    if (quote === "'") {
      buf += c;
      if (c === "'") { if (text[i + 1] === "'") { buf += text[++i]; } else quote = null; }
      i++; continue;
    }
    if (dollarTag) {
      if (text.startsWith(dollarTag, i)) { buf += dollarTag; i += dollarTag.length; dollarTag = null; }
      else { buf += c; i++; }
      continue;
    }
    if (two === '--') { const nl = text.indexOf('\n', i); const end = nl === -1 ? text.length : nl; buf += text.slice(i, end); i = end; continue; }
    if (two === '/*') { const e = text.indexOf('*/', i); const end = e === -1 ? text.length : e + 2; buf += text.slice(i, end); i = end; continue; }
    if (c === "'") { quote = "'"; buf += c; i++; continue; }
    const dm = text.slice(i).match(/^\$([A-Za-z_0-9]*)\$/);
    if (dm) { dollarTag = dm[0]; buf += dollarTag; i += dollarTag.length; continue; }
    if (c === ';') {
      buf += c;
      const t = buf.trim();
      if (t.replace(/(--[^\n]*)/g, '').trim().length) out.push(t);
      buf = ''; i++; continue;
    }
    buf += c; i++;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const dataDir = path.join(here, '.pgdata');
const pg = new EmbeddedPostgres({
  databaseDir: dataDir, user: 'postgres', password: 'postgres', port: 55432, persistent: false,
});
if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) await pg.initialise();
await pg.start();

const admin = pg.getPgClient('postgres');
await admin.connect();
await admin.query('DROP DATABASE IF EXISTS albaraka_verify');
// The cluster is initialised with locale C, which makes the default encoding SQL_ASCII. On SQL_ASCII
// the default text-search parser classifies every non-ASCII token as `blank`, Arabic included, so
// to_tsvector returns nothing for it and the FTS assertions pass vacuously — or fail for a reason
// that has nothing to do with the schema. Production is UTF8; so is this database.
await admin.query(
  `CREATE DATABASE albaraka_verify ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
await admin.end();

const db = pg.getPgClient('albaraka_verify');
await db.connect();
await db.query('SET client_min_messages TO NOTICE');
let assertions = 0, failures = 0;
db.on('notice', (n) => {
  if (/^PASS /.test(n.message)) { assertions++; console.log(`  ✔ ${n.message}`); }
  else if (/TEST FAILED/.test(n.message)) { failures++; console.log(`  ✘ ${n.message}`); }
  else if (/ALL SCHEMA GUARANTEE TESTS PASSED/.test(n.message)) console.log(`  ── ${n.message}`);
});

const statements = splitStatements(sql);
let ok = 0;
const errors = [];
for (const [idx, stmt] of statements.entries()) {
  const first = (stmt.split('\n').find((l) => l.trim() && !l.trim().startsWith('--')) || stmt).trim();
  try { await db.query(stmt); ok++; }
  catch (e) {
    errors.push({ n: idx + 1, stmt: first.slice(0, 120), message: e.message.split('\n')[0], detail: e.detail || '' });
  }
}

console.log(`\nfiles       : ${files.map((f) => path.basename(f)).join(' + ')}`);
console.log(`statements  : ${statements.length} executed · ${ok} succeeded · ${errors.length} failed`);
for (const e of errors) console.log(`\n✗ #${e.n} ${e.stmt}\n   ${e.message}${e.detail ? `\n   detail: ${e.detail}` : ''}`);

const count = async (label, q) => console.log(`  ${label.padEnd(13)} ${(await db.query(q)).rows[0].n}`);
console.log('\ninventory:');
await count('tables', `select count(*) n from pg_tables where schemaname='albaraka_ai'`);
await count('views', `select count(*) n from pg_views where schemaname='albaraka_ai'`);
await count('enums', `select count(*) n from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='albaraka_ai' and t.typtype='e'`);
await count('indexes', `select count(*) n from pg_indexes where schemaname='albaraka_ai'`);
await count('triggers', `select count(*) n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='albaraka_ai' and not t.tgisinternal`);
await count('functions', `select count(*) n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='albaraka_ai'`);
await count('partitions', `select count(*) n from pg_inherits i join pg_class c on c.oid=i.inhrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='albaraka_ai'`);
await count('constraints', `select count(*) n from pg_constraint con join pg_namespace n on n.oid=con.connamespace where n.nspname='albaraka_ai'`);

console.log(`\nassertions  : ${assertions} passed · ${failures} failed`);
await db.end();
await pg.stop();
process.exit(errors.length || failures ? 1 : 0);
