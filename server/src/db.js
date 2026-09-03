/**
 * db.js — the real reference DDL, executed on an embedded PostgreSQL server.
 *
 * `specs/db/schema.sql` is 246 statements (58 tables, 35 enums, 30+ triggers, partitioned
 * audit_event and retrieval_candidate, the albaraka_fts text-search configuration, the Sharia
 * gate trigger that recomputes chunk.searchable, and the append-only hash-chained audit log).
 * This module runs it verbatim — only the pgvector-only pieces are stubbed exactly as
 * tools/db-verify does (vector(1536)/halfvec(1536) → real[], HNSW index commented); the real
 * pgvector path is the docker-compose topology. The generated seed migrations (V900–V903) run
 * after the schema, then seed-demo.js adds the DEMO knowledge base.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { config, ROOT } from './config.js';
import { seedDemoKnowledgeBase } from './seed-demo.js';

const SCHEMA = join(ROOT, 'specs', 'db', 'schema.sql');
const SEED_DIR = join(ROOT, 'specs', 'db', 'seed');

export function splitStatements(text) {
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

/** Identical pgvector stubbing to tools/db-verify — the docker topology runs the real thing. */
export function stubVectorSql(sql) {
  return sql
    .replace(/CREATE EXTENSION IF NOT EXISTS vector;[^\n]*/, '-- (stubbed) CREATE EXTENSION vector;')
    .replace(/halfvec\(1536\)/g, 'real[]')
    .replace(/\bvector\(1536\)/g, 'real[]')
    .replace(/CREATE INDEX idx_chunk_emb_hnsw[\s\S]*?WITH \(m = 16, ef_construction = 128\);/,
      '-- (stubbed) CREATE INDEX idx_chunk_emb_hnsw ... USING hnsw (embedding_h halfvec_cosine_ops);');
}

/** Attach to an already-running embedded PostgreSQL (e.g. the dev server) instead of booting one. */
export function attachExistingDb() {
  const pool = new pg.Pool({
    host: '127.0.0.1', port: config.db.port, user: config.db.user, password: config.db.password,
    database: config.db.database, max: 8, options: '-c search_path=albaraka_ai,public',
  });
  return { pool, pgServer: null };
}

export async function startDb({ fresh = false, verbose = false } = {}) {
  const { dataDir } = config.db;
  if (fresh && existsSync(join(dataDir, 'PG_VERSION'))) {
    // never delete in production code paths — documented in server/README
  }
  const pgServer = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: config.db.user,
    password: config.db.password,
    port: config.db.port,
    persistent: true,
  });
  if (!existsSync(join(dataDir, 'PG_VERSION'))) await pgServer.initialise();
  await pgServer.start();

  const admin = pgServer.getPgClient('postgres');
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.db.database]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE ${config.db.database}`);
  await admin.end();

  const pool = new pg.Pool({
    host: '127.0.0.1',
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    max: 8,
    // extensions are installed into albaraka_ai (search_path at DDL time) — every connection must
    // resolve unqualified names (similarity, unaccent, the FTS config) the same way
    options: '-c search_path=albaraka_ai,public',
  });

  const schemaPresent = await pool.query("SELECT to_regclass('albaraka_ai.document') AS t");
  const docCount = await pool.query('SELECT count(*)::int AS n FROM albaraka_ai.document').catch(() => ({ rows: [{ n: 0 }] }));
  if (!schemaPresent.rows[0]?.t) {
    const schemaSql = stubVectorSql(readFileSync(SCHEMA, 'utf8'));
    const statements = splitStatements(schemaSql);
    for (const stmt of statements) {
      await pool.query(stmt).catch((e) => {
        throw new Error(`schema statement failed (${e.message})\n  ---\n  ${stmt.slice(0, 400)}`);
      });
    }
    for (const file of ['V900__seed_glossary.sql', 'V901__seed_prompts.sql', 'V902__seed_policies.sql', 'V903__seed_dialect.sql']) {
      const sql = readFileSync(join(SEED_DIR, file), 'utf8');
      for (const stmt of splitStatements(sql)) await pool.query(stmt);
    }
    const demo = await seedDemoKnowledgeBase(pool);
    if (verbose) console.log(`[db] schema (246 stmts) + seeds V900–V903 + demo KB (${demo.docs} documents, ${demo.chunks} chunks)`);
  } else if (docCount.rows[0].n === 0) {
    // schema exists but the seeds never ran (a previous bootstrap aborted mid-way)
    const demo = await seedDemoKnowledgeBase(pool);
    if (verbose) console.log(`[db] fresh schema, missing seeds V900–V903 — manual re-seed required; demo KB (${demo.docs} documents, ${demo.chunks} chunks)`);
  }
  return { pool, pgServer };
}
