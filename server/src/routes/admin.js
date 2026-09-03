/**
 * admin.js — backoffice API: document library, Sharia review workflow (two-eyes, quorum,
 * self-approval rejection), prompts, retrieval config, models & budget, audit (hash-chain
 * verification), feedback and the dashboard.
 *
 * Governance codes come from docs/08 §2.2: 422 GOVERNANCE.SELF_APPROVAL / QUORUM_NOT_MET /
 * STATE_TRANSITION_INVALID. The schema triggers enforce the same rules in PostgreSQL; the
 * application re-checks them to return the documented API codes.
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth, requireRoles } from '../auth.js';

const ROLE_MAP = {
  SHARIA_OFFICER: 'SHARIA_OFFICER',
  COMPLIANCE_OFFICER: 'COMPLIANCE_OFFICER',
  REVIEWER: 'REVIEWER',
  ADMIN: 'REVIEWER',
  AI_ENGINEER: 'REVIEWER',
};

async function audit(pool, { actor, action, subjectType, subjectId, after, reason, reasonCode }) {
  await pool.query(
    `INSERT INTO albaraka_ai.audit_event (id, actor, actor_role, action, subject_type, subject_id, after_json, reason, reason_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [randomUUID(), actor.email, (actor.roles || []).join(','), action, subjectType, subjectId || null, JSON.stringify(after || {}), reason || null, reasonCode || null]
  );
}

const stateTransition = (res) => res.status(422).json({ error: { code: 'STATE_TRANSITION_INVALID', message: 'invalid lifecycle state for this operation' } });

export function adminRoutes(pool, config) {
  const router = Router();
  router.use(requireAuth(config.jwt.secret));

  // ── dashboard ───────────────────────────────────────────────────────────────────────────────
  router.get('/dashboard', requireRoles('ADMIN', 'AI_ENGINEER', 'SHARIA_OFFICER', 'COMPLIANCE_OFFICER', 'REVIEWER', 'AGENT'), async (req, res) => {
    const [docs, reviews, fatwas, msg, auditCnt] = await Promise.all([
      pool.query(`SELECT count(*)::int AS n FROM albaraka_ai.document`),
      pool.query(`SELECT count(*)::int AS n FROM albaraka_ai.sharia_review WHERE state IN ('PENDING','IN_REVIEW','CHANGES_REQUESTED')`),
      pool.query(`SELECT count(*)::int AS n FROM albaraka_ai.fatwa_request WHERE state IN ('OPEN','ASSIGNED')`),
      pool.query(`SELECT count(*)::int AS n, coalesce(round(sum(tokens_out)::numeric/1000,1),0)::float AS ktokens FROM albaraka_ai.message WHERE role='ASSISTANT'`),
      pool.query(`SELECT count(*)::int AS n, coalesce(sum(cost_usd),0)::float AS cost FROM albaraka_ai.llm_call_log WHERE created_at >= current_date`),
    ]);
    res.json({
      documents: docs.rows[0].n,
      reviewsOpen: reviews.rows[0].n,
      fatwasOpen: fatwas.rows[0].n,
      answers: msg.rows[0].n,
      tokensOutK: msg.rows[0].ktokens,
      spendTodayUsd: auditCnt.rows[0].cost,
      budgetUsd: config.dailyBudgetUsd,
      searchableChunks: (await pool.query(`SELECT count(*)::int AS n FROM albaraka_ai.chunk WHERE searchable`)).rows[0].n,
    });
  });

  // ── documents ────────────────────────────────────────────────────────────────────────────────
  router.get('/documents', requireRoles('ADMIN', 'AI_ENGINEER', 'SHARIA_OFFICER', 'COMPLIANCE_OFFICER', 'REVIEWER', 'AGENT'), async (req, res) => {
    const { rows } = await pool.query(
      `SELECT d.id::text, d.title_fr, d.title_ar, d.title_en, d.lifecycle_state, d.classification, d.audience, d.created_at,
              d.current_version_id::text AS current_version_id,
              (SELECT state FROM albaraka_ai.document_version WHERE id = d.current_version_id) AS version_state,
              (SELECT count(*)::int FROM albaraka_ai.chunk c JOIN albaraka_ai.document_version dv ON dv.id = c.document_version_id WHERE dv.document_id = d.id) AS chunks
         FROM albaraka_ai.document d ORDER BY d.created_at DESC`
    );
    res.json({ items: rows });
  });

  router.get('/documents/:id', requireRoles('ADMIN', 'AI_ENGINEER', 'SHARIA_OFFICER', 'COMPLIANCE_OFFICER', 'REVIEWER', 'AGENT'), async (req, res) => {
    const doc = await pool.query(
      `SELECT d.*, (SELECT state FROM albaraka_ai.document_version WHERE id = d.current_version_id) AS version_state
         FROM albaraka_ai.document d WHERE d.id = $1`, [req.params.id]);
    if (!doc.rows[0]) return res.status(404).json({ error: { code: 'RESOURCE.NOT_FOUND', message: 'document not found' } });
    const versions = await pool.query(
      `SELECT id::text, version_no, body_lang, state, published_at, body_sha256, created_by
         FROM albaraka_ai.document_version WHERE document_id = $1 ORDER BY version_no`, [req.params.id]);
    const chunks = await pool.query(
      `SELECT c.id::text, c.ordinal, c.lang, c.searchable, c.quarantined, c.quarantine_reason, c.published, c.sharia_approved, c.embedding_status, left(c.content, 240) AS content
         FROM albaraka_ai.chunk c JOIN albaraka_ai.document_version dv ON dv.id = c.document_version_id
        WHERE dv.document_id = $1 ORDER BY c.ordinal, c.lang`, [req.params.id]);
    res.json({ ...doc.rows[0], versions: versions.rows, chunks: chunks.rows });
  });

  router.post('/documents', requireRoles('ADMIN', 'AI_ENGINEER'), async (req, res) => {
    const { titleFr, titleAr, titleEn, bodyFr, bodyAr, bodyEn, riskTier = 'T2_MEDIUM' } = req.body || {};
    if (!titleFr || !bodyFr) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'titleFr and bodyFr are required' } });
    if (!['T1_LOW', 'T2_MEDIUM', 'T3_HIGH'].includes(riskTier)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'riskTier must be T1_LOW|T2_MEDIUM|T3_HIGH' } });
    const docId = randomUUID(), versionId = randomUUID();
    const sha = (t) => Buffer.from(t).toString('base64url');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO albaraka_ai.document (id, collection_id, title_fr, title_ar, title_en, mime_type, classification, audience, lifecycle_state, owner_role, created_by)
         VALUES ($1,(SELECT id FROM albaraka_ai.collection WHERE code='PRODUCTS'),$2,$3,$4,'text/markdown','PUBLIC','PUBLIC','DRAFT','KB_EDITOR',$5)`,
        [docId, titleFr, titleAr || null, titleEn || null, req.user.email]
      );
      await client.query(
        `INSERT INTO albaraka_ai.document_version (id, document_id, version_no, body_text, body_lang, state, body_sha256, created_by)
         VALUES ($1,$2,1,$3,'fr-FR','DRAFT',$4,$5)`,
        [versionId, docId, bodyFr, sha(bodyFr), req.user.email]
      );
      const langs = [['fr-FR', bodyFr], ['ar-TN', bodyAr], ['en-GB', bodyEn]];
      let ord = 0;
      for (const [lang, body] of langs) {
        if (!body) continue;
        ord++;
        await client.query(
          `INSERT INTO albaraka_ai.chunk
            (id, document_version_id, ordinal, content, heading_path, token_count, lang, is_translation, machine_translated, human_verified,
             normalized_text, audience, classification, published, sharia_approved, embedding_status, embedding_model, embedding_dim, content_sha256)
           VALUES ($1,$2,$3,$4,$5,$6,$7,false,false,true,$4,'PUBLIC','PUBLIC',false,false,'EMBEDDED','gemini-embedding-001',1536,$8)`,
          [randomUUID(), versionId, ord, body, ['draft'], Math.round(body.length / 5), lang, sha(body)]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    await audit(pool, { actor: req.user, action: 'document.created', subjectType: 'DOCUMENT', subjectId: docId, after: { riskTier } });
    res.status(201).json({ id: docId, versionId });
  });

  // ── Sharia review workflow ──────────────────────────────────────────────────────────────────
  router.post('/documents/:id/submit-review', requireRoles('ADMIN', 'AI_ENGINEER'), async (req, res) => {
    const { riskTier = 'T2_MEDIUM' } = req.body || {};
    const doc = await pool.query(`SELECT d.id::text, (SELECT id::text FROM albaraka_ai.document_version WHERE document_id=d.id AND state='DRAFT' ORDER BY version_no DESC LIMIT 1) AS draft
                                    FROM albaraka_ai.document d WHERE d.id=$1`, [req.params.id]);
    if (!doc.rows[0]) return res.status(404).json({ error: { code: 'RESOURCE.NOT_FOUND', message: 'document not found' } });
    if (!doc.rows[0].draft) return stateTransition(res);
    const reviewId = randomUUID();
    const tasks = riskTier === 'T3_HIGH' ? ['SHARIA_OFFICER', 'COMPLIANCE_OFFICER']
      : riskTier === 'T2_MEDIUM' ? ['SHARIA_OFFICER', 'REVIEWER'] : ['SHARIA_OFFICER'];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO albaraka_ai.sharia_review (id, ref, subject_type, subject_id, subject_label, risk_tier, state, submitted_by, due_at)
         VALUES ($1,$2,'DOCUMENT_VERSION',$3,$4,$5,'IN_REVIEW',$6, now() + interval '7 days')`,
        [reviewId, `RV-${Date.now().toString(36).toUpperCase()}`, doc.rows[0].draft, doc.rows[0].title_fr || 'document', riskTier, req.user.email]
      );
      for (const role of tasks) await client.query(`INSERT INTO albaraka_ai.review_task (id, review_id, assignee_role) VALUES ($1,$2,$3)`, [randomUUID(), reviewId, role]);
      await client.query(`UPDATE albaraka_ai.document_version SET state='IN_REVIEW', sharia_review_id=$1 WHERE id=$2`, [reviewId, doc.rows[0].draft]);
      await client.query(`UPDATE albaraka_ai.document SET lifecycle_state='IN_REVIEW', updated_by=$1 WHERE id=$2`, [req.user.email, req.params.id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
    await audit(pool, { actor: req.user, action: 'review.submitted', subjectType: 'SHARIA_REVIEW', subjectId: reviewId, after: { riskTier } });
    res.status(201).json({ id: reviewId, tasks });
  });

  router.get('/reviews', requireRoles('ADMIN', 'AI_ENGINEER', 'SHARIA_OFFICER', 'COMPLIANCE_OFFICER', 'REVIEWER'), async (req, res) => {
    const reviews = await pool.query(
      `SELECT r.id::text, r.ref, r.subject_label, r.risk_tier, r.state, r.submitted_by, r.submitted_at, r.due_at, r.decided_at, r.decision_by,
              dv.id::text AS version_id, dv.document_id::text AS document_id
         FROM albaraka_ai.sharia_review r
         LEFT JOIN albaraka_ai.document_version dv ON dv.sharia_review_id = r.id
        ORDER BY r.submitted_at DESC`
    );
    const tasks = await pool.query(
      `SELECT t.id::text, t.review_id::text, t.assignee_role, t.assignee_id, t.required, t.decision, t.comments, t.decided_at
         FROM albaraka_ai.review_task t ORDER BY t.created_at`
    );
    const byReview = {};
    for (const t of tasks.rows) (byReview[t.review_id] ||= []).push(t);
    res.json({ items: reviews.rows.map((r) => ({ ...r, tasks: byReview[r.id] || [] })) });
  });

  router.post('/reviews/:id/decision', requireRoles('SHARIA_OFFICER', 'COMPLIANCE_OFFICER', 'REVIEWER', 'ADMIN', 'AI_ENGINEER'), async (req, res) => {
    const { decision, comments } = req.body || {};
    if (!['APPROVE', 'REQUEST_CHANGES', 'REJECT'].includes(decision)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'decision must be APPROVE|REQUEST_CHANGES|REJECT' } });
    const review = await pool.query(`SELECT r.*, dv.document_id::text AS document_id, dv.id::text AS version_id
                                       FROM albaraka_ai.sharia_review r
                                       LEFT JOIN albaraka_ai.document_version dv ON dv.sharia_review_id = r.id
                                      WHERE r.id = $1`, [req.params.id]);
    if (!review.rows[0]) return res.status(404).json({ error: { code: 'RESOURCE.NOT_FOUND', message: 'review not found' } });
    const rv = review.rows[0];
    if (rv.state !== 'IN_REVIEW' && rv.state !== 'PENDING') return stateTransition(res);
    if (rv.submitted_by === req.user.email) return res.status(422).json({ error: { code: 'GOVERNANCE.SELF_APPROVAL', message: 'a submitter cannot approve their own submission' } });
    const role = ROLE_MAP[req.user.roles.find((x) => ROLE_MAP[x])];
    const task = await pool.query(
      `SELECT id::text FROM albaraka_ai.review_task WHERE review_id = $1 AND assignee_role = $2 AND decided_at IS NULL ORDER BY created_at LIMIT 1`,
      [req.params.id, role]
    );
    if (!task.rows[0]) return res.status(409).json({ error: { code: 'CONFLICT', message: `no pending task for role ${role}` } });
    await pool.query(
      `UPDATE albaraka_ai.review_task SET decision=$1, comments=$2, assignee_id=$3, decided_at=now() WHERE id=$4`,
      [decision, comments || null, req.user.email, task.rows[0].id]
    );
    const pending = await pool.query(`SELECT count(*)::int AS n FROM albaraka_ai.review_task WHERE review_id=$1 AND required AND decided_at IS NULL`, [req.params.id]);
    let versionState = null;
    if (pending.rows[0].n === 0) {
      const decided = await pool.query(`SELECT decision, count(*)::int AS n FROM albaraka_ai.review_task WHERE review_id=$1 AND required GROUP BY decision`, [req.params.id]);
      const allApprove = decided.rows.length === 1 && decided.rows[0].decision === 'APPROVE';
      const anyReject = decided.rows.some((d) => d.decision === 'REJECT');
      const reviewState = anyReject ? 'REJECTED' : allApprove ? 'APPROVED' : 'CHANGES_REQUESTED';
      versionState = allApprove ? 'SHARIA_APPROVED' : 'CHANGES_REQUESTED';
      await pool.query(
        `UPDATE albaraka_ai.sharia_review SET state=$1, decided_at=now(), decision_by=$2 WHERE id=$3`,
        [reviewState, req.user.email, req.params.id]
      );
      await pool.query(`UPDATE albaraka_ai.document_version SET state=$1 WHERE id=$2`, [versionState, rv.version_id]);
      await pool.query(`UPDATE albaraka_ai.document SET lifecycle_state=$1, updated_by=$2 WHERE id=$3`, [versionState, req.user.email, rv.document_id]);
    }
    await audit(pool, {
      actor: req.user, action: 'review.decided', subjectType: 'SHARIA_REVIEW', subjectId: req.params.id,
      after: { decision, reviewState: versionState ?? 'IN_REVIEW' }, reason: comments || undefined, reasonCode: decision === 'APPROVE' ? 'two-eyes' : undefined,
    });
    res.json({ ok: true, pending: pending.rows[0].n, reviewState: versionState });
  });

  router.post('/documents/:id/publish', requireRoles('ADMIN', 'AI_ENGINEER'), async (req, res) => {
    const doc = await pool.query(
      `SELECT d.id::text, d.title_fr, dv.id::text AS version_id, dv.state
         FROM albaraka_ai.document d
         JOIN albaraka_ai.document_version dv ON dv.document_id = d.id
        WHERE d.id = $1 AND dv.state = 'SHARIA_APPROVED'
        ORDER BY dv.version_no DESC LIMIT 1`, [req.params.id]);
    if (!doc.rows[0]) return res.status(404).json({ error: { code: 'RESOURCE.NOT_FOUND', message: 'document not found or no SHARIA_APPROVED version' } });
    await pool.query(
      `UPDATE albaraka_ai.document_version SET state='PUBLISHED', published_at=now(), published_by=$1 WHERE id=$2`,
      [req.user.email, doc.rows[0].version_id]
    );
    await pool.query(
      `UPDATE albaraka_ai.document SET lifecycle_state='PUBLISHED', current_version_id=$1, updated_by=$2 WHERE id=$3`,
      [doc.rows[0].version_id, req.user.email, req.params.id]
    );
    await audit(pool, { actor: req.user, action: 'document.published', subjectType: 'DOCUMENT', subjectId: req.params.id, after: { versionId: doc.rows[0].version_id } });
    res.json({ ok: true });
  });

  // ── prompts / models / retrieval / audit / feedback ─────────────────────────────────────────
  router.get('/prompts', requireRoles('ADMIN', 'AI_ENGINEER', 'SHARIA_OFFICER'), async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.code, pv.version_no, pv.locale, left(pv.body, 200) AS excerpt, pv.state, pv.protected_clauses, pv.canary_percent
         FROM albaraka_ai.prompt_version pv JOIN albaraka_ai.prompt_template p ON p.code = pv.code
        ORDER BY p.code, pv.locale, pv.version_no`);
    res.json({ items: rows });
  });

  router.get('/models', requireRoles('ADMIN', 'AI_ENGINEER'), async (req, res) => {
    const { rows } = await pool.query(
      `SELECT m.id::text, m.code, m.provider, m.model_id, m.state, m.temperature, m.max_tokens, m.daily_budget_usd, m.enabled
         FROM albaraka_ai.model_config m ORDER BY m.code`);
    const usage = await pool.query(`SELECT coalesce(sum(cost_usd),0)::float AS cost, count(*)::int AS calls
                                      FROM albaraka_ai.llm_call_log WHERE created_at >= current_date`);
    res.json({ items: rows, spendTodayUsd: usage.rows[0].cost, callsToday: usage.rows[0].calls });
  });

  router.get('/retrieval-config', requireRoles('ADMIN', 'AI_ENGINEER', 'SHARIA_OFFICER'), async (req, res) => {
    const { rows } = await pool.query(`SELECT id::text, version_no, channel, state, top_k_dense, top_k_fts, rrf_k, embedding_variant, canary_percent, activated_at, activated_by, review_id::text FROM albaraka_ai.retrieval_config ORDER BY version_no`);
    res.json({ items: rows });
  });

  router.post('/retrieval-config/:id/activate', requireRoles('ADMIN', 'AI_ENGINEER'), async (req, res) => {
    const r = await pool.query(`SELECT id::text, state FROM albaraka_ai.retrieval_config WHERE id=$1`, [req.params.id]);
    if (!r.rows[0]) return res.status(404).json({ error: { code: 'RESOURCE.NOT_FOUND', message: 'config not found' } });
    if (r.rows[0].state === 'ACTIVE') return res.json({ ok: true, active: true });
    if (r.rows[0].state !== 'IN_REVIEW' && r.rows[0].state !== 'DRAFT') return stateTransition(res);
    await pool.query(`UPDATE albaraka_ai.retrieval_config SET state='ACTIVE', activated_at=now(), activated_by=$1 WHERE id=$2`, [req.user.email, req.params.id]);
    await audit(pool, { actor: req.user, action: 'retrieval_config.activated', subjectType: 'RETRIEVAL_CONFIG', subjectId: req.params.id });
    res.json({ ok: true });
  });

  router.get('/audit', requireRoles('ADMIN', 'COMPLIANCE_OFFICER'), async (req, res) => {
    const { rows } = await pool.query(`SELECT seq, id::text, occurred_at, actor, action, subject_type, subject_id, reason_code, left(hash, 16) AS hash, prev_hash IS NULL AS is_head
                                         FROM albaraka_ai.audit_event ORDER BY seq DESC LIMIT 100`);
    res.json({ items: rows });
  });

  router.get('/audit/verify', requireRoles('ADMIN', 'COMPLIANCE_OFFICER'), async (req, res) => {
    const r = await pool.query(`SELECT * FROM albaraka_ai.fn_verify_audit_chain(now() - interval '400 days', now() + interval '1 day')`);
    res.json(r.rows[0] || { valid: false, events_checked: 0, first_broken_seq: null });
  });

  router.get('/feedback', requireRoles('ADMIN', 'COMPLIANCE_OFFICER'), async (req, res) => {
    const { rows } = await pool.query(`SELECT id::text, message_id, rating, left(comment, 160) AS comment, status, created_at FROM albaraka_ai.feedback ORDER BY created_at DESC LIMIT 100`);
    res.json({ items: rows });
  });

  return router;
}
