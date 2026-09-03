#!/usr/bin/env node
/**
 * db-bootstrap.mjs — bring up the embedded PostgreSQL and (re)initialise the schema, seeds and
 * demo knowledge base. Used by `npm run db:init` and by the server on first boot.
 */
import { startDb } from '../src/db.js';

const { pool, pgServer } = await startDb({ verbose: true });
const r = await pool.query(
  `SELECT (SELECT count(*) FROM albaraka_ai.document) AS documents,
          (SELECT count(*) FROM albaraka_ai.chunk)     AS chunks,
          (SELECT count(*) FROM albaraka_ai.audit_event) AS audit_events,
          (SELECT count(*) FROM albaraka_ai.prompt_version) AS prompts`
);
console.log('db ready:', r.rows[0]);
await pool.end();
await pgServer.stop();
