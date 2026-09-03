/**
 * public.js — public API: assistant config, the SSE chat endpoint, feedback, public documents.
 * The chat endpoint is anonymous by design (docs/12 §8: the anonymous frontoffice path is
 * deliberately independent of Keycloak availability).
 */
import { Router } from 'express';
import { runChat } from '../pipeline.js';
import { config } from '../config.js';
import { randomUUID } from 'node:crypto';

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const buckets = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.reset) {
    buckets.set(ip, { count: 1, reset: now + config.rateLimit.windowMs });
    return false;
  }
  b.count++;
  return b.count > config.rateLimit.max;
}

export function publicRoutes(pool) {
  const router = Router();

  router.get('/assistant/config', async (req, res) => {
    const cfgRows = await pool.query('SELECT key, value, value_type, risk_tier FROM albaraka_ai.assistant_config ORDER BY key');
    const cfg = {};
    for (const r of cfgRows.rows) {
      try { cfg[r.key] = JSON.parse(r.value); } catch { cfg[r.key] = r.value; }
    }
    const active = (await pool.query(`SELECT id::text, version_no, top_k_dense, top_k_fts, rrf_k, embedding_variant, canary_percent FROM albaraka_ai.retrieval_config WHERE state='ACTIVE'`)).rows[0] || null;
    res.json({
      identity: cfg['assistant.identity'] || { assistant_name: 'Al-Mouchir', assistant_name_ar: 'المشير', bank_name: 'Al Baraka Bank Tunisia' },
      supportedLocales: ['fr-FR', 'ar-TN', 'en-GB'],
      defaultLocale: cfg['assistant.identity']?.default_locale || 'fr-FR',
      disclaimers: cfg['ui.disclaimers'] || {
        'fr-FR': ['Al-Mouchir est un assistant informatif ; les conditions contractuelles font foi.'],
        'ar-TN': ['المشير مساعد إعلامي؛ الشروط التعاقدية هي المرجع.'],
        'en-GB': ['Al-Mouchir is an informational assistant; contractual terms prevail.'],
      },
      suggestedQuestions: cfg['ui.suggested_questions'] || {
        'fr-FR': ['Comment ouvrir un compte courant ?', 'Comment fonctionne le rachat de crédit ?', 'Quelle est la différence entre murabaha et ijarah ?'],
        'ar-TN': ['كيف أفتح حسابا جاريا؟', 'كيف يعمل تجميع القروض؟', 'ما الفرق بين المرابحة والإجارة؟'],
        'en-GB': ['How do I open a current account?', 'How does debt consolidation work?', 'What is the difference between murabaha and ijarah?'],
      },
      demoKb: { label: 'Knowledge base currently served: DEMONSTRATION content (approved corpus comes from the bank KB).', demo: true },
      retrievalConfig: active,
    });
  });

  router.post('/chat/messages/send', async (req, res) => {
    const { text, locale = 'fr-FR', clientId, deviceId } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'text is required' } });
    if (String(text).length > 4000) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'text must be ≤ 4000 chars' } });
    if (!['fr-FR', 'ar-TN', 'en-GB'].includes(locale)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'unsupported locale' } });
    if (rateLimited(req.ip || 'unknown')) {
      res.status(429).set('Retry-After', '60').json({ error: { code: 'RATE_LIMITED', message: 'too many requests — retry in 60 s', retryAfterMs: 60_000 } });
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    // 'close' on res fires when the client disconnects; 'close' on req fires as soon as the
    // POST body is fully consumed (Node ≥18), which would mute the stream before the first frame.
    res.on('close', () => { closed = true; });
    const emit = (name, data) => { if (!closed && !res.writableEnded) res.write(frame(name, data)); };
    try {
      await runChat({ text: String(text).trim(), locale, clientId, deviceId }, pool, emit);
    } catch (e) {
      console.error('[chat]', e);
      if (!closed) {
        emit('error', { code: 'INTERNAL', retryAfterMs: 0, degradationStep: 1 });
        emit('done', { messageId: randomUUID(), tokensIn: 0, tokensOut: 0, latencyMs: 0 });
      }
    } finally {
      if (!res.writableEnded) res.end();
    }
  });

  router.post('/feedback', async (req, res) => {
    const { messageId, rating, comment, contactOptIn, contact } = req.body || {};
    if (!messageId || !rating) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'messageId and rating are required' } });
    await pool.query(
      `INSERT INTO albaraka_ai.feedback (id, message_id, rating, comment, contact_opt_in, contact, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [randomUUID(), messageId, rating, comment || null, Boolean(contactOptIn), contactOptIn ? (contact || null) : null]
    ).catch((e) => res.status(500).json({ error: { code: 'INTERNAL', message: e.message } }));
    res.status(201).json({ ok: true });
  });

  router.get('/public/documents/:id', async (req, res) => {
    const r = await pool.query(
      `SELECT d.id::text, d.title_fr, d.title_ar, d.title_en, d.source_uri, d.lifecycle_state,
              dv.body_text, dv.state, dv.published_at
         FROM albaraka_ai.document d
         LEFT JOIN albaraka_ai.document_version dv ON dv.id = d.current_version_id
        WHERE d.id = $1`,
      [req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: { code: 'RESOURCE.NOT_FOUND', message: 'document not found' } });
    res.json(r.rows[0]);
  });

  return router;
}
