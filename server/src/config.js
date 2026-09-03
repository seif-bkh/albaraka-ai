/**
 * config.js — environment-driven runtime configuration (dev/defaults mirror specs/config).
 * The committed values are dev-only; every production flag comes from the environment, and the
 * docker-compose.yml file documents the same variables for the containerised stack.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export const config = {
  host: env('SERVER_HOST', '0.0.0.0'),
  port: Number(env('SERVER_PORT', '8080')),

  db: {
    port: Number(env('DB_PORT', '55433')),
    user: env('DB_USER', 'postgres'),
    password: env('DB_PASSWORD', 'postgres'),
    database: env('DB_NAME', 'albaraka_ai'),
    dataDir: env('DB_DATA_DIR', join(here, '..', '.pgdata')),
  },

  jwt: {
    secret: env(
      'JWT_SECRET',
      'dev-only-albaraka-demo-secret-0123456789abcdef' // NEVER use outside the dev preview
    ),
    ttl: '8h',
  },

  providerMode: env('PROVIDER_MODE', 'MOCK'), // MOCK | LIVE (LIVE requires the two keys below)
  groq: {
    baseUrl: env('GROQ_BASE_URL', 'https://api.groq.com').replace(/\/$/, ''),
    apiKey: env('GROQ_API_KEY', ''),
  },
  google: { apiKey: env('GOOGLE_API_KEY', '') },

  redis: { host: env('REDIS_HOST', '') }, // when set, cache flushes through Redis; otherwise in-memory LRU

  rateLimit: { windowMs: 60_000, max: 90 },
  cache: { ttlMs: 24 * 60 * 60 * 1000, max: 500 },

  dailyBudgetUsd: Number(env('ALBARAKA_DAILY_BUDGET_USD', '5.00')),
};
