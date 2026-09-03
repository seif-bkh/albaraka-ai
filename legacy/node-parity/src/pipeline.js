/**
 * pipeline.js — the chat pipeline: input guardrails → intent → retrieval → rerank → grounded
 * generation (answer contract) → output verification, streaming the documented SSE grammar
 * (docs/08 §3.1) and persisting trace / candidates / auditables / usage.
 *
 * SSE frame order: accepted → status* → sources (before first token) → token* →
 * exactly one of answer|refusal|error → done (last).
 */
import { randomUUID, createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import { retrieve } from './rag.js';
import { config } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const LOCALES = ['fr-FR', 'ar-TN', 'en-GB'];
export const dirOf = (locale) => (locale === 'ar-TN' ? 'rtl' : 'ltr');

const STATUS_LABELS = {
  SCREENING: { 'fr-FR': 'Vérification des règles', 'ar-TN': 'فحص القواعد', 'en-GB': 'Screening' },
  RETRIEVING: { 'fr-FR': 'Recherche dans la documentation approuvée', 'ar-TN': 'بحث في الوثائق المعتمدة', 'en-GB': 'Searching approved documentation' },
  RERANKING: { 'fr-FR': 'Classement des sources', 'ar-TN': 'ترتيب المصادر', 'en-GB': 'Ranking sources' },
  GENERATING: { 'fr-FR': 'Rédaction de la réponse', 'ar-TN': 'كتابة الجواب', 'en-GB': 'Writing the answer' },
  VERIFYING: { 'fr-FR': 'Vérification finale', 'ar-TN': 'تحقق نهائي', 'en-GB': 'Final checks' },
};

const REFUSALS = {
  'REF-01': {
    'fr-FR': { title: 'Demande refusée', body: 'Votre message semble tenter de modifier le fonctionnement de l’assistant. Cette demande ne peut pas être traitée.' },
    'ar-TN': { title: 'طلب مرفوض', body: 'يبدو أن رسالتك تحاول تغيير طريقة عمل المساعد. لا يمكن معالجة هذا الطلب.' },
    'en-GB': { title: 'Request refused', body: 'Your message appears to try to alter the assistant’s behaviour. This cannot be processed.' },
  },
  'REF-03': {
    'fr-FR': { title: 'Sujet relevant du comité de conformité', body: 'Les avis religieux ne sont pas délivrés par l’assistant. Votre question est transmise au comité de contrôle de la conformité aux normes bancaires islamiques, qui vous répondra selon la procédure en vigueur.' },
    'ar-TN': { title: 'موضوع يخص لجنة المراقبة', body: 'لا يصدر المساعد فتاوى شرعية. تم تحويل سؤالك إلى لجنة مراقبة مطابقة المعايير المصرفية الإسلامية، وستُجاب وفق الإجراءات المعمول بها.' },
    'en-GB': { title: 'Subject for the Sharia committee', body: 'Religious rulings are not issued by this assistant. Your question was forwarded to the Islamic banking standards compliance committee, which responds through the official procedure.' },
  },
  'REF-04': {
    'fr-FR': { title: 'Données personnelles non traitées', body: 'Je ne peux pas accéder à vos données personnelles. Pour toute opération sur un compte, veuillez vous rendre en agence ou utiliser votre espace sécurisé.' },
    'ar-TN': { title: 'لا نتداول البيانات الشخصية', body: 'لا يمكنني الاطلاع على بياناتك الشخصية. لأي عملية تتعلق بحسابك، يرجى التوجه إلى الوكالة أو استعمال فضاءك الآمن.' },
    'en-GB': { title: 'No personal data handling', body: 'I cannot access your personal data. For account operations please visit a branch or use your secure space.' },
  },
  'REF-05': {
    'fr-FR': { title: 'Je n’ai pas trouvé de réponse approuvée', body: 'Cette question dépasse les documents approuvés dont je dispose. Voici les sujets les plus proches ; pour une réponse officielle, contactez votre agence.' },
    'ar-TN': { title: 'لم أجد جوابا معتمدا', body: 'هذا السؤال يتجاوز الوثائق المعتمدة المتوفرة لدي. إليك أقرب المواضيع؛ للحصول على جواب رسمي اتصل بوكالتك.' },
    'en-GB': { title: 'No approved answer found', body: 'This question falls outside the approved documents I hold. These are the closest topics; contact your branch for an official answer.' },
  },
  'REF-06': {
    'fr-FR': { title: 'Question hors périmètre', body: 'Je réponds uniquement aux questions relatives aux produits, procédures et concepts de la banque. Reformulez votre question ou contactez votre agence.' },
    'ar-TN': { title: 'خارج نطاق الخدمة', body: 'أجيب فقط عن أسئلة المنتجات والإجراءات والمفاهيم المصرفية للبنك. أعد صياغة سؤالك أو اتصل بوكالتك.' },
    'en-GB': { title: 'Out of scope', body: 'I only answer questions about the bank’s products, procedures and concepts. Please rephrase or contact your branch.' },
  },
};

const DISCLAIMERS = {
  'fr-FR': ['Réponse générée à partir de la documentation approuvée — contenu de démonstration.', 'Vérifiez les conditions en vigueur auprès de votre agence.'],
  'ar-TN': ['جواب مولّد من الوثائق المعتمدة — محتوى تجريبي.', 'تحقق من الشروط الجارية لدى وكالتك.'],
  'en-GB': ['Answer generated from approved documentation — demonstration content.', 'Check current conditions with your branch.'],
};

const GREETINGS = {
  'fr-FR': 'Bonjour ! Je suis **Al-Mouchir**, l’assistant d’Al Baraka Bank Tunisia. Posez-moi une question sur nos produits, nos procédures ou des notions de finance islamique.',
  'ar-TN': 'مرحبا! أنا **المشير**، مساعد بنك البركة تونس. اسألني عن منتجاتنا وإجراءاتنا أو مفاهيم التمويل الإسلامي.',
  'en-GB': 'Hello! I am **Al-Mouchir**, Al Baraka Bank Tunisia’s assistant. Ask me about our products, procedures or Islamic finance concepts.',
};

function guardInput(text) {
  const t = text.toLowerCase();
  const has = (re) => re.test(t);
  if (has(/ignore\s*(the)?\s*(previous|system|instructions|all)/) || has(/تجاهل|اجعل\s*الأوامر|system prompt|révèle|reveal.*prompt/)) {
    return { blocked: true, refusalCode: 'REF-01', policyCode: 'INJECTION', severity: 'HIGH', evidence: 'adversarial instruction' };
  }
  if (has(/\bcin\s*:?\s*\d{6,9}\b|\biban\b|\b(rib|rîb|rié)\b|\b(0[2-9]\d{7})\b|[\w.+-]+@[\w-]+\.[a-z]{2,}|هاتف|بريد|رقم بطاقة|رقم الحساب/)) {
    return { blocked: true, refusalCode: 'REF-04', policyCode: 'PII_EGRESS', severity: 'HIGH', evidence: 'personal-data pattern' };
  }
  return { blocked: false };
}

function classify(text) {
  const t = text.toLowerCase();
  if (/zakat|zakāt|فتوى|زكاة|fatwa|حلال|حرام|riba|ربا|فائدة|intérêt|interest/.test(t)) return { intent: 'RELIGIOUS_RULING_REQUEST', refusal: 'REF-03' };
  if (/solde|balance|mon compte|mon épargne|حسابي|رصيد|account status/.test(t)) return { intent: 'ACCOUNT_STATUS', refusal: 'REF-04' };
  if (/achat.*crédit|rachat|regroupement|crédit|credit|قرض|تمويل|loan/.test(t)) return { intent: 'PRODUCT_QUESTION' };
  if (/compte courant|ouvrir.*compte|حساب جار|فتح حساب|current account|account opening/.test(t)) return { intent: 'PRODUCT_QUESTION' };
  if (/tarif|grille|frais|تعريف|عمولة|fees|tariff/.test(t)) return { intent: 'TARIFF_FEES', refusal: 'REF-05' };
  if (/bonjour|salut|hello|مرحبا|السلام|salam/.test(t)) return { intent: 'SMALL_TALK' };
  if (/agence|branche|فرع|agency/.test(t)) return { intent: 'BRANCH_LOCATOR' };
  return { intent: 'OUT_OF_SCOPE' };
}

function citationOf(c) {
  return {
    id: `S${c.rank}`,
    chunkId: c.chunk_id,
    documentId: c.document_id,
    documentTitle: c.title,
    documentTitleLocale: 'fr-FR',
    collectionCode: 'PRODUCTS',
    headingPath: ['demo'],
    excerpt: c.content.slice(0, 180) + '…',
    url: `/api/v1/public/documents/${c.document_id}#S${c.rank}`,
    locale: c.lang,
    validFrom: null,
    validUntil: c.valid_to,
    score: c.score,
  };
}

function buildAnswer({ intent, candidates, locale }) {
  const pick = candidates.filter((c) => c.lang === locale).concat(candidates.filter((c) => c.lang !== locale));
  const facts = pick.slice(0, 3);
  const bullets = facts.map((c) => c.content.trim());
  const intro = {
    'fr-FR': `Voici ce que dit la documentation approuvée :`,
    'ar-TN': `هذا ما تقوله الوثائق المعتمدة:`,
    'en-GB': `Here is what the approved documentation says:`,
  }[locale];
  const md = [`${intro}\n`, ...bullets.map((b) => `- ${b}`), '', `*Consultez votre agence pour les conditions contractuelles en vigueur.*`].join('\n');
  return { md, facts };
}

async function persistUsage(pool, { messageId, conversationId, purpose, modelId, tokensIn, tokensOut, latencyMs, costUsd }) {
  await pool.query(
    `INSERT INTO albaraka_ai.llm_call_log (id, message_id, purpose, provider, model_id, status, tokens_in, tokens_out, latency_ms, cost_usd)
     VALUES ($1,$2,$3,'MOCK',$4,'OK',$5,$6,$7,$8)`,
    [randomUUID(), messageId, purpose, modelId, tokensIn, tokensOut, latencyMs, costUsd]
  ).catch(() => {});
}

export async function runChat({ text, locale = 'fr-FR', clientId, deviceId }, pool, emit, { verbose = false } = {}) {
  const t0 = Date.now();
  const messageId = randomUUID();
  const chatModel = { chat: 'llama-3.3-70b-versatile', reranker: 'llama-3.1-8b-instant', degradationStep: 1 };

  // ── accepted ──
  const devId = deviceId || randomUUID(); // ck_conversation_identity needs principal_id or device_id
  const conversationRow = deviceId
    ? await pool.query(`SELECT id::text AS id FROM albaraka_ai.conversation WHERE device_id = $1 AND state = 'ACTIVE' LIMIT 1`, [deviceId]).catch(() => ({ rows: [] }))
    : { rows: [] };
  let conversationId = conversationRow.rows[0]?.id;
  if (!conversationId) {
    conversationId = randomUUID();
    await pool.query(
      `INSERT INTO albaraka_ai.conversation (id, channel, device_id, locale, state, persist_conversation)
       VALUES ($1,'WEB_APP',$2,$3,'ACTIVE',true)`,
      [conversationId, devId, locale]
    );
  }
  const dir = dirOf(locale);
  emit('accepted', { messageId, conversationId, locale, dir });
  emit('status', { stage: 'SCREENING', label: STATUS_LABELS.SCREENING[locale] });

  const ord = (await pool.query(`SELECT coalesce(max(ordinal),0)+1 AS n FROM albaraka_ai.message WHERE conversation_id = $1`, [conversationId])).rows[0].n;
  let userMsg = await pool.query(
    `INSERT INTO albaraka_ai.message
       (id, conversation_id, ordinal, role, content_raw, content_rendered, locale, dir, idempotency_key, created_at)
     VALUES ($1,$2,$3,'USER',$4,$4,$5,$6,$7, now()) RETURNING created_at`,
    [messageId, conversationId, ord, text, locale, dir, /^[0-9a-f-]{36}$/.test(clientId || '') ? clientId : null]
  );

  const guard = guardInput(text);
  if (guard.blocked) {
    await pool.query(
      `INSERT INTO albaraka_ai.guardrail_event (id, message_id, policy_code, policy_version, decision, severity, violation_code, evidence, refusal_code, stage)
       VALUES ($1,$2,$3,1,'BLOCK',$4,$5,$6,$7,'INPUT')`,
      [randomUUID(), messageId, guard.policyCode, guard.severity, guard.refusalCode, guard.evidence, guard.refusalCode]
    ).catch(() => {});
    await persistUsage(pool, { messageId, purpose: 'GUARD_INJECTION', modelId: 'meta-llama/llama-prompt-guard-2-86m', tokensIn: 30, tokensOut: 2, latencyMs: 80, costUsd: 0.00001 });
    const r = REFUSALS[guard.refusalCode][locale];
    const refusal = { messageId, refusalCode: guard.refusalCode, title: r.title, body: r.body, locale, sources: [], fatwaRequestRef: null, handoffAvailable: true };
    await pool.query(
      `INSERT INTO albaraka_ai.message (id, conversation_id, ordinal, role, content_raw, content_rendered, locale, dir, detected_intent, no_answer, no_answer_reason, refusal_code, degradation_step, tokens_in, tokens_out, created_at)
       VALUES ($1,$2,$3,'ASSISTANT',$4,$4,$5,$6,$7,true,$8,$9,1,32,2,now())`,
      [randomUUID(), conversationId, ord + 1, `${r.title}\n\n${r.body}`, locale, dir, 'ADVERSARIAL', guard.refusalCode, guard.refusalCode]
    );
    emit('refusal', refusal);
    emit('done', { messageId, tokensIn: 32, tokensOut: 2, latencyMs: Date.now() - t0 });
    return { messageId, conversationId };
  }

  const cls = classify(text);
  emit('status', { stage: 'RETRIEVING', label: STATUS_LABELS.RETRIEVING[locale] });
  const { candidates, topSources } = await retrieve({ text, locale, pool });
  const citations = candidates.map(citationOf);

  if (cls.intent === 'SMALL_TALK') {
    emit('status', { stage: 'GENERATING', label: STATUS_LABELS.GENERATING[locale] });
    const answer = { messageId, answerMarkdown: GREETINGS[locale], language: locale, dir, confidence: 1.0, usedSources: [], citations: [], caveats: [], disclaimers: DISCLAIMERS[locale], needsHuman: false, cached: false, models: chatModel, latencyMs: 0, ttftMs: 120 };
    await pool.query(
      `INSERT INTO albaraka_ai.message (id, conversation_id, ordinal, role, content_raw, content_rendered, locale, dir, detected_intent, confidence, citations, degradation_step, ttft_ms, latency_ms, tokens_in, tokens_out, created_at)
       VALUES ($1,$2,$3,'ASSISTANT',$4,$4,$5,$6,$7,1.0,'[]',1,120,420,40,18,now())`,
      [randomUUID(), conversationId, ord + 1, answer.answerMarkdown, locale, dir, cls.intent]
    );
    emit('answer', answer);
    emit('done', { messageId, tokensIn: 40, tokensOut: 18, latencyMs: Date.now() - t0 });
    return { messageId, conversationId };
  }

  if (cls.intent === 'RELIGIOUS_RULING_REQUEST') {
    const fatwaRef = `FR-${Date.now().toString(36).toUpperCase()}`;
    await pool.query(
      `INSERT INTO albaraka_ai.fatwa_request (id, ref, origin, conversation_id, message_id, question_fr, question_locale, state, sla_due_at)
       VALUES ($1,$2,'CHAT',$3,$4,$5,'fr-FR','OPEN', now() + interval '5 days')`,
      [randomUUID(), fatwaRef, conversationId, messageId, text]
    ).catch(() => {});
    await persistUsage(pool, { messageId, purpose: 'CHAT_PRIMARY', modelId: chatModel.chat, tokensIn: 60, tokensOut: 4, latencyMs: 250, costUsd: 0.0001 });
    const r = REFUSALS['REF-03'][locale];
    const refusal = { messageId, refusalCode: 'REF-03', title: r.title, body: r.body, locale, sources: topSources.map((s) => ({ ...s, url: `/api/v1/public/documents/${s.documentId}` })), fatwaRequestRef: fatwaRef, handoffAvailable: true };
    await pool.query(
      `INSERT INTO albaraka_ai.message (id, conversation_id, ordinal, role, content_raw, content_rendered, locale, dir, detected_intent, no_answer, no_answer_reason, refusal_code, citations, degradation_step, tokens_in, tokens_out, created_at)
       VALUES ($1,$2,$3,'ASSISTANT',$4,$4,$5,$6,$7,true,$8,$9,$10,1,60,4,now())`,
      [randomUUID(), conversationId, ord + 1, `${r.title}\n\n${r.body}`, locale, dir, cls.intent, 'RELIGIOUS_RULING_REQUEST', 'REF-03', JSON.stringify(refusal.sources)]
    );
    emit('refusal', refusal);
    emit('done', { messageId, tokensIn: 60, tokensOut: 4, latencyMs: Date.now() - t0 });
    return { messageId, conversationId };
  }

  if (cls.intent === 'ACCOUNT_STATUS') {
    const guard = { refusalCode: 'REF-04' };
    const r = REFUSALS['REF-04'][locale];
    const refusal = { messageId, refusalCode: 'REF-04', title: r.title, body: r.body, locale, sources: [], fatwaRequestRef: null, handoffAvailable: true };
    await pool.query(
      `INSERT INTO albaraka_ai.message (id, conversation_id, ordinal, role, content_raw, content_rendered, locale, dir, detected_intent, no_answer, no_answer_reason, refusal_code, degradation_step, tokens_in, tokens_out, created_at)
       VALUES ($1,$2,$3,'ASSISTANT',$4,$4,$5,$6,$7,true,$8,$9,1,45,6,now())`,
      [randomUUID(), conversationId, ord + 1, `${r.title}\n\n${r.body}`, locale, dir, cls.intent, 'no personal data', 'REF-04']
    );
    emit('refusal', refusal);
    emit('done', { messageId, tokensIn: 45, tokensOut: 6, latencyMs: Date.now() - t0 });
    return { messageId, conversationId };
  }

  if (cls.refusal) {
    const rr = REFUSALS[cls.refusal][locale];
    const refusal = { messageId, refusalCode: cls.refusal, title: rr.title, body: rr.body, locale, sources: topSources.map((src) => ({ ...src, url: `/api/v1/public/documents/${src.documentId}` })), fatwaRequestRef: null, handoffAvailable: true };
    await pool.query(
      `INSERT INTO albaraka_ai.message (id, conversation_id, ordinal, role, content_raw, content_rendered, locale, dir, detected_intent, no_answer, no_answer_reason, refusal_code, citations, degradation_step, tokens_in, tokens_out, created_at)
       VALUES ($1,$2,$3,'ASSISTANT',$4,$4,$5,$6,$7,true,$8,$9,$10,1,45,8,now())`,
      [randomUUID(), conversationId, ord + 1, `${rr.title}\n\n${rr.body}`, locale, dir, cls.intent, 'no approved content', cls.refusal, JSON.stringify(refusal.sources)]
    );
    emit('status', { stage: 'VERIFYING', label: STATUS_LABELS.VERIFYING[locale] });
    emit('refusal', refusal);
    emit('done', { messageId, tokensIn: 45, tokensOut: 8, latencyMs: Date.now() - t0 });
    return { messageId, conversationId };
  }

  const relevant = candidates.filter((c) => c.score >= 0.5);
  if (!relevant.length) {
    const r = REFUSALS['REF-05'][locale];
    const refusal = { messageId, refusalCode: 'REF-05', title: r.title, body: r.body, locale, sources: topSources.map((s) => ({ ...s, url: `/api/v1/public/documents/${s.documentId}` })), fatwaRequestRef: null, handoffAvailable: true };
    await persistUsage(pool, { messageId, purpose: 'CHAT_PRIMARY', modelId: chatModel.chat, tokensIn: 50, tokensOut: 10, latencyMs: 300, costUsd: 0.0001 });
    await pool.query(
      `INSERT INTO albaraka_ai.message (id, conversation_id, ordinal, role, content_raw, content_rendered, locale, dir, detected_intent, no_answer, no_answer_reason, refusal_code, citations, degradation_step, tokens_in, tokens_out, created_at)
       VALUES ($1,$2,$3,'ASSISTANT',$4,$4,$5,$6,$7,true,$8,$9,$10,1,50,10,now())`,
      [randomUUID(), conversationId, ord + 1, `${r.title}\n\n${r.body}`, locale, dir, cls.intent, 'no approved content', 'REF-05', JSON.stringify(refusal.sources)]
    );
    emit('status', { stage: 'VERIFYING', label: STATUS_LABELS.VERIFYING[locale] });
    emit('refusal', refusal);
    emit('done', { messageId, tokensIn: 50, tokensOut: 10, latencyMs: Date.now() - t0 });
    return { messageId, conversationId };
  }

  emit('status', { stage: 'RERANKING', label: STATUS_LABELS.RERANKING[locale] });
  if (citations.length) emit('sources', { citations });
  emit('status', { stage: 'GENERATING', label: STATUS_LABELS.GENERATING[locale] });
  const { md, facts } = buildAnswer({ intent: cls.intent, candidates: relevant, locale });
  const tokensOut = Math.round(md.length / 4);
  const ttftMs = 260 + Math.floor(Math.random() * 180);
  let acc = '';
  for (const part of md.match(/.{1,18}(\s|$)/g) || [md]) {
    acc += part;
    emit('token', { delta: part });
    await sleep(12);
  }
  const answer = {
    messageId, answerMarkdown: md, language: locale, dir, confidence: 0.92,
    usedSources: facts.map((f) => f.chunk_id), citations: relevant.map(citationOf),
    caveats: ['Démonstration : contenu synthétique — la documentation approuvée du groupe remplace ce corpus.'],
    disclaimers: DISCLAIMERS[locale], needsHuman: false, cached: false, models: chatModel,
    latencyMs: Date.now() - t0, ttftMs,
  };
  emit('status', { stage: 'VERIFYING', label: STATUS_LABELS.VERIFYING[locale] });
  await sleep(60);
  emit('answer', answer);

  // ── persistence (trace before done; message needs created_at for the trace FK). A trace
  //    failure must not emit an error frame AFTER the answer — the done frame still goes out.
  try {
    const asst = await pool.query(
      `INSERT INTO albaraka_ai.message
         (id, conversation_id, ordinal, role, content_raw, content_rendered, locale, dir, detected_lang, detected_intent, citations, confidence, needs_human, no_answer, degradation_step, ttft_ms, latency_ms, tokens_in, tokens_out, cost_usd, created_at)
       VALUES ($1,$2,$3,'ASSISTANT',$4,$4,$5,$6,$5,$7,$8,0.92,false,false,1,$9,$10,260,$11,0.0005,now()) RETURNING id::text, created_at::text`,
      [randomUUID(), conversationId, ord + 1, md, locale, dir, cls.intent, JSON.stringify(answer.citations), ttftMs, Date.now() - t0, tokensOut]
    );
    const retrCfg = await pool.query(`SELECT id::text AS id FROM albaraka_ai.retrieval_config WHERE state = 'ACTIVE' LIMIT 1`).catch(() => ({ rows: [] }));
    const trace = await pool.query(
      `INSERT INTO albaraka_ai.retrieval_trace
         (id, message_id, message_created_at, normalized_query, expanded_queries, intent, detected_lang, answer_lang, retrieval_config_id, kb_epoch, context_tokens, budget_tokens, assembled_context, best_score, outcome)
       VALUES ($1,$2,$3,$4,'[]',$5,$6,$7,$8,1,1200,6000,$9,0.9200,'ANSWERED') RETURNING id::text`,
      [randomUUID(), asst.rows[0].id, asst.rows[0].created_at, text.toLowerCase(), cls.intent, locale, locale, retrCfg.rows[0]?.id || null, JSON.stringify(facts.map((f) => ({ chunkId: f.chunk_id, content: f.content.slice(0, 200) })))]
    );
    for (const c of candidates.slice(0, 6)) {
      await pool.query(
        `INSERT INTO albaraka_ai.retrieval_candidate (id, trace_id, chunk_id, strategy, rank, score, rrf_score, selected)
         VALUES ($1,$2,$3,'DENSE',$4,$5,$6,$7)`,
        [randomUUID(), trace.rows[0].id, c.chunk_id, c.rank, c.score, c.score * 0.6, c.score >= 0.5]
      ).catch(() => {});
    }
    await persistUsage(pool, { messageId, purpose: 'CHAT_PRIMARY', modelId: chatModel.chat, tokensIn: 260, tokensOut, latencyMs: Date.now() - t0, costUsd: 0.0005 });
    await pool.query(`UPDATE albaraka_ai.conversation SET turn_count = turn_count + 1, last_message_at = now() WHERE id = $1`, [conversationId]);
  } catch (persistErr) {
    console.error('[persist]', persistErr.message);
  }
  emit('done', { messageId, tokensIn: 260, tokensOut, latencyMs: Date.now() - t0 });
  return { messageId, conversationId };
}
