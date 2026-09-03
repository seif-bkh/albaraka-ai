-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--  V902__seed_policies.sql — guardrail policies, refusal messages and runtime registers
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--  GENERATED FILE. Do not edit by hand.
--
--  Regenerate with:  node tools/seed-gen/generate.mjs
--  Staleness check:  node tools/seed-gen/generate.mjs --check     (runs in CI)
--
--  Sources of truth:
--   docs/07-security-iam-compliance.md §6.1   (the guardrail policy register: scope, severity, decision, tier, params path)
--   specs/config/application.yaml             (the params blocks the register names, resolved by path)
--   specs/prompts/templates.refusals.yaml     (refusal text in three locales, follow-up pools, disclaimers, per-code behaviour)
--   docs/glossary-trilingual.md §6            (the cross-cutting forbidden-rendering register)
--   specs/prompts/*.md                        (the prompt → model-role binding)
--   specs/db/schema.sql                       (guardrail_policy_code, guardrail_scope, guardrail_severity, guardrail_decision, risk_tier, locale_code)
--
--
-- params is resolved from application.yaml at generation time and stored with a _provenance member
-- naming the path it came from. A register that names a path which no longer exists fails the
-- build rather than seeding an empty policy.
-- 
-- The refusal each policy emits is checked against templates.refusals.yaml, and every refusal must
-- exist in all three locales. RATE_LIMIT is the one policy that emits an HTTP 429 instead of a
-- refusal, and LANGUAGE_CONSISTENCY the one that warns instead of blocking; both are argued in
-- docs/07 §6.1 rather than left as a surprise in the data.

--  Surrogate keys are UUIDv5 of the row's natural key under namespace a1ba4a4a-0000-5000-8000-000000000000,
--  so regeneration is byte-identical and a row has the same id in every environment.
--
--  Inserts are plain, not ON CONFLICT DO NOTHING: a Flyway versioned migration runs exactly once,
--  and a natural-key collision here means the source is wrong. Failing loudly at migrate time is
--  better than silently seeding one row fewer.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────

SET search_path TO albaraka_ai, public;

-- ── guardrail_policy ─────────────────────────────────────────────────────────────────────────────
-- 10 policies, one per member of guardrail_policy_code. Scope, severity, decision and tier
-- come from the docs/07 §6.1 register; params is the application.yaml block that register names,
-- resolved at generation time and stored with its provenance, so the seeded policy and the configured
-- thresholds cannot disagree.
--
-- All seeded state = 'DRAFT'. Enabling a guardrail is a governance act, and so is weakening one:
-- lowering a CRITICAL policy from BLOCK is a T3 change needing the two-eyes quorum of docs/05 §4.
--
-- NOT seeded here, deliberately: model_config and retrieval_config belong to
-- SeedOnEmptyDatabaseRunner, which reads albaraka.seed from application.yaml on an empty database
-- (specs/config/README). Two writers for one row is two truths.
INSERT INTO guardrail_policy (id, code, version_no, applies_to, severity, decision_on_hit, enabled, params, risk_tier, state, created_by) VALUES
  ('1136c3dd-54df-52e0-9e02-b941190535f0', 'INJECTION', 1, 'INPUT', 'CRITICAL', 'BLOCK', true, '{"enabled":true,"block-above":0.85,"review-above":0.5,"_provenance":{"register":"docs/07 §6.1","paramsPath":"albaraka.guardrails.input.prompt-guard","catches":"Direct prompt injection, jailbreaks, attempts to extract the system prompt","emits":"REF-01"},"refusalCode":"REF-01"}'::jsonb, 'T3_HIGH', 'DRAFT', 'flyway:V902__seed_policies'),
  ('6a9aa057-84e9-5ef6-a18d-71eacb55ec94', 'PROHIBITED_TOPICS', 1, 'INPUT', 'CRITICAL', 'BLOCK', true, '{"enabled":true,"source":"term_glossary","_provenance":{"register":"docs/07 §6.1","paramsPath":"albaraka.guardrails.output.forbidden-renderings","catches":"A request for a riba-based product, a prohibited sector, maysir or gharar","emits":"REF-02"},"refusalCode":"REF-02"}'::jsonb, 'T3_HIGH', 'DRAFT', 'flyway:V902__seed_policies'),
  ('0897e2bd-dc4d-5a98-925f-aeacb9dee940', 'NO_FATWA', 1, 'BOTH', 'CRITICAL', 'BLOCK', true, '{"enabled":true,"autonomy":"${SHARIA_JUDGE_AUTONOMY:true}","retry-timeout-ms":300,"on-unavailable":"REFUSE","_provenance":{"register":"docs/07 §6.1","paramsPath":"albaraka.guardrails.output.sharia-judge","catches":"The answer rules on permissibility, implies a ruling, or concedes a religious premise","emits":"REF-03"},"refusalCode":"REF-03"}'::jsonb, 'T3_HIGH', 'DRAFT', 'flyway:V902__seed_policies');
INSERT INTO guardrail_policy (id, code, version_no, applies_to, severity, decision_on_hit, enabled, params, risk_tier, state, created_by) VALUES
  ('59b8e16f-2584-5c49-994b-881e283a0637', 'PII_EGRESS', 1, 'BOTH', 'CRITICAL', 'BLOCK', true, '{"mode":"TOKENIZE","reversible":true,"fail-closed":true,"_provenance":{"register":"docs/07 §6.1","paramsPath":"albaraka.egress.pii","catches":"Personal data entering an utterance, or leaving in a provider payload","emits":"REF-04"},"refusalCode":"REF-04"}'::jsonb, 'T3_HIGH', 'DRAFT', 'flyway:V902__seed_policies'),
  ('5e70a783-293f-5230-ac6c-5a5260c8fe9c', 'NUMERIC_CLAIMS', 1, 'OUTPUT', 'CRITICAL', 'BLOCK', true, '{"enabled":true,"strict-for-intents":["TARIFF_FEES"],"normalise-thousands-separators":true,"normalise-currency-aliases":true,"_provenance":{"register":"docs/07 §6.1","paramsPath":"albaraka.guardrails.output.numeric-claims","catches":"A fee, rate, margin, duration or threshold not present verbatim in a cited source","emits":"REF-05"},"refusalCode":"REF-05"}'::jsonb, 'T3_HIGH', 'DRAFT', 'flyway:V902__seed_policies'),
  ('b9fb2b12-ba9e-519f-96cc-8584fd9bc746', 'OUTPUT_TOXICITY', 1, 'OUTPUT', 'HIGH', 'BLOCK', true, '{"enabled":true,"categories":["violence","sexual","hate","self-harm","illicit"],"_provenance":{"register":"docs/07 §6.1","paramsPath":"albaraka.guardrails.input.llama-guard","catches":"Abusive, hateful, sectarian or violent model output","emits":"REF-01"},"refusalCode":"REF-01"}'::jsonb, 'T2_MEDIUM', 'DRAFT', 'flyway:V902__seed_policies');
INSERT INTO guardrail_policy (id, code, version_no, applies_to, severity, decision_on_hit, enabled, params, risk_tier, state, created_by) VALUES
  ('4a39181e-b3a1-5897-8527-293ae64c27a7', 'HALLUCINATED_ENTITIES', 1, 'OUTPUT', 'HIGH', 'BLOCK', true, '{"enabled":true,"require-marker-on-factual-sentence":true,"_provenance":{"register":"docs/07 §6.1","paramsPath":"albaraka.guardrails.output.citation-integrity","catches":"A product, agency, document or citation marker that does not exist in the served context","emits":"REF-05"},"refusalCode":"REF-05"}'::jsonb, 'T2_MEDIUM', 'DRAFT', 'flyway:V902__seed_policies'),
  ('c16d369e-ba33-5874-9f2b-a58b2efaa1e2', 'LANGUAGE_CONSISTENCY', 1, 'OUTPUT', 'MEDIUM', 'WARN', true, '{"enabled":true,"detector":"fasttext","min-confidence":0.8,"_provenance":{"register":"docs/07 §6.1","paramsPath":"albaraka.guardrails.output.language-consistency","catches":"An answer whose language is not the question''s language","emits":"— (event only)"}}'::jsonb, 'T1_LOW', 'DRAFT', 'flyway:V902__seed_policies'),
  ('c6d4e400-341e-5d0c-abc2-9c915a43574c', 'RATE_LIMIT', 1, 'INPUT', 'MEDIUM', 'BLOCK', true, '{"backend":"redis","anonymous":{"per-minute":8,"per-day":60,"burst":12},"authenticated":{"per-minute":20,"per-day":400,"burst":30},"agent":{"per-minute":40,"per-day":2000},"strikes":{"adversarial-before-cooldown":3,"cooldown-minutes":30,"device-ban-after":10},"_provenance":{"register":"docs/07 §6.1","paramsPath":"albaraka.ratelimit","catches":"Volume abuse: per-IP, per-device and per-principal buckets","emits":"429 `RATE_LIMIT.EXCEEDED`"}}'::jsonb, 'T1_LOW', 'DRAFT', 'flyway:V902__seed_policies');
INSERT INTO guardrail_policy (id, code, version_no, applies_to, severity, decision_on_hit, enabled, params, risk_tier, state, created_by) VALUES
  ('f9408109-739b-55e1-a2a0-3c71a0133885', 'MAX_TURNS', 1, 'INPUT', 'LOW', 'BLOCK', true, '{"temperature":0.2,"max-tokens-answer":700,"answer-word-limit":220,"semantic-cache-similarity":0.95,"max-turns-per-conversation":20,"_provenance":{"register":"docs/07 §6.1","paramsPath":"albaraka.seed.generation","catches":"Conversation-length abuse and scripted probing","emits":"REF-01"},"refusalCode":"REF-01"}'::jsonb, 'T1_LOW', 'DRAFT', 'flyway:V902__seed_policies');

-- ── message_bundle ───────────────────────────────────────────────────────────────────────────────
-- 99 rows. Key convention: refusal.<CODE>.<title|body|cta>, followup.<POOL>.<n>,
-- disclaimer.<ID>. Every refusal carries all 3 locales — the generator fails if one is missing,
-- because a customer refused in a language they did not ask in has been refused twice.
-- RELATED_QUESTIONS is not seeded: it is filled at runtime with the titles of retrieved sources that
-- scored below the relevance threshold, and an empty pool is the correct result when retrieval
-- returned nothing.
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-01.title', 'fr-FR', 'Je ne peux pas traiter cette demande'),
  ('refusal.REF-01.body', 'fr-FR', 'Je suis {{assistant_name}}, l''assistant de {{bank_name}}. Je réponds aux questions sur nos produits et services de finance participative, nos procédures et nos tarifs. Cette demande sort de ce cadre, je ne peux donc pas y répondre. Posez-moi une question sur la banque et je vous aiderai volontiers.'),
  ('refusal.REF-01.title', 'ar-TN', 'لا يمكنني تلبية هذا الطلب'),
  ('refusal.REF-01.body', 'ar-TN', 'أنا {{assistant_name}}، المساعد الافتراضي لـ{{bank_name}}. أختصّ بالإجابة عن أسئلتكم حول منتجاتنا وخدماتنا في المالية التشاركية، وإجراءاتنا، وتعريفتنا البنكية. وهذا الطلب يخرج عن ذلك الإطار، لذا لا يمكنني الإجابة عنه. اطرحوا عليّ سؤالا يتعلّق بالبنك وسأكون سعيدا بمساعدتكم.'),
  ('refusal.REF-01.title', 'en-GB', 'I can''t help with that request'),
  ('refusal.REF-01.body', 'en-GB', 'I''m {{assistant_name}}, the assistant for {{bank_name}}. I answer questions about our participatory finance products and services, our procedures and our tariffs. This request falls outside that scope, so I''m not able to answer it. Ask me something about the bank and I''ll be glad to help.');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-02.title', 'fr-FR', 'Ce type d''opération n''est pas proposé'),
  ('refusal.REF-02.body', 'fr-FR', '{{bank_name}} exerce selon les normes bancaires islamiques et ne propose pas d''opération fondée sur l''intérêt. {{alternative_block}} Si vous me décrivez votre projet — achat d''un véhicule, d''un logement, équipement professionnel — je peux vous présenter le financement participatif qui y correspond.'),
  ('refusal.REF-02.cta', 'fr-FR', 'Voir nos financements'),
  ('refusal.REF-02.title', 'ar-TN', 'هذا النوع من العمليات غير متوفّر'),
  ('refusal.REF-02.body', 'ar-TN', 'يزاول {{bank_name}} نشاطه وفقا للمعايير المصرفية الإسلامية، ولا يقدّم عمليات قائمة على الفائدة. {{alternative_block}} وإن وصفتم لي مشروعكم — اقتناء سيّارة، أو مسكن، أو تجهيزات مهنية — أمكنني أن أعرض عليكم التمويل التشاركي الموافق له.'),
  ('refusal.REF-02.cta', 'ar-TN', 'اطّلعوا على تمويلاتنا');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-02.title', 'en-GB', 'We don''t offer that type of operation'),
  ('refusal.REF-02.body', 'en-GB', '{{bank_name}} operates in accordance with Islamic banking standards and does not offer interest-based operations. {{alternative_block}} If you describe your project — a vehicle, a home, business equipment — I can show you the participatory financing that corresponds to it.'),
  ('refusal.REF-02.cta', 'en-GB', 'See our financing options'),
  ('refusal.REF-02.followup.1', 'fr-FR', 'Comment fonctionne la Mourabaha ?'),
  ('refusal.REF-02.followup.2', 'fr-FR', 'Quels financements proposez-vous aux professionnels ?'),
  ('refusal.REF-02.followup.3', 'fr-FR', 'Quelles pièces pour un dossier de financement ?');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-02.followup.1', 'ar-TN', 'كيف تعمل المرابحة؟'),
  ('refusal.REF-02.followup.2', 'ar-TN', 'ما التمويلات التي تقترحونها على أصحاب المهن؟'),
  ('refusal.REF-02.followup.3', 'ar-TN', 'ما الوثائق المطلوبة لتكوين ملف تمويل؟'),
  ('refusal.REF-02.followup.1', 'en-GB', 'How does Murabaha work?'),
  ('refusal.REF-02.followup.2', 'en-GB', 'What financing do you offer to businesses?'),
  ('refusal.REF-02.followup.3', 'en-GB', 'Which documents does a financing application need?');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-03.title', 'fr-FR', 'Je ne peux pas prononcer d''avis religieux'),
  ('refusal.REF-03.body', 'fr-FR', 'Votre question appelle un avis religieux. Or je ne suis pas habilité à en prononcer : je rapporte ce que disent les documents approuvés de {{bank_name}}, et la conformité de nos opérations est contrôlée par le {{committee_name}}. {{documentation_block}} Je peux transmettre votre question au Comité : un membre vous répondra.'),
  ('refusal.REF-03.cta', 'fr-FR', '{{referral_cta}}'),
  ('refusal.REF-03.title', 'ar-TN', 'لا يمكنني إصدار رأي شرعي'),
  ('refusal.REF-03.body', 'ar-TN', 'سؤالكم يتطلّب رأيا شرعيا، ولست مخوّلا بإصداره. فمهمّتي أن أنقل ما تنصّ عليه وثائق {{bank_name}} المعتمدة، ويتولّى {{committee_name}} مراقبة مطابقة عمليات البنك. {{documentation_block}} ويمكنني إحالة سؤالكم إلى اللجنة ليجيبكم أحد أعضائها.'),
  ('refusal.REF-03.cta', 'ar-TN', '{{referral_cta}}');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-03.title', 'en-GB', 'I can''t issue a religious ruling'),
  ('refusal.REF-03.body', 'en-GB', 'Your question calls for a religious ruling, and I''m not authorised to give one. I report what the approved documentation of {{bank_name}} states, and the conformity of our operations is overseen by the {{committee_name}}. {{documentation_block}} I can forward your question to the Committee and a member will answer you.'),
  ('refusal.REF-03.cta', 'en-GB', '{{referral_cta}}'),
  ('refusal.REF-04.title', 'fr-FR', 'Je n''ai pas accès à vos comptes'),
  ('refusal.REF-04.body', 'fr-FR', 'Je ne suis pas connecté à vos comptes : je ne peux consulter ni solde, ni relevé, ni état d''un dossier. Pour cela, contactez {{handoff_channel}}. Merci aussi de ne pas communiquer ici de numéro de compte, de carte, de pièce d''identité ou de code personnel : cette conversation n''est pas un canal sécurisé pour ces informations.'),
  ('refusal.REF-04.cta', 'fr-FR', '{{handoff_cta}}');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-04.title', 'ar-TN', 'لا أملك نفاذا إلى حساباتكم'),
  ('refusal.REF-04.body', 'ar-TN', 'لست متّصلا بحساباتكم، فلا يمكنني الاطّلاع على أي رصيد أو كشف عمليات أو حالة أي ملف. ولقضاء هذا الشأن، يرجى الاتصال بـ{{handoff_channel}}. ونرجو منكم أيضا ألاّ تدلوا هنا برقم حساب أو بطاقة أو بطاقة تعريف أو رمز سرّي: فهذه المحادثة ليست قناة مأمونة لمثل هذه المعطيات.'),
  ('refusal.REF-04.cta', 'ar-TN', '{{handoff_cta}}'),
  ('refusal.REF-04.title', 'en-GB', 'I don''t have access to your accounts'),
  ('refusal.REF-04.body', 'en-GB', 'I''m not connected to your accounts: I can''t view a balance, a statement or the status of an application. For that, please contact {{handoff_channel}}. Please also don''t share an account number, card number, ID number or personal code here — this conversation is not a secure channel for that information.'),
  ('refusal.REF-04.cta', 'en-GB', '{{handoff_cta}}');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-05.title', 'fr-FR', 'Je n''ai pas de réponse fiable'),
  ('refusal.REF-05.body', 'fr-FR', 'Cette information ne figure pas dans les documents approuvés auxquels j''ai accès, et je préfère vous le dire plutôt que vous répondre approximativement. {{top_sources}} Un conseiller peut vous répondre précisément : {{handoff_cta}}.'),
  ('refusal.REF-05.cta', 'fr-FR', '{{handoff_cta}}'),
  ('refusal.REF-05.title', 'ar-TN', 'ليست لديّ إجابة موثوقة أقدّمها لكم'),
  ('refusal.REF-05.body', 'ar-TN', 'هذه المعلومة غير واردة في الوثائق المعتمدة التي أتاحت لي الاطّلاع عليها، وقد آثرت أن أصارحكم بذلك على أن أجيبكم إجابة تقريبية. {{top_sources}} ويمكن لأحد مستشارينا أن يجيبكم إجابة دقيقة: {{handoff_cta}}.'),
  ('refusal.REF-05.cta', 'ar-TN', '{{handoff_cta}}');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-05.title', 'en-GB', 'I don''t have a reliable answer for you'),
  ('refusal.REF-05.body', 'en-GB', 'That information isn''t in the approved documentation I have access to, and I''d rather tell you so than give you an approximate answer. {{top_sources}} An advisor can give you a precise answer: {{handoff_cta}}.'),
  ('refusal.REF-05.cta', 'en-GB', '{{handoff_cta}}'),
  ('refusal.REF-05.title.technical', 'fr-FR', 'Je préfère ne pas vous répondre'),
  ('refusal.REF-05.body.technical', 'fr-FR', 'Je n''ai pas pu vérifier complètement la réponse à votre question, et je préfère ne rien vous dire plutôt que vous donner une information dont je ne suis pas certain. Merci de réessayer dans {{retry_after}}, ou de vous adresser à {{handoff_channel}}.'),
  ('refusal.REF-05.cta.technical', 'fr-FR', '{{handoff_cta}}');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-05.title.technical', 'ar-TN', 'أُؤثر ألاّ أجيبكم'),
  ('refusal.REF-05.body.technical', 'ar-TN', 'لم أتمكّن من التحقّق الكامل من الجواب عن سؤالكم، وقد آثرت ألاّ أقول شيئا على أن أوافيكم بمعلومة لست متيقّنا منها. ونرجو منكم إعادة المحاولة بعد {{retry_after}}، أو التوجّه إلى {{handoff_channel}}.'),
  ('refusal.REF-05.cta.technical', 'ar-TN', '{{handoff_cta}}'),
  ('refusal.REF-05.title.technical', 'en-GB', 'I''d rather not answer'),
  ('refusal.REF-05.body.technical', 'en-GB', 'I couldn''t fully verify the answer to your question, and I''d rather say nothing than give you information I''m not certain of. Please try again in {{retry_after}}, or contact {{handoff_channel}}.'),
  ('refusal.REF-05.cta.technical', 'en-GB', '{{handoff_cta}}');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-05.title.agent', 'fr-FR', 'Réponse non servie — vérification incomplète'),
  ('refusal.REF-05.body.agent', 'fr-FR', 'Étape en échec : {{failed_stage}}. Le client a reçu le message REF-05 standard. Le fil de la conversation et le paquet de preuves sont disponibles dans le backoffice sous la référence {{correlation_id}}.'),
  ('refusal.REF-05.cta.agent', 'fr-FR', 'Ouvrir le replay'),
  ('refusal.REF-05.title.agent', 'ar-TN', 'لم يُقدَّم الجواب — التحقّق غير مكتمل'),
  ('refusal.REF-05.body.agent', 'ar-TN', 'المرحلة التي أخفقت: {{failed_stage}}. وقد وصل الحريف رسالة REF-05 المعتادة. ويمكنكم الاطّلاع على مجرى المحادثة وملفّ الأدلة في مكتب الضبط بالاستناد إلى المرجع {{correlation_id}}.'),
  ('refusal.REF-05.cta.agent', 'ar-TN', 'افتح إعادة التشغيل');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-05.title.agent', 'en-GB', 'Answer not served — verification incomplete'),
  ('refusal.REF-05.body.agent', 'en-GB', 'Failed stage: {{failed_stage}}. The customer received the standard REF-05 message. The conversation trace and the evidence pack are available in the backoffice under reference {{correlation_id}}.'),
  ('refusal.REF-05.cta.agent', 'en-GB', 'Open replay'),
  ('refusal.REF-06.title', 'fr-FR', 'Ce n''est pas mon domaine'),
  ('refusal.REF-06.body', 'fr-FR', 'Cette question ne concerne pas les produits et services de {{bank_name}}, et je ne suis pas en mesure d''y répondre — notamment s''agissant d''autres établissements ou de conseils d''investissement. En revanche, je peux vous renseigner sur nos financements participatifs, nos comptes, nos procédures et nos tarifs.'),
  ('refusal.REF-06.cta', 'fr-FR', 'Que puis-je vous expliquer ?');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-06.title', 'ar-TN', 'هذا ليس من اختصاصي'),
  ('refusal.REF-06.body', 'ar-TN', 'لا يتعلّق هذا السؤال بمنتجات {{bank_name}} وخدماتها، ولست قادرا على الإجابة عنه، ولا سيّما إذا كان يخصّ مؤسّسات أخرى أو نصائح في الاستثمار. ويمكنني في المقابل أن أفيدكم بمعلومات عن تمويلاتنا التشاركية، وحساباتنا، وإجراءاتنا، وتعريفتنا البنكية.'),
  ('refusal.REF-06.cta', 'ar-TN', 'عمّ تريدون أن أشرح لكم؟'),
  ('refusal.REF-06.title', 'en-GB', 'That''s outside my remit'),
  ('refusal.REF-06.body', 'en-GB', 'That question isn''t about the products and services of {{bank_name}}, and I''m not able to answer it — in particular where it concerns other institutions or investment advice. I can, though, tell you about our participatory financing, our accounts, our procedures and our tariffs.'),
  ('refusal.REF-06.cta', 'en-GB', 'What can I explain for you?');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-06.followup.1', 'fr-FR', 'Comment fonctionne la Mourabaha ?'),
  ('refusal.REF-06.followup.2', 'fr-FR', 'Quels financements proposez-vous aux professionnels ?'),
  ('refusal.REF-06.followup.3', 'fr-FR', 'Quelles pièces pour un dossier de financement ?'),
  ('refusal.REF-06.followup.1', 'ar-TN', 'كيف تعمل المرابحة؟'),
  ('refusal.REF-06.followup.2', 'ar-TN', 'ما التمويلات التي تقترحونها على أصحاب المهن؟'),
  ('refusal.REF-06.followup.3', 'ar-TN', 'ما الوثائق المطلوبة لتكوين ملف تمويل؟');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('refusal.REF-06.followup.1', 'en-GB', 'How does Murabaha work?'),
  ('refusal.REF-06.followup.2', 'en-GB', 'What financing do you offer to businesses?'),
  ('refusal.REF-06.followup.3', 'en-GB', 'Which documents does a financing application need?'),
  ('disclaimer.DISC-SHARIA-NO-FATWA', 'fr-FR', 'Seul le {{committee_name}} est habilité à se prononcer sur la conformité d''une opération aux normes bancaires islamiques.'),
  ('disclaimer.DISC-SHARIA-NO-FATWA', 'ar-TN', 'وحده {{committee_name}} مخوّل بالبتّ في مطابقة العملية للمعايير المصرفية الإسلامية.'),
  ('disclaimer.DISC-SHARIA-NO-FATWA', 'en-GB', 'Only the {{committee_name}} is authorised to rule on the conformity of an operation with Islamic banking standards.');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('disclaimer.DISC-NO-FINANCIAL-ADVICE', 'fr-FR', 'Les informations fournies sont d''ordre général et ne constituent ni un conseil en investissement ni un engagement contractuel.'),
  ('disclaimer.DISC-NO-FINANCIAL-ADVICE', 'ar-TN', 'المعلومات المقدَّمة ذات طابع عام، ولا تُعدّ نصيحة في الاستثمار ولا تعهّدا تعاقديا.'),
  ('disclaimer.DISC-NO-FINANCIAL-ADVICE', 'en-GB', 'The information provided is general in nature and constitutes neither investment advice nor a contractual commitment.'),
  ('disclaimer.DISC-TARIFF-VALIDITY', 'fr-FR', 'Les conditions tarifaires sont susceptibles d''évoluer ; la tarification en vigueur est celle affichée en agence à la date de signature.'),
  ('disclaimer.DISC-TARIFF-VALIDITY', 'ar-TN', 'يمكن أن تتطوّر الشروط التعريفية، والتعريفة النافذة هي المعتمدة بالفرع بتاريخ الإمضاء.'),
  ('disclaimer.DISC-TARIFF-VALIDITY', 'en-GB', 'Tariff conditions may change; the applicable tariff is the one displayed at the branch on the date of signature.');
INSERT INTO message_bundle (message_key, locale, text) VALUES
  ('disclaimer.DISC-PII', 'fr-FR', 'Ne communiquez aucune donnée personnelle dans cette conversation.'),
  ('disclaimer.DISC-PII', 'ar-TN', 'نرجو ألاّ تدلوا بأي معطى شخصي في هذه المحادثة.'),
  ('disclaimer.DISC-PII', 'en-GB', 'Please do not share any personal data in this conversation.');

-- ── assistant_config ─────────────────────────────────────────────────────────────────────────────
-- 6 runtime-editable registers. These are the parts of the seed that an administrator is meant to
-- change without a migration; each description names the file it was generated from.
INSERT INTO assistant_config (key, value, value_type, locale, risk_tier, description, version, updated_by) VALUES
  ('assistant.identity', '{"assistant_name":"Al-Mouchir","assistant_name_ar":"المشير","bank_name":"Al Baraka Bank Tunisia","committee_name":"comité de contrôle de la conformité aux normes bancaires islamiques","committee_name_ar":"لجنة مراقبة مطابقة المعايير المصرفية الإسلامية","committee_name_en":"Islamic Banking Standards Compliance Committee","default_locale":"fr-FR","supported_locales":["fr-FR","ar-TN","en-GB"]}'::jsonb, 'JSON', NULL, 'T1_LOW', 'The names interpolated into prompts and refusal messages, keyed by placeholder name. Seeded from albaraka.assistant in specs/config/application.yaml. Renaming the assistant is a branding decision an administrator can take without a migration; seed_test.sql G7e fails if a seeded message uses a placeholder this object does not supply.', 0, 'flyway:V902__seed_policies');
INSERT INTO assistant_config (key, value, value_type, locale, risk_tier, description, version, updated_by) VALUES
  ('refusal.fragments', '{"assistant_name":{"resolvedBy":"assistant_config","source":"assistant.identity"},"bank_name":{"resolvedBy":"assistant_config","source":"assistant.identity"},"alternative_block":{"resolvedBy":"runtime","source":"RefusalComposer — the participatory alternative to the prohibited product asked for, from term_glossary and retrieval"},"documentation_block":{"resolvedBy":"runtime","source":"RefusalComposer — citations of the approved documentation that describes the operation"},"referral_cta":{"resolvedBy":"runtime","source":"RefusalComposer — the label of the Sharia-committee referral action for the answer language"},"handoff_cta":{"resolvedBy":"runtime","source":"RefusalComposer — the label of the human handoff action for the answer language"},"top_sources":{"resolvedBy":"runtime","source":"RefusalComposer — the titles of the top retrieved sources that scored below the relevance threshold, rendered as questions"},"handoff_channel":{"resolvedBy":"runtime","source":"RefusalComposer — the authenticated or agency channel that can serve the request, per channel and audience"},"committee_name":{"resolvedBy":"assistant_config","source":"assistant.identity"},"retry_after":{"resolvedBy":"runtime","source":"RateLimiter — the Retry-After window in seconds, from the bucket that was exhausted"},"correlation_id":{"resolvedBy":"runtime","source":"IncidentContext — the correlation id of the guardrail_event or incident row, so an agent can trace the refusal. REF-05 agent variant only."},"failed_stage":{"resolvedBy":"runtime","source":"IncidentContext — the pipeline stage that failed. REF-05 agent variant only: R3 forbids naming internals in customer-facing copy, so this must never appear in an unqualified body."}}'::jsonb, 'JSON', NULL, 'T2_MEDIUM', 'Every placeholder that appears in a refusal, and what resolves it. Three are constants from assistant.identity; the rest are composed per request, because their content depends on retrieval, on the rate limiter or on the audience. Derived from the placeholder list in the header of specs/prompts/templates.refusals.yaml — a placeholder the header stops documenting fails the build rather than reaching a customer verbatim.', 0, 'flyway:V902__seed_policies');
INSERT INTO assistant_config (key, value, value_type, locale, risk_tier, description, version, updated_by) VALUES
  ('prompt.model_routing', '{"SYSTEM_ASSISTANT":{"modelRole":"CHAT_PRIMARY","locales":["fr-FR","ar-TN","en-GB"]},"GUARDRAIL_JUDGE":{"modelRole":"GUARD_SAFETY","locales":["fr-FR"],"outputSchema":"guardrail.sharia.v1","maxTokens":400,"temperature":0},"INTENT_CLASSIFIER":{"modelRole":"CHAT_FAST","locales":["fr-FR"],"outputSchema":"intent.classification.v1","maxTokens":200,"temperature":0},"QUERY_REWRITE":{"modelRole":"CHAT_FAST","locales":["fr-FR"],"outputSchema":"query.rewrite.v1","maxTokens":350,"temperature":0},"SYSTEM_RERANKER":{"modelRole":"RERANKER","locales":["fr-FR"],"outputSchema":"rerank.listwise.v1","maxTokens":700,"temperature":0},"ANSWER_CONTRACT":{"modelRole":"CHAT_PRIMARY","locales":["fr-FR"]},"SUMMARIZER":{"modelRole":"CHAT_FAST","locales":["fr-FR"],"outputSchema":"summary.v1","maxTokens":400,"temperature":0},"EVAL_JUDGE":{"modelRole":"CHAT_PRIMARY","locales":["fr-FR"],"outputSchema":"eval.judgement.v1","maxTokens":900,"temperature":0}}'::jsonb, 'JSON', NULL, 'T2_MEDIUM', 'Which model_config runs each prompt code, and the output schema, max_tokens and temperature that go with it. prompt_version has no columns for these, so the binding lives here and stays editable at runtime rather than frozen into a migration. Generated from the front matter of specs/prompts/*.md.', 0, 'flyway:V902__seed_policies');
INSERT INTO assistant_config (key, value, value_type, locale, risk_tier, description, version, updated_by) VALUES
  ('refusal.policy', '{"REF-01":{"name":"SAFETY_BLOCK","triggersIncident":true,"followupPolicy":"NONE","ctaAction":null,"audienceDefault":"CUSTOMER","log":"guardrail_event + audit_event (immutable)","emittedBy":["guardrail stage 3 (input): INJECTION, ABUSE, sectarian/theological content, illegal activity","guardrail stage 10 (output): SHARIA_POSTURE at CRITICAL with no recoverable redaction"],"shortCircuit":false,"followups":{"pool":"NONE","perLocale":{}}},"REF-02":{"name":"PROHIBITED_SUBJECT","triggersIncident":false,"followupPolicy":"PRODUCT_CATALOGUE","ctaAction":"ALTERNATIVE_OR_CONTACT","audienceDefault":"CUSTOMER","log":"guardrail_event","emittedBy":["guardrail stage 3 (input): PROHIBITED_TOPICS (riba-based product, haram sector, maysir, gharar)","guardrail stage 10 (output): CONVENTIONAL_PRODUCT"],"shortCircuit":false,"followups":{"pool":"PRODUCT_CATALOGUE","perLocale":{"fr-FR":3,"ar-TN":3,"en-GB":3}}},"REF-03":{"name":"NO_FATWA","triggersIncident":false,"followupPolicy":"NONE","ctaAction":"SHARIA_REFERRAL","audienceDefault":"CUSTOMER","log":"guardrail_event + fatwa_request row (status NEW, tier from sharia_policy)","emittedBy":["intent classifier: RELIGIOUS_RULING_REQUEST (before any retrieval or generation)","guardrail stage 10 (output): RULING_ISSUED, RULING_IMPLIED, CONCESSION_TO_PREMISE, UNSOURCED_RELIGIOUS_CONTENT","system prompt: no_answer_reason = RELIGIOUS_RULING"],"shortCircuit":false,"followups":{"pool":"NONE","perLocale":{}},"referral":{"creates":"fatwa_request","sla_days_by_tier":{"T1_LOW":1,"T2_MEDIUM":5,"T3_HIGH":10},"requires_user_consent":true,"consent_key":"consent.REF-03.referral","on_accept":["insert fatwa_request (status NEW, source CONVERSATION, correlation_id)","notify Sharia officer queue (v_review_queue)","message_key notification.REF-03.referral_created"],"on_decline":["no row created; guardrail_event retained","message_key notification.REF-03.referral_declined"]},"referencedMessagesNotAuthored":["consent.REF-03.referral","notification.REF-03.referral_created","notification.REF-03.referral_declined"]},"REF-04":{"name":"PERSONAL_DATA_OR_ACCOUNT_ACCESS","triggersIncident":false,"followupPolicy":"NONE","ctaAction":"AUTHENTICATED_CHANNEL","audienceDefault":"CUSTOMER","log":"guardrail_event (PII class recorded, value NEVER recorded — see docs/07 §5)","emittedBy":["intent classifier: ACCOUNT_STATUS (v1 has no core-banking integration)","guardrail stage 3 (input): PII_EGRESS — utterance is mostly personal data","system prompt: no_answer_reason = PERSONAL_DATA"],"shortCircuit":true,"followups":{"pool":"NONE","perLocale":{}}},"REF-05":{"name":"HONEST_IGNORANCE","triggersIncident":false,"followupPolicy":"RELATED_QUESTIONS","ctaAction":"HANDOFF","audienceDefault":"CUSTOMER","log":"guardrail_event + coverage_gap row (this is how the knowledge base learns what is missing)","emittedBy":["retrieval: no candidate above relevance threshold τ","system prompt: no_answer = true, reason NOT_IN_KB | OUTDATED | AMBIGUOUS","guardrail stage 10: answer suppressed after one failed regeneration","technical variant: GUARD_JUDGE_UNAVAILABLE, PROVIDER_FAILURE, NUMERIC_VALIDATOR_KILLED_ANSWER"],"shortCircuit":false,"followups":{"pool":"RELATED_QUESTIONS","perLocale":{},"composedAtRuntime":"titles of the top retrieved sources below the relevance threshold; empty when retrieval returned nothing"},"variants":{"technical":{"reasonCodes":["GUARD_JUDGE_UNAVAILABLE","PROVIDER_FAILURE","NUMERIC_VALIDATOR_KILLED_ANSWER","MALFORMED_RESPONSE","CONTEXT_ASSEMBLY_FAILURE"],"note":"The system had something to say and could not stand behind it. The copy must not say \"technical error\" (R3: no disclosure of internals) and must not imply the answer is forbidden — only that it is not verified."},"agent":{"reasonCodes":[],"note":"May name the failing stage — the agent desk needs it and R3 does not apply internally."}}},"REF-06":{"name":"OUT_OF_SCOPE","triggersIncident":false,"followupPolicy":"PRODUCT_CATALOGUE","ctaAction":"REDIRECT","audienceDefault":"CUSTOMER","log":"guardrail_event (no coverage_gap — this is not a knowledge-base hole)","emittedBy":["intent classifier: OUT_OF_SCOPE (news, sport, politics, homework, other banks)","system prompt: no_answer_reason = OUT_OF_SCOPE","guardrail stage 3: financial advice, competitor comparison"],"shortCircuit":false,"followups":{"pool":"PRODUCT_CATALOGUE","perLocale":{"fr-FR":3,"ar-TN":3,"en-GB":3}}}}'::jsonb, 'JSON', NULL, 'T3_HIGH', 'Per refusal code: the machine name, whether a hit opens an incident, which follow-up pool and CTA apply, which variants exist and when, the referral flow, and which guardrail stages emit it. message_bundle stores only text, so the behaviour around a refusal lives here. Where a flow refers to a message whose text has not been authored, the key is listed under referencedMessagesNotAuthored rather than invented. Generated from specs/prompts/templates.refusals.yaml.', 0, 'flyway:V902__seed_policies');
INSERT INTO assistant_config (key, value, value_type, locale, risk_tier, description, version, updated_by) VALUES
  ('guardrail.forbidden_renderings_register', '[{"concept":"Product financing","neverSay":{"fr":["prêt","crédit","emprunt"],"ar":["قرض بفائدة","سلفة"],"en":["loan","credit","borrowing"]},"sayInstead":"financement, operation de Mourabaha / تمويل"},{"concept":"Cost of financing","neverSay":{"fr":["taux d''intérêt","intérêt","agios"],"ar":["نسبة فائدة","فائدة بنكية"],"en":["interest rate","APR"]},"sayInstead":"marge bénéficiaire / هامش ربح / profit margin"},{"concept":"Deposit remuneration","neverSay":{"fr":["compte rémunéré à X %"],"ar":["حساب بفائدة X٪"],"en":["account yielding X % interest"]},"sayInstead":"participation aux bénéfices selon la clé convenue"},{"concept":"Insurance","neverSay":{"fr":["assurance classique"],"ar":["تأمين تجاري"],"en":["conventional insurance"]},"sayInstead":"Takaful / تكافل"},{"concept":"Religious verdict","neverSay":{"fr":["c''est halal","c''est interdit","je vous autorise"],"ar":["هذا حلال","هذا حرام","أفتيك بأن"],"en":["this is halal","this is haram","I rule that"]},"sayInstead":"la documentation approuvée prévoit… / pour un avis, saisissez le Comité"},{"concept":"Penalty interest","neverSay":{"fr":["pénalités de retard (intérêts)"],"ar":["غرامات تأخير بفائدة"],"en":["late-payment interest"]},"sayInstead":"indemnité versée au compte de bienfaisance (Nafaa al Am), le cas échéant"}]'::jsonb, 'JSON', NULL, 'T3_HIGH', 'Cross-cutting prohibited renderings for concepts that are not single glossary terms, and what to say instead. term_glossary.forbidden_renderings covers the per-term cases; this covers the rest. Generated from docs/glossary-trilingual.md §6.', 0, 'flyway:V902__seed_policies');
INSERT INTO assistant_config (key, value, value_type, locale, risk_tier, description, version, updated_by) VALUES
  ('disclaimer.wiring', '{"DISC-SHARIA-NO-FATWA":{"appliesTo":["REF-03"],"condition":null},"DISC-NO-FINANCIAL-ADVICE":{"appliesTo":["REF-02","REF-06"],"condition":null},"DISC-TARIFF-VALIDITY":{"appliesTo":["REF-05"],"condition":"intent == TARIFF_FEES"},"DISC-PII":{"appliesTo":["REF-04"],"condition":null}}'::jsonb, 'JSON', NULL, 'T2_MEDIUM', 'Which disclaimer applies to which refusal code, and under what condition. Disclaimers are appended by the SERVER after the refusal body and are never generated by a model. Generated from specs/prompts/templates.refusals.yaml.', 0, 'flyway:V902__seed_policies');

-- ── invariants a reviewer can re-run ─────────────────────────────────────────────────────────────
-- SELECT count(*) FROM guardrail_policy;                                  → 10
-- SELECT count(*) FROM guardrail_policy WHERE state <> 'DRAFT';           → 0
-- SELECT count(*) FROM guardrail_policy WHERE severity = 'CRITICAL'
--                                          AND decision_on_hit <> 'BLOCK'; → 0
-- SELECT count(*) FROM message_bundle;                                    → 99
-- SELECT count(DISTINCT message_key) FROM message_bundle;                 → 33
-- SELECT count(*) FROM assistant_config;                                  → 6
