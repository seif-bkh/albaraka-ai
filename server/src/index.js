#!/usr/bin/env node
/**
 * index.js — Al-Mouchir executable backend.
 *
 * Boots the embedded PostgreSQL (real schema.sql + seeds + demo KB), then serves:
 *   GET    /actuator/health/liveness | /actuator/health/readiness
 *   GET    /api/v1/assistant/config           (public)
 *   POST   /api/v1/chat/messages/send         (public, SSE)
 *   POST   /api/v1/feedback                   (public)
 *   GET    /api/v1/public/documents/:id       (public)
 *   POST   /api/v1/auth/login                 (dev mode)
 *   GET    /api/v1/auth/me
 *   /api/v1/admin/*                           (JWT + roles)
 */
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { startDb } from './db.js';
import { login, createToken, verifyToken, requireAuth } from './auth.js';
import { publicRoutes } from './routes/public.js';
import { adminRoutes } from './routes/admin.js';

const { pool, pgServer } = await startDb({ verbose: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/actuator/health/liveness', (req, res) => res.json({ status: 'UP' }));
app.get('/actuator/health/readiness', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'UP', components: { db: 'UP' } });
  } catch {
    res.status(503).json({ status: 'DOWN', components: { db: 'DOWN' } });
  }
});

app.post('/api/v1/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const user = login(email || '', password || '', config.jwt.secret);
  if (!user) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'invalid credentials' } });
  const token = await createToken(user, config.jwt.secret);
  res.json({ accessToken: token, user: { email: user.email, name: user.name, roles: user.roles } });
});
app.get('/api/v1/auth/me', requireAuth(config.jwt.secret), (req, res) => res.json({ user: req.user }));

app.use('/api/v1', publicRoutes(pool));
app.use('/api/v1/admin', adminRoutes(pool, config));

// structured error envelope (docs/08 §2.2)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const correlationId = randomUUID();
  console.error('[error]', correlationId, err.message);
  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL',
      message: err.expose ? err.message : 'internal error',
      correlationId,
    },
  });
});

const server = app.listen(config.port, config.host, () => {
  console.log(`[server] al-mouchir API on http://${config.host}:${config.port} (provider=${config.providerMode})`);
});

async function shutdown() {
  console.log('[server] shutting down');
  server.close();
  await pool.end().catch(() => {});
  await pgServer.stop().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
