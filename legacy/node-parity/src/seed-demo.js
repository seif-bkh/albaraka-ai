/**
 * seed-demo.js — DEMO knowledge base (replace with the bank's approved documentation).
 *
 * Synthetic, trilingual, clearly-labelled demo content that makes the full pipeline demonstrable
 * before the real KB is uploaded. Exercises the Sharia gate: published documents have searchable
 * chunks (published + sharia_approved + embedded + valid), the quarantined document is NOT
 * searchable, the draft is unreachable, and the in-review document shows the review workflow.
 * The UI must always label this content as demonstration data.
 */
const COLLECTION = '11111111-1111-4111-8111-000000000001';

const DOCS = [
  {
    id: '22222222-2222-4222-8222-000000000001',
    version: '33333333-3333-4333-8333-000000000001',
    title_fr: 'Ouverture d’un compte courant', title_ar: 'فتح حساب جارٍ', title_en: 'Opening a current account',
    body_fr: `L'ouverture d'un compte courant en dinars à Al Baraka Bank Tunisia se fait en agence pour les particuliers majeurs. Pièces requises : pièce d'identité nationale en cours de validité, extrait d'acte de naissance, justificatif de domicile de moins de trois mois et, pour certains produits, justificatif de revenus. Le fonctionnement respecte les normes de la finance islamique : le dépôt courant est un dépôt en garantie (qard) sans intérêt ; les opérations sont facturées selon la grille tarifaire en vigueur. La carte bancaire et le service de banque en ligne sont activés après signature de la convention de compte. Le délai moyen d'activation est de deux jours ouvrés après remise du dossier complet.`,
    chunks: [
      { ord: 1, lang: 'fr-FR', content: `L'ouverture d'un compte courant en dinars se fait en agence pour les particuliers majeurs résidents. La remise du dossier complet (pièce d'identité, extrait de naissance, justificatif de domicile de moins de trois mois) est suivie d'une activation sous deux jours ouvrés. Les opérations respectent la finance islamique : le dépôt courant est un dépôt en garantie sans intérêt, et la grille tarifaire en vigueur s'applique.` },
      { ord: 2, lang: 'fr-FR', content: `La carte bancaire et l'application de banque en ligne sont activées à la signature de la convention de compte. Les services disponibles comprennent le virement, le relevé en ligne et le paiement de factures. Aucun montant minimal d'ouverture n'est exigé pour le compte courant standard.` },
      { ord: 3, lang: 'ar-TN', content: `يُفتح الحساب الجاري بالدينار في الوكالة للبالغين المقيمين. بعد تسليم الملف الكامل (بطاقة هوية، مضمون الحالة المدنية، إثبات سكن حديث) يتم التفعيل خلال يومين عمل. العملية وفق أحكام الشريعة: الوديعة الجارية وديعة ضمان دون فائدة، وتُطبق التعريفة الجارية. يُفعَّل البنك عن بُعد والبطاقة عند توقيع اتفاقية الحساب.` },
      { ord: 4, lang: 'en-GB', content: `A dinar current account is opened in branch for resident adults. A complete file (ID card, birth certificate extract, proof of address under three months) leads to activation within two working days. Operations follow Islamic finance: the current deposit is a guarantee deposit without interest, and the applicable tariff schedule applies. The bank card and online banking activate on account agreement signature.` },
    ],
  },
  {
    id: '22222222-2222-4222-8222-000000000002',
    version: '33333333-3333-4333-8333-000000000002',
    title_fr: 'Rachat de crédit et regroupement', title_ar: 'إعادة تمويل القروض وتجميعها', title_en: 'Debt consolidation (credit buy-back)',
    body_fr: `Le rachat de crédit permet de regrouper plusieurs financements en cours dans une seule facilité, selon le principe de la murabaha. Les crédits éligibles : crédit immobilier, crédit véhicule et consommation. Conditions : au moins deux crédits en cours, revenus réguliers et dossier complet. Le montant et la durée sont définis après étude du dossier ; la banque acquiert l'échéancier restant et le client rembourse selon un calendrier convenu, la marge étant fixée à la conclusion. L'étude est gratuite et sans engagement.`,
    chunks: [
      { ord: 1, lang: 'fr-FR', content: `Le rachat de crédit regroupe plusieurs financements en cours (immobilier, véhicule, consommation) dans une seule facilité selon la murabaha. L'étude du dossier est gratuite et sans engagement ; le montant, la durée et la marge sont fixés à la conclusion. Les crédits concernés doivent être en cours et le dossier complet (pièce d'identité, justificatifs de revenus, tableau d'amortissement).` },
      { ord: 2, lang: 'ar-TN', content: `تجمع إعادة التمويل عدة قروض جارية (عقارية، سيارة، استهلاك) في تسهيل واحد وفق المرابحة. دراسة الملف مجانية وغير ملزمة، ويُحدَّد المبلغ والمدة والهامش عند التعاقد. يجب أن تكون القروض جارية والملف كاملا.` },
      { ord: 3, lang: 'en-GB', content: `Debt consolidation groups several running loans (mortgage, vehicle, consumer) into one facility under murabaha. The file assessment is free and non-binding; amount, term and margin are set at contract conclusion. Loan schedules and proof of income complete the file.` },
    ],
  },
  {
    id: '22222222-2222-4222-8222-000000000003',
    version: '33333333-3333-4333-8333-000000000003',
    title_fr: 'Grille tarifaire 2023 (retirée)', title_ar: 'تعريفية 2023 (مسحوبة)', title_en: '2023 tariff schedule (withdrawn)',
    quarantine: true, quarantine_reason: 'Tarifs obsolètes — retenue pour audit seulement.',
    body_fr: `(Contenu historique) Les frais de tenue de compte s'élevaient à 0,500 DT par mois en 2023...`,
    chunks: [
      { ord: 1, lang: 'fr-FR', content: `Grille 2023 : frais de tenue de compte 0,500 DT/mois ; carte 12 DT/an ; virement 0,200 DT.` },
      { ord: 1, lang: 'ar-TN', content: `تعريفية 2023: عمولة الحساب 0,500 دينار شهريا؛ البطاقة 12 دينار سنويا؛ التحويل 0,200 دينار.` },
    ],
  },
  {
    id: '22222222-2222-4222-8222-000000000004',
    version: '33333333-3333-4333-8333-000000000004',
    title_fr: 'Financement véhicule (brouillon)', title_ar: 'تمويل سيارة (مسودة)', title_en: 'Vehicle financing (draft)',
    draft: true,
    body_fr: `Le financement d'un véhicule neuf ou d'occasion est proposé selon la murabaha. Conditions à confirmer par le comité...`,
    chunks: [
      { ord: 1, lang: 'fr-FR', content: `Financement véhicule selon murabaha : apport minimum et barème en cours de validation.` },
      { ord: 1, lang: 'ar-TN', content: `تمويل سيارة وفق المرابحة: المساهمة الدنيا والجدول قيد المصادقة.` },
    ],
  },
  {
    id: '22222222-2222-4222-8222-000000000005',
    version: '33333333-3333-4333-8333-000000000005',
    title_fr: 'Mise à jour tarifaire 2026', title_ar: 'تحديث التعريفية 2026', title_en: '2026 tariff update',
    inReview: true,
    body_fr: `La grille tarifaire 2026 remplace la grille précédente : tenue de compte gratuite pour les comptes actifs, carte gratuite la première année, virement en ligne gratuit... (à confirmer par le comité).`,
    chunks: [
      { ord: 1, lang: 'fr-FR', content: `Grille 2026 : tenue de compte gratuite pour les comptes actifs ; carte gratuite la première année ; virements en ligne gratuits.` },
      { ord: 1, lang: 'ar-TN', content: `تعريفية 2026: إدارة الحساب مجانية للحسابات النشطة؛ البطاقة مجانية في السنة الأولى؛ التحويلات عن بُعد مجانية.` },
    ],
  },
];

const sha = (t) => Buffer.from(t).toString('base64url');
let chunkOrd = 0;
const cid = () => `44444444-4444-4444-8444-${String(chunkOrd++).padStart(12, '0')}`;
let taskOrd = 0;
const tid = () => `66666666-6666-4666-8666-${String(taskOrd++).padStart(12, '0')}`;

export async function seedDemoKnowledgeBase(pool) {
  await pool.query(
    `INSERT INTO collection (id, code, name_fr, name_ar, name_en, default_audience, default_classification, default_risk_tier, chunking_policy)
     VALUES ($1, 'PRODUCTS', 'Produits & procédures', 'المنتجات والإجراءات', 'Products & procedures', 'PUBLIC', 'PUBLIC', 'T2_MEDIUM', 'GENERIC')
     ON CONFLICT (code) DO NOTHING`,
    [COLLECTION]
  );

  let chunks = 0;
  for (const doc of DOCS) {
    const finalState = doc.draft ? 'DRAFT' : doc.inReview ? 'IN_REVIEW' : 'PUBLISHED';
    await pool.query(
      `INSERT INTO document (id, collection_id, title_fr, title_ar, title_en, mime_type, source_lang, classification, audience, lifecycle_state, owner_role, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,'text/markdown','fr-FR','PUBLIC','PUBLIC',$6,'KB_EDITOR','demo:seed', now() - interval '3 days')
       ON CONFLICT (id) DO NOTHING`,
      [doc.id, COLLECTION, doc.title_fr, doc.title_ar, doc.title_en, doc.draft ? 'DRAFT' : doc.inReview ? 'IN_REVIEW' : 'DRAFT']
    );
    await pool.query(
      `INSERT INTO document_version (id, document_id, version_no, body_text, body_lang, state, chunking_policy, body_sha256, created_by, created_at)
       VALUES ($1,$2,1,$3,'fr-FR','DRAFT','GENERIC',$4,'demo:seed', now() - interval '2 days')
       ON CONFLICT (id) DO NOTHING`,
      [doc.version, doc.id, doc.body_fr, sha(doc.body_fr)]
    );
    if (finalState === 'PUBLISHED') {
      await pool.query(
        `UPDATE document_version SET state = 'PUBLISHED', published_at = now() - interval '2 days', published_by = 'demo:seed' WHERE id = $1`,
        [doc.version]
      );
      await pool.query(
        `UPDATE document SET current_version_id = $2, lifecycle_state = 'PUBLISHED', updated_by = 'demo:seed' WHERE id = $1`,
        [doc.id, doc.version]
      );
    }
    for (const ch of doc.chunks) {
      await pool.query(
        `INSERT INTO chunk
          (id, document_version_id, ordinal, content, heading_path, token_count, lang, is_translation, machine_translated, human_verified,
           normalized_text, audience, classification, published, sharia_approved, embedding_status, embedding_model, embedding_dim,
           content_sha256, quarantined, quarantine_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,true,$4,'PUBLIC','PUBLIC',$9,$9,'EMBEDDED','gemini-embedding-001',1536,$10,$11,$12)
         ON CONFLICT (id) DO NOTHING`,
        [cid(), doc.version, ch.ord, ch.content, ['demo'], Math.round(ch.content.length / 5),
         ch.lang, ch.lang !== "fr-FR", finalState === "PUBLISHED", sha(ch.content),
         Boolean(doc.quarantine), doc.quarantine ? doc.quarantine_reason : null]
      );
      chunks++;
    }
    if (doc.inReview) {
      const reviewId = '55555555-5555-4555-8555-000000000001';
      await pool.query(
        `INSERT INTO sharia_review
          (id, ref, subject_type, subject_id, subject_label, risk_tier, state, submitted_by, submitted_at, due_at)
         VALUES ($1,'demo-review-0001','DOCUMENT_VERSION',$2,'Mise à jour tarifaire 2026','T2_MEDIUM','IN_REVIEW','kb-editor@albaraka.tn', now() - interval '1 day', now() + interval '6 days')
         ON CONFLICT (id) DO NOTHING`,
        [reviewId, doc.version]
      );
      await pool.query(
        `UPDATE document_version SET sharia_review_id = $1 WHERE id = $2`,
        [reviewId, doc.version]
      );
      await pool.query(
        `INSERT INTO review_task (id, review_id, assignee_role, created_at) VALUES ($1,$2,'SHARIA_OFFICER', now()) ON CONFLICT (id) DO NOTHING`,
        [tid(), reviewId]
      );
      await pool.query(
        `INSERT INTO review_task (id, review_id, assignee_role, created_at) VALUES ($1,$2,'REVIEWER', now()) ON CONFLICT (id) DO NOTHING`,
        [tid(), reviewId]
      );
    }
  }

  return { docs: DOCS.length, chunks };
}
