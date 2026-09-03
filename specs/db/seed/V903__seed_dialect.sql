-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--  V903__seed_dialect.sql — Tunisian Derja → MSA input map
-- ────────────────────────────────────────────────────────────────────────────────────────────────────
--  GENERATED FILE. Do not edit by hand.
--
--  Regenerate with:  node tools/seed-gen/generate.mjs
--  Staleness check:  node tools/seed-gen/generate.mjs --check     (runs in CI)
--
--  Sources of truth:
--   specs/i18n/derja-msa.json           (mappings: 366 rows)
--   specs/i18n/README.md                (the policy this seed implements: Derja in, MSA out)
--
--
-- Derja is INPUT-side only. This table never rewrites an answer: answers are always MSA, and
-- religious content is never expressed in Derja in either direction.
-- 
-- The map is applied only when the message is detected as Derja, not to every Arabic query —
-- several Derja forms are also valid MSA words with a different meaning. See policy.appliesWhen.
-- 
-- Ordering matters at runtime: fold → dialect_map → stem. A key the stemmer would alter can never
-- match, and can land on a different key (معلومات stems to معلوم, itself an entry meaning "fee").

--  Surrogate keys are UUIDv5 of the row's natural key under namespace a1ba4a4a-0000-5000-8000-000000000000,
--  so regeneration is byte-identical and a row has the same id in every environment.
--
--  Inserts are plain, not ON CONFLICT DO NOTHING: a Flyway versioned migration runs exactly once,
--  and a natural-key collision here means the source is wrong. Failing loudly at migrate time is
--  better than silently seeding one row fewer.
-- ────────────────────────────────────────────────────────────────────────────────────────────────────

SET search_path TO albaraka_ai, public;

-- 366 Derja → MSA mappings. sharedVocabulary (289 entries) is deliberately
-- NOT seeded: those forms are identical in Derja and MSA, so there is nothing to map, and putting
-- them in the table would fill the administrator's mining queue with suggestions of the form
-- "نظام = نظام".
--
-- Rows carrying contextRequired are seeded ACTIVE with their predicate recorded in gloss_en, because
-- derja_msa_map has no context column. The runtime resolves them through the glossary and the intent
-- rather than through this table alone; 11 such rows are listed at the foot of this file so a
-- reviewer can see which mappings are not unconditional.
--
-- Pruned entries (6 rows in the spec, covering 11 removed mappings) are absent by design. Each
-- removal has a written reason in derja-msa.json:prunedEntries — they either duplicate the fold
-- stage, collide with another key once folded, chain into a second mapping, or rewrite a word that
-- is valid MSA with a different meaning. tools/i18n-lint D16 fails the build if one is re-added.
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('2467a323-ad2b-554f-8b03-9d16f6ec7a00', 'شنوة', 'chnowa', 'ما هو', 'what (masc.)', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('4758e98b-66fd-5e42-a699-3b4674729134', 'شنية', 'chniya', 'ما هي', 'what (fem.)', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a76bfa93-6f4c-5469-bf69-5f6d78bef514', 'شنيا', 'chnia', 'ما هو', 'what (variant)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('7d4a0ce1-b802-5bf6-91bd-a7515e55e86f', 'آش', 'ech', 'ماذا', 'what (short form)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a7840067-2fb5-5c81-ad00-b647d6a3e55b', 'قداش', '9addéch', 'كم', 'how much / how many', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('1bc147de-b823-561f-9a9f-eb70a11590cd', 'قدّاش', '9addéch', 'كم', 'how much (variant spelling)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f673e05d-8318-56f7-becd-1a784e600d85', 'وين', 'win', 'أين', 'where', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('e45596f4-330f-558c-b5c2-209330cecd48', 'وينوما', 'winouma', 'أين هم', 'where are they', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('07be63a0-32bd-510b-b3a0-687fd829687d', 'وقتاش', 'wa9tech', 'متى', 'when', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('edb5aeab-7738-523d-9975-ea81c478bbdf', 'شكون', 'chkoun', 'من', 'who', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('22c71c3d-3efd-55bf-a50e-3172c7452ba2', 'كيفاش', 'kifech', 'كيف', 'how', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('66d90f1e-7be9-54c4-b169-97057b39f9b3', 'كيفاه', 'kifah', 'كيف', 'how (variant)', 0.92, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d4e94c21-a341-5db5-b8c7-02598c066744', 'علاش', '3lech', 'لماذا', 'why', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('5be3edaa-6ba0-5c40-a46c-133ee47d0a1c', 'علاش هكة', '3lech heka', 'لماذا هكذا', 'why like this', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('732643b7-9d01-565f-8c7d-8ba07c95e0c2', 'فمة', 'fama', 'هل يوجد', 'there is / is there', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3a7654a9-5527-51f6-8f2d-f7453bf4706d', 'فماش', 'famech', 'هل لا يوجد', 'is there not', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('9648ee7b-dedd-52cd-abd0-31071ae0d80b', 'شنوة اسمك', 'chnowa smek', 'ما اسمك', 'what is your name', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('84e2a886-8b69-516e-b281-5da23dc29287', 'سقسى', 'sa9sa', 'سأل', 'he asked', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('b435bf81-2c24-598a-812b-17ece13bb2d3', 'نسقسى', 'nsa9sa', 'أسأل', 'I ask', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('c84d1b52-80d3-5db0-be98-cf4736dcb318', 'مش', 'mech', 'ليس', 'is not', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('67eefdaa-8cbc-5ff4-a19d-1255a693b403', 'موش', 'mouch', 'ليس', 'is not (variant)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('756a0b17-5364-5e8e-b3bd-f8963acdb523', 'مانيش', 'manich', 'لست', 'I am not', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('fe9cea3b-bfe9-5997-b74b-d3bcd6dc11e6', 'ماشي', 'machi', 'لا يعمل', 'not working', 0.7, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a0d007b2-577d-5d87-8bfb-f1091edf14db', 'جامي', 'jami', 'أبدا', 'never', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('acd80561-bc40-5c67-b05a-9e9998f4b45f', 'حتى مرة', '7atta marra', 'أبدا', 'not even once', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('5920b175-18c1-5caa-83b7-f1fd1a783081', 'ما فماش', 'ma famach', 'لا يوجد', 'there is not', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3f6b5d02-bfab-543b-bd57-ab1bcaee1087', 'ما نعرفش', 'ma na3refch', 'لا أعرف', 'I do not know', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('da9b89ef-24c2-58ff-aabf-3137cdbb763e', 'ما نجمش', 'ma najemch', 'لا أستطيع', 'I cannot', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('2e6e0025-2e27-5a4b-bfc8-82a9f27ddeb3', 'تنجمش', 'tnajemch', 'لا تستطيع', 'you cannot', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('052c107c-ef17-5b19-a58b-922d9b3117e0', 'مازال', 'mazal', 'لم يحن بعد', 'not yet', 0.8, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('b81bf6a8-ce46-5336-a912-53a14b8e0caa', 'موش صحيح', 'mouch s7i7', 'غير صحيح', 'incorrect', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('40293ad5-579a-5b8f-a6c2-1ecdd7bfa440', 'بلا', 'bla', 'بدون', 'without', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('1c70b9dc-834f-5a8f-9f28-6d06f02dce57', 'بلاش', 'blach', 'مجانا', 'for free', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f7475805-1f62-523a-87f1-388ddc4e4107', 'نحب', 'ne7eb', 'أريد', 'I want', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('4f74146d-e2bd-58ed-bc05-9694ae019eca', 'تحب', 't7eb', 'تريد', 'you want', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('4a8377db-3eca-5e57-9da0-74ca1fb1d8a7', 'يحب', 'ye7eb', 'يريد', 'he wants', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('1872be4b-e7fa-5343-a6fa-9ee7d8c3a368', 'نحبو', 'ne7bou', 'نريد', 'we want', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f36e49f4-5c61-5d66-9d32-1a7281fcdd38', 'نجم', 'najem', 'أستطيع', 'I can', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('00018c68-a260-5e76-a55e-0ed85fc395b6', 'تنجم', 'tnajem', 'تستطيع', 'you can', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('78777091-6833-5ba3-9f4c-79d181a85a5b', 'نجوم', 'najmou', 'نستطيع', 'we can', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('a73042a5-4b5c-5480-9347-ddfdbb99ac8e', 'يلزم', 'ylazem', 'يجب', 'it is necessary', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('1ca34ecf-f72a-597d-8718-0482f0121c06', 'يلزمك', 'ylazmek', 'يجب عليك', 'you must', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('35c4cc9f-38a3-574b-9e92-dd242b04a8d7', 'نعمل', 'na3mel', 'أفعل', 'I do / I make', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a9c5c708-0b16-5aba-99a4-aa1bac51bb43', 'تعمل', 'ta3mel', 'تفعل', 'you do', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('dd1d1a85-65cb-5697-b785-a1ab2ec85d4d', 'عملت', '3melt', 'فعلت', 'I did', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('7116fe0c-aae0-5eb4-9840-7107796b0f72', 'مشيت', 'mchit', 'ذهبت', 'I went', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('8f67a22a-6576-596c-a10f-51d9618cc51f', 'نمشي', 'nemchi', 'أذهب', 'I go', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('588c9189-6ad9-5a97-8737-6db65229ef1c', 'يمشي', 'yemchi', 'يذهب', 'he goes', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('b2e25aa2-2157-5848-983a-c23f478ebfc5', 'شريت', 'chrit', 'اشتريت', 'I bought', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('1ec551ce-c1e4-521e-a65c-ad80c5f1ee58', 'نشري', 'nechri', 'أشتري', 'I buy', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('f78379f6-eb77-58b1-9ef8-cf6d11b65807', 'شرى', 'shra', 'اشترى', 'he bought', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('c777544b-220f-5ddd-9622-a82f9a4e56bf', 'نبيع', 'nbi3', 'أبيع', 'I sell', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('c1488829-de25-510e-bff9-29db807d466d', 'نخلص', 'nekhalles', 'أدفع', 'I pay', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('db40815b-f03e-5739-8af4-33b076f0dfd5', 'يخلص', 'yekhalles', 'يدفع', 'he pays', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('c761f5f8-d8ea-56f3-9335-44fabf6a3328', 'خلاص', 'khalles', 'دفع', 'he paid / payment', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('46ec17a2-6ee3-5233-bcbb-ee3f793284e2', 'تسلف', 'tsallef', 'يقترض', 'to borrow', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('9f6fa864-5e82-5668-83ec-d694d32ffb0f', 'سلفني', 'slefni', 'أقرضني', 'lend me', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('877703b5-b6f0-5ba0-b392-530c8ab6a203', 'حلّ', '7all', 'فتح', 'he opened', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('58372c22-c53d-5fa3-84a1-e150fad02912', 'نحلّ', 'na7ell', 'أفتح', 'I open', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('9bc9f9e3-60ba-50ae-8246-7b296b73b72d', 'حلّ الحساب', '7all l 7sab', 'فتح الحساب', 'open the account', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('1e69166d-eb55-5785-8e3c-49057b8940f3', 'سد', 'sadd', 'أغلق', 'he closed', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a3795888-e429-5638-9f03-06b591cbb588', 'نسد', 'nsadd', 'أغلق', 'I close', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('62c4b4bb-4ba8-58be-88a5-9074f703a3ce', 'وقّف', 'wa99ef', 'أوقف', 'he stopped (something)', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a3f4a911-6c1e-52dc-bf93-d3964f9fc885', 'قعد', 'a3ad', 'بقي', 'he stayed', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('5c448eca-5bae-5d9d-bf9f-3c3e91846388', 'رجع', 'rja3', 'عاد', 'he returned', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('673c92ec-2794-5e7b-88e9-4890f65d0e63', 'يرجع', 'yrja3', 'يعود', 'he returns', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('70dd726e-0410-558c-80cc-3626ede5a809', 'كمل', 'kammel', 'أكمل', 'he completed', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('986ee029-81ff-5e93-87ed-bc54af3442bd', 'خدم', 'khedem', 'عمل', 'he worked', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('5195d3e7-0465-5185-a1bc-ebc9585a4f52', 'يخدم', 'yekhdem', 'يعمل', 'he works', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('7e1a0c32-dac5-501e-8d57-3af8657704e9', 'نعرف', 'na3ref', 'أعرف', 'I know', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('cf2ca91a-a2b0-5fd9-ad63-539a13ccfcb2', 'نطلب', 'nottleb', 'أطلب', 'I request', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('7420b7f8-0096-5455-b44f-3ba7b687bf72', 'نقدم', 'n9addem', 'أقدم', 'I submit', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('e759e0b5-aae6-5a5b-8be7-fac4f1f7ccf2', 'قدمت مطلب', '9addemt matleb', 'قدمت طلبا', 'I submitted an application', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('04ea2a13-3c85-5ec0-a265-4e6710d333c6', 'نوقع', 'nwa99a3', 'أوقع', 'I sign', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('9c464cc5-9552-57ea-8adf-d1d96f0c3878', 'نمضي', 'nemdhi', 'أوقع', 'I sign (by initialling)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('5ae1b745-4172-55db-927b-2c66a6cb7d34', 'نحسب', 'na7seb', 'أحسب', 'I calculate', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0651508a-d54f-5d73-8060-ba8d03fead4f', 'نبدل', 'nbeddel', 'أغير', 'I change', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('2fc51569-0feb-522e-a0e4-2001eaad4416', 'بدّل', 'beddel', 'غيّر', 'he changed', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('fd4b1ead-9163-5e20-b2d2-f082d2778125', 'نحول', 'na7awwel', 'أحول', 'I transfer', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0131114f-1ecb-5beb-8a94-17251ffd8aea', 'نسلم', 'nsellem', 'أسلم', 'I hand over', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('927ddf9e-f989-5976-9586-e498da8384b2', 'نقبل', 'na9bel', 'أقبل', 'I accept', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('bbf1ed55-9f90-536a-9598-839afc8b618d', 'نرفض', 'narfedh', 'أرفض', 'I refuse', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('dfd0f1cc-8de6-5c6d-8701-bd5cd06217b2', 'نستنى', 'nestenna', 'أنتظر', 'I wait', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('c1d48a80-12a1-5ec7-bcdc-fbd6af3a8dcb', 'استنيت', 'stennit', 'انتظرت', 'I waited', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('26555450-c397-5342-af1a-f4a27509360d', 'ننسى', 'ninssa', 'أنسى', 'I forget', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('6d3b20a6-2f1e-5275-a25a-85fd1fe4a361', 'نحتاج', 'ne7taj', 'أحتاج', 'I need', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('4fed9fbf-5b7e-56ac-be31-a90268521628', 'نستحق', 'nesta7e9', 'أستحق', 'I am entitled to', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('8e869d1a-d2bf-5498-9a09-ad3f0513445d', 'نستعمل', 'nesta3mel', 'أستعمل', 'I use', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d9c48f5e-96c5-5c11-8dec-4a51e7b071ec', 'نستفهم', 'nestafhem', 'أستفسر', 'I inquire', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('77ba581f-4ff5-5d5f-a388-adfcbfd27d2f', 'نعاود', 'na3awed', 'أعيد', 'I repeat', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('d6e6fbce-08bb-59c6-a3c5-4cec8e23d1e5', 'عاود', '3awed', 'أعد', 'repeat', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('2206f5ea-082a-5baf-94cd-a2f4d5be41c7', 'نلغي', 'nelghi', 'ألغي', 'I cancel', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('2912859f-3836-5a2e-b05d-befbf7245c57', 'لغيت', 'lghit', 'ألغيت', 'I cancelled', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('5a40babe-27cd-5f68-a532-ab81a6be46b5', 'نجدد', 'njadded', 'أجدد', 'I renew', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d7666e92-c7d4-50a8-b295-663ffdd5bff8', 'نستخرج', 'nestakhrej', 'أستخرج', 'I extract / obtain', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('286d51f4-ab14-5fee-8ceb-ad9dcf0079ca', 'نجيب', 'njib', 'أحضر', 'I bring', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f4d5e988-09dd-5fe8-a68b-0d394140b4ea', 'جاب', 'jab', 'أحضر', 'he brought', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('296db9d8-3c80-5a89-991b-b065ac6538a1', 'نجيبو', 'njibou', 'نحضر', 'we bring', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('c29e4e10-1300-5b41-9471-d909b428886b', 'نصرف', 'nsarref', 'أصرف', 'I cash / convert', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('314b2a1a-3234-56ad-98e2-c9f49b7fbddb', 'نودع', 'nwadda3', 'أودع', 'I deposit', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('99afd271-8c56-553a-8d8d-fa55c35ded94', 'نسحب', 'nissah', 'أسحب', 'I withdraw', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('9488143a-f83a-5b91-bd1a-5a20001ff3a4', 'نستثمر', 'nestathmir', 'أستثمر', 'I invest', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('bf10a18f-af66-5bcf-aa40-324996af864c', 'نضمن', 'nadmen', 'أضمن', 'I guarantee', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('db543ed1-d2f1-5cf9-a74b-570e82ebf6e5', 'شاف', 'chaf', 'رأى', 'he saw', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('356aa522-0992-5792-8dd3-ab3e2d49f6ec', 'نشوف', 'nchouf', 'أرى', 'I see', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('762d7495-a262-5bb2-8bf8-800a7a8bbc27', 'شفت', 'chfet', 'رأيت', 'I saw', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('61a085c3-e5a2-58d8-a120-13d88e8d8edd', 'تفرج', 'tfarraj', 'شاهد', 'he watched', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f5f7312a-2366-5b37-bdce-26f9f1872673', 'حكى', '7ka', 'تحدث', 'he spoke', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('bf0a62fb-0ee2-5b69-9b68-125245ee4f18', 'نحكي', 'na7ki', 'أتحدث', 'I speak', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('451af080-0f47-5d19-ab1a-16b87b8b597e', 'جاوب', 'jaweb', 'أجاب', 'he answered', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('dfb22203-58a5-59fe-abe2-459f79ed4eda', 'قرا', '9ra', 'درس', 'he studied / read', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('095b0bf8-9343-5dba-a83a-6aeaa540ce6c', 'نقرا', 'ne9ra', 'أقرأ', 'I read', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('86edb077-e738-520b-8c82-b6e260a98ed3', 'قرّى', '9arra', 'علّم', 'he taught', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('6f293388-8361-528a-b7f0-71e8fdfa0645', 'هبط', 'hbet', 'نزل', 'he went down', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('bd8c7b5f-6594-520d-88c0-e7573cb4e252', 'طلع', 'tla3', 'صعد', 'he went up', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('b99b9661-0975-5003-916e-0a5eef9eae73', 'عدى', '3adda', 'عبر', 'he crossed / passed', 0.8, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d9b19684-0e33-57bf-96d2-38c753db3c9d', 'لقا', 'l9a', 'وجد', 'he found', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('65403e8d-dffb-570f-9aeb-0c7af2d909c6', 'نلقى', 'nel9a', 'أجد', 'I find', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d0721ff5-8f75-59ab-a061-5e9359bb125a', 'فرّق', 'farra9', 'وزّع', 'he distributed', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3b8c42f1-757d-5b6e-8a37-313330368e74', 'زاد', 'zad', 'أضاف', 'he added', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('b007f1c3-e10d-550d-b707-49797bb68716', 'صلّح', 'salla7', 'أصلح', 'he repaired', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('14930540-f47d-5732-91e5-50bbe783fa1e', 'خرّب', 'kharreb', 'أتلف', 'he damaged', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('b8ccd8df-8d47-5a74-b963-87824fd33e35', 'حط', '7att', 'وضع', 'he put', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('7174d551-d9fe-57da-a5be-3fca3aad4389', 'نحط', 'na7ott', 'أضع', 'I put', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('fa956fba-2cb1-5bb2-bb87-525690bbf52e', 'شد', 'shadd', 'أمسك', 'he held', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f5a3246e-c19b-5a30-b5fe-dacd2ac3ff9d', 'يشد', 'yshadd', 'يمسك', 'he holds', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('2d33ea63-cfea-521f-9418-3fb1ce6f7095', 'عطى', '3ta', 'أعطى', 'he gave', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('4c2137be-4d38-5cfc-9aef-029c121b8806', 'نكري', 'nekri', 'أستأجر', 'I rent', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('ea830eee-acd6-5bd5-a4e8-cd420affcb91', 'رقد', 'rged', 'نام', 'he slept', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0159edab-82ee-59dc-9394-7aeb16f46a25', 'نرقد', 'narged', 'أنام', 'I sleep', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('1b9d5f3b-c6de-5305-84f8-2eeafe9205ec', 'فيق', 'faye9', 'استيقظ', 'he woke up', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('48105453-0772-5d24-a1f1-51af21782d96', 'نوض', 'noudh', 'قم', 'get up', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('08a32673-71d4-59f5-91de-8267c3bf07c4', 'عمر', '3ammar', 'ملأ', 'he filled', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d8f0d84e-72bc-5d22-9aa6-27f9e88d5f19', 'خوّى', 'khawwa', 'أفرغ', 'he emptied', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('22ae5ff2-312e-5c8b-9f92-1e7c4c98b975', 'لبس', 'lebes', 'ارتدى', 'he wore', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d9fced26-6ae7-5d63-a79b-ad7255d840e5', 'سكن', 'sken', 'يسكن', 'to reside', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f88e598b-5234-50c8-a868-955aeacb5068', 'تولد', 'twelled', 'تمت ولادته', 'he/she was born', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('9b1ee231-00d2-5cdb-a3c4-5ed88052ddac', 'فلوس', 'flous', 'أموال', 'money', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a1481443-1d2b-5474-aaf9-3ed6ff44b010', 'دراهم', 'drahem', 'نقود', 'money (lit. dirhams)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('60aa6388-ef66-55a6-9561-73c77a54534e', 'مصاري', 'msari', 'نقود', 'money (colloquial)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('36830df8-b185-5bd6-978a-01fbcf56cb9a', 'كاش', 'cash', 'نقدا', 'cash', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('7e54b816-6018-5329-8b4c-de2e4fdca8be', 'كرهبة', 'karhba', 'سيارة', 'car', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('13d3359c-d22c-5740-a354-0be163541197', 'طوموبيل', 'tomobil', 'سيارة', 'car (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('ba73ecea-b549-53ae-9006-9f4ccd2fd1e1', 'دار', 'dar', 'منزل', 'house', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('84144665-772b-53ca-9218-b7a9b4dece36', 'دار السكنى', 'dar sokna', 'عقار سكني', 'residential property', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('87fb7951-ff7f-5e84-81a0-54d61aa78a6b', 'بقعة', 'ba93a', 'قطعة أرض', 'plot of land', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('18dc2187-95c4-538f-9c52-bc01d0da5bcd', 'بيت', 'bit', 'غرفة', 'room', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('14575831-c4d6-5ce4-b599-c6f791a911cb', 'بيوت', 'byout', 'غرف', 'rooms', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('87c2e44b-a885-5f3e-8880-f41a05866283', 'حوش', '7ouch', 'فناء', 'courtyard / house compound', 0.75, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('2e3f4c75-42c2-5acd-8023-ed0d26be16ab', 'حانوت', '7anout', 'متجر', 'shop', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('f1d817ec-2772-5764-8ea4-7e780f26bb44', 'زنقة', 'zan9a', 'زقاق', 'alley', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0f6981a6-4a60-5a18-b933-ec35e49d93ad', 'ماكلة', 'makla', 'طعام', 'food', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('2643dee4-8f86-5a64-a875-4823fb99369e', 'خدمة على الخط', 'khedma 3la l khat', 'خدمة عبر الإنترنت', 'online service', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('81ac03c7-a9a3-5ef4-9976-5f2174e8ee15', 'ولد', 'wlid', 'ابن', 'son', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('11148f49-20d5-51a4-a006-b23a4fc7d8ba', 'ولاد', 'wlid', 'أبناء', 'children (plural)', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('5535d2ca-f02a-534e-8d33-dee4c1f874b0', 'مرا', 'mra', 'امرأة', 'woman', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0523848d-4be6-5b73-8e61-2dfd92cadcc1', 'راجل', 'rajel', 'رجل', 'man', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('61f724ec-3e3d-5308-872e-71b309c1c219', 'بابا', 'baba', 'والدي', 'my father', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('41b474a2-0c2d-5edc-935a-36971dd67fb2', 'أمية', 'omiya', 'والدتي', 'my mother', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('7335cf42-62dc-5998-9cec-fca15c3ac2f9', 'خويا', 'khouya', 'أخي', 'my brother', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('d7c6f668-cf3a-5956-aafe-dbed2840d0e7', 'صاحب', 'sa7eb', 'صديق', 'friend', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0c2e6877-691d-5a08-97fe-a4f8cbd5436b', 'بوليس', 'bawlis', 'شرطة', 'police', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('8e302d6f-70e0-574c-9f3c-ac924cbfa26f', 'سبيطار', 'sbitar', 'مستشفى', 'hospital', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('abd49124-d285-5032-8057-c99bf01af7d1', 'مطلب', 'matleb', 'طلب', 'application (form)', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('9ec72911-8c04-56f4-a1e8-93972a929dcc', 'دوسي', 'dossier', 'ملف', 'file (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('16fdfac4-651c-5be5-95be-ccf09a783c6b', 'فورمولار', 'formulaire', 'استمارة', 'form (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('eaef19d5-0c81-5760-b1aa-69a4ef069044', 'رونديفو', 'rendez-vous', 'موعد', 'appointment (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('9ade8b99-e9f3-53ad-abec-73b6182bd728', 'إمضاء', 'imdha2', 'توقيع', 'signature', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('44d4292c-9329-5e2e-8bf2-af5dd83c48f3', 'تيمبر', 'timbre', 'طابع جبائي', 'fiscal stamp (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('1b449849-c657-5365-938f-210f41094eec', 'بوليصة', 'bulisa', 'وثيقة تأمين', 'insurance policy', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('1990e7ea-53ab-5fb0-930f-c45ddb6ba06e', 'بوليصة تأمين', 'bulisa ta2min', 'وثيقة تأمين', 'insurance policy', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('e4219be1-8b0e-5a1e-a30e-60028a6c0a68', 'كناص', 'cnas', 'الصندوق الوطني للضمان الاجتماعي', 'CNSS (acronym)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3cd23c11-f284-5f04-ba08-444bb956dbeb', 'جراية', 'jraya', 'معاش', 'pension', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('462bb491-dd1f-51fd-a7f4-45599925f27b', 'عطلية', '3atliya', 'إجازة', 'leave / holiday', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('98bbf1cb-1ed0-5e5d-848b-e01784309f91', 'عرسة', '3arsa', 'حفل زفاف', 'wedding celebration', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('140b77ee-e378-5c02-965d-340443fbabb7', 'طاكسي', 'taksi', 'سيارة أجرة', 'taxi (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('24a54e22-f528-5e49-9efc-981ccab09c8a', 'لواج', 'louage', 'سيارة أجرة مشتركة', 'shared taxi', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('1bc7b30c-3903-506b-88a0-ffea63337bc1', 'كار', 'kar', 'حافلة', 'bus', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d1fc7c27-071d-515d-b931-eb6aa63e4afe', 'باص', 'bus', 'حافلة', 'bus (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f6a3436c-146d-54cf-9f2a-d01feaeb67e0', 'تران', 'tren', 'قطار', 'train (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('d66a20cd-5393-5b48-95ce-a9c40778f392', 'عسكر', '3askar', 'جيش', 'army', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('60225f8b-5acf-5eca-a7d2-0541e62db130', 'شابكة', 'chabaka', 'شبكة', 'network', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('7cc5fc33-248d-54dc-8114-694480ccb227', 'جوال', 'jawwal', 'هاتف محمول', 'mobile phone', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('2f98cae2-8bd4-59b5-ad85-37bf99dfa8d6', 'بورتابل', 'portable', 'هاتف محمول', 'mobile phone (loan)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('4d8b256c-b21d-5de3-98b7-db5f1ea423ff', 'إيميل', 'email', 'بريد إلكتروني', 'email (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d04b688a-163f-5cb0-afdb-751235c42a53', 'كلمة السر', 'kalmet sirr', 'كلمة المرور', 'password', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f0e2b5e0-67ce-5cd8-a5c0-45c12998f0ae', 'باسورد', 'password', 'كلمة المرور', 'password (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('b4bfacc4-f834-5099-9351-3145a3cc724f', 'بلاصة', 'blasa', 'مكان', 'place', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('06f5543a-a88d-5f37-8a9c-baf193bafe5d', 'شكاية', 'chakaya', 'شكوى', 'complaint', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('264e52db-3a89-557f-b489-239925bc710f', 'إشكال', 'ichkal', 'مشكلة', 'problem', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('b06c3d48-d311-5dbd-885a-c85ea4808955', 'مشكل', 'mochkol', 'مشكلة', 'problem', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a76423c0-2575-5a67-80cc-1c36483c5b5d', 'صابة', 'saba', 'محصول', 'harvest', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('773ca046-da2e-56b2-b382-f55cd02220a1', 'باعث مشروع', 'ba3eth machrou3', 'صاحب مشروع', 'entrepreneur', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f3577e97-dc11-59e6-9798-800aa9921163', 'باطرون', 'patron', 'صاحب العمل', 'employer (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('5df7fecf-0d57-5958-8af8-b16313743ab9', 'خديم', 'khedim', 'عامل', 'worker', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d74f091c-7c27-5198-a9e8-9b8ddca4db00', 'مضمون ولادة', 'madhmoun wleda', 'شهادة ميلاد', 'birth certificate', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('e81c15c2-f943-5e26-89c4-f43dec2e86dd', 'عقد ولادة', '3aqd wleda', 'شهادة ميلاد', 'birth certificate (variant)', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('02cd997f-5178-586c-aa9b-46ca87f02433', 'شهادة شغل', 'chahdet choghl', 'شهادة عمل', 'employment certificate', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('daff5d2f-2128-5e51-9e11-581837fc771a', 'شهادة في الأجرة', 'chahda fil ojra', 'شهادة في الأجر', 'salary certificate', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('c29ac613-721f-5c51-9bc5-3ffaf353608b', 'كشف خلاص', 'kachef khalles', 'كشف أجور', 'payslip', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('e952747e-29ec-576d-be63-d912009d4f64', 'معارضة', 'mo3aradha', 'اعتراض', 'stop-payment / objection', 0.8, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('b5e66af7-61a9-504a-915d-d287126b4df6', 'معارضة على شيك', 'mo3aradha 3la chik', 'اعتراض على شيك', 'cheque stop-payment', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('595016a0-028f-5c99-a691-7c078abeba47', 'كمبيالة', 'kambiela', 'سند إذني', 'promissory note', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('070c03f0-1216-5ed3-8770-2d1a2fccce8b', 'سمانة', 'smana', 'أسبوع', 'week', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('e55c3d3c-55e3-547f-8ea0-55b7fffa2181', 'حريف', '7rif', 'عميل', 'customer', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('c16c5de7-3c5e-5b32-a41f-3948cd094180', 'حرفاء', '7rafa', 'عملاء', 'customers', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('57a69556-8211-507c-9d67-45440c96c628', 'كونت', 'compte', 'حساب', 'account (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('1473d514-5248-5f9d-92b8-7feeef84139c', 'حساب جاري', '7sab jari', 'حساب جار', 'current account', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('066a306c-872c-541a-8e76-34ec7a7b90ac', 'حساب توفير', '7sab tawfir', 'حساب ادخار', 'savings account', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3f419596-bf62-50ab-b499-adb0b3b4b531', 'بلا رصيد', 'bla rsid', 'دون رصيد', 'without funds', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('69a1af64-c75a-5a8d-a2c6-d1652e574723', 'شيك بلا رصيد', 'chik bla rsid', 'شيك دون رصيد', 'bounced cheque', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('acb33f0c-7119-5b8c-9a02-0b48f6243ccd', 'غالي', 'ghali', 'مرتفع الثمن', 'expensive', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f5d42283-7fc4-5520-bb20-c25467db16b1', 'معلوم', 'ma3loum', 'رسم', 'fee', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('66ef87e0-b530-55d5-8a55-ab5cf76c9265', 'معاليم', 'ma3alim', 'رسوم', 'fees (plural of ma3loum)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('b40e721b-5ac3-5384-b8aa-97d825a51c43', 'معلوم الشهر', 'ma3loum chhar', 'الرسم الشهري', 'monthly fee', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0a2a195e-6814-544c-a0f3-aa8f11733fe9', 'خطية', 'khatiya', 'غرامة', 'fine / penalty', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('04391d42-6ee6-593d-aa06-c107d93eeeca', 'أداء', 'ada2', 'أداء جبائي', 'tax', 0.7, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('21e151e0-1807-5ee3-af4c-c3f2fe7420e0', 'معرف جبائي', 'mo3aref jebayi', 'المعرف الجبائي', 'tax identification number', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('6d6f035d-feec-5336-81a2-d26affd657f6', 'كرطة', 'kar9a', 'بطاقة', 'card', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('1be284ce-ccf6-5512-b752-41bbb10a6e36', 'كرطة بنكية', 'kar9a bankiya', 'بطاقة بنكية', 'bank card', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('8696396a-d3e5-5b5f-b4fc-3ce65a31236f', 'كرطة خلاص', 'kar9a khalles', 'بطاقة دفع', 'payment card', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3c0a82f6-97b4-5a03-97dc-167fdfa36a44', 'كود', 'code', 'رمز', 'code (loan)', 0.8, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('57b60b18-52e7-54f0-9060-972f22037844', 'رقم سري', 'ra9m sirri', 'رمز سري', 'secret code / PIN', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('9fc3a82b-6bc1-5385-9ef4-62c2441c7abe', 'فيرمان', 'virement', 'تحويل', 'transfer (loan)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('94bb2e3b-0304-5ac9-9366-207babb58fb4', 'فيرمان بنكي', 'virement banki', 'تحويل مصرفي', 'bank transfer', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('dfb95e9c-441c-5f53-94fd-30e0cc4600ef', 'تحويل بنكي', 'ta7wil banki', 'تحويل مصرفي', 'bank transfer', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('850cb421-edb6-5ce3-b267-02a8b100b7f4', 'تسبقة', 'tesbi9a', 'دفعة مقدمة', 'advance payment', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('52ed97e9-0289-546b-beb7-8f979255bd8e', 'سلفة', 'slfa', 'قرض', 'loan (small, colloquial)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('7c858f0b-2210-5746-a799-44967622b83a', 'قرض سكني', 'qardh sokni', 'تمويل سكني', 'housing loan', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('53001e13-5e95-5324-bf87-acacb964096c', 'قرض استهلاكي', 'qardh istihlaki', 'تمويل استهلاكي', 'consumer loan', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('0088df2f-268a-58ce-b5d7-d0466a824915', 'مديون', 'madyoun', 'مدين', 'indebted', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('dd9961de-95fa-5713-8720-9a5721e06c0f', 'ترفيع', 'tarfi3', 'زيادة', 'increase (Tunisian usage)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('117edb4b-2d82-5aef-9825-cfc6a15020c4', 'نقصان', 'nassen', 'نقص', 'decrease', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('27a126bf-6cd9-5c84-be3b-11b637a7bd0e', 'الجاب', 'el GAB', 'الموزع الآلي', 'the ATM (guichet automatique bancaire)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3960c857-68b0-5022-9e9b-cfff4dd2a5a6', 'بنكي', 'banki', 'مصرفي', 'banker / banking (adj.)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('2437c254-7aad-59ca-89cc-bd21f29b7c6f', 'كري', 'kri', 'إيجار', 'rent (noun)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('75f4ab7f-4ff5-5606-9931-fa3a9a53fa0b', 'كراء', 'kira2', 'إيجار', 'rent / lease', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('fe0b9d6d-bfa6-5404-b246-3fb84db513ea', 'وراثة', 'wratha', 'إرث', 'inheritance', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('5b6d5870-6d2d-5411-900b-e82b58efc20f', 'ربي يبارك', 'rabbi ybarek', 'بارك الله', 'may God bless', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('ab44f2fc-16b1-5825-8a40-4f1c9914dfc3', 'بسلامة', 'bslama', 'مع السلامة', 'goodbye', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('0fcb4cc6-bbcd-565c-a07e-fd8cfdda40df', 'لاباس', 'labes', 'لا بأس', 'fine / no problem', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3dc2132d-0d7f-55e9-8b43-1556a95f5ac2', 'سمحلي', 'sama7li', 'اعذرني', 'excuse me', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('7e828a36-5f4b-51b0-bfa3-578e63f5f9a4', 'سمحولي', 'sama7li', 'اعذروني', 'excuse me (plural)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('5119bfb6-ba2b-5622-bf88-758b3d1fb6ff', 'عيشك', '3aychek', 'شكرا', 'thank you', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('01480f08-ede0-56b6-86a3-57ce291c5ad6', 'يعيشك', 'ya3aychek', 'شكرا لك', 'thank you (more common)', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('8d4cfc5d-3006-5611-8134-a04ed51a07b6', 'بالصحة', 'bessaha', 'بالهناء', 'to your health (congratulatory)', 0.8, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('eca6ae23-ead8-58c8-b285-64c2730f379b', 'وصل', 'wasl', 'إيصال', 'receipt', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('fadf434e-c24a-5235-97e1-2b60fb313697', 'رأس مال', 'ras mal', 'رأس المال', 'capital', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a6f9151e-fdb3-52ac-b190-1c3c4507fba1', 'قيمة شرائية', 'qima chira2iya', 'قوة شرائية', 'purchasing power', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('b4cd30ed-e38b-5d21-82d5-49cbbf325c08', 'باهي', 'behi', 'جيد', 'good', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('1c985fe7-a128-5fa1-b419-d0f83d4eab6f', 'مليح', 'mlih', 'حسن', 'good / fine', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('6710e6cf-d5ab-5232-a01c-bcfdf25492e4', 'خايب', 'khayeb', 'سيئ', 'bad', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('27b75d6a-6f71-5562-a151-009eab9dbdb7', 'غالط', 'ghalet', 'خاطئ', 'wrong', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('13226fc2-996f-590d-a8ff-9061ce2d47a2', 'غالطة', 'ghalta', 'خطأ', 'mistake', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('145e35fd-f7e3-5cb9-9b67-b192a55e9dc1', 'صعيب', 's3ib', 'صعب', 'difficult', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('08c3b02e-99c8-5fef-a47c-f1dfc75938cb', 'صعيبة', 's3iba', 'صعبة', 'difficult (fem.)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('ed72d9a9-069d-5282-875c-079dab14705a', 'كامل', 'kamel', 'كل', 'all / entire', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('4833cb25-f539-5449-a9c4-9f57c5edc3de', 'الكل', 'ell kol', 'الجميع', 'everyone / all of it', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a56c8c21-6b97-57f6-9057-154a6edc533d', 'خاوي', 'khawi', 'فارغ', 'empty', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('7ef283f8-fc5e-5f30-a73d-d052f7b63801', 'مليان', 'melyan', 'ممتلئ', 'full', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('7cef08d3-c398-5c58-8b37-f70d51615654', 'مسكر', 'msaker', 'مغلق', 'closed', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('6db326f2-3033-5fa5-a599-761c08e5750b', 'مليح الحال', 'mlih l 7al', 'بخير', 'well / in good condition', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('93ee4308-00d7-5b6e-b881-ff8b07fd7968', 'ساخن', 'sakhen', 'حار', 'hot', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('1a33178c-7ae2-5be8-bc21-9f2684644e6d', 'وسخ', 'wasekh', 'قذر', 'dirty', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('697a67e9-ae77-5731-9cd3-95e74d327efa', 'زين', 'zin', 'جميل', 'beautiful', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('34a65d39-9f33-524a-88db-cae834cdb952', 'حلوة', '7elwa', 'جميلة', 'beautiful (fem.)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('cb7ebb59-0848-52e7-9553-cbe8bc40730f', 'عالي', '3ali', 'مرتفع', 'high', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0549d534-7a08-5611-90d1-6fd41da8cf64', 'واطي', 'wati', 'منخفض', 'low', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('c963b463-a87f-5d0c-abf1-dcd0a85d9d47', 'براني', 'barrani', 'خارجي', 'external / foreign', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('052cb1c7-b634-5e77-9bf7-85807c5f5117', 'تسعود', 'tes3oud', 'تسعة', 'nine', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('346b201b-004b-5cd5-8e9d-49ab56541d38', 'نص', 'noss', 'نصف', 'half', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f1a7be7d-d965-5ab5-857c-b22ba8589076', 'برشة', 'barcha', 'كثيرا', 'a lot / very', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('bc9ddf32-398b-53b2-a9cc-3eadd70e9d9d', 'شوية', 'chwaya', 'قليلا', 'a little', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('031ccae3-07a1-5144-be17-d31ec9325333', 'شوية شوية', 'chwaya chwaya', 'تدريجيا', 'little by little', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f551a843-1104-57e0-a1a1-24d2ecfa7b83', 'توا', 'tawa', 'الآن', 'now', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('b2072352-1faf-5d85-adb4-f70a239b1b32', 'توة', 'tawa', 'الآن', 'now (variant)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('5b5bcbf7-b746-58e8-b35a-0d59c25dd2f7', 'البارح', 'el bare7', 'أمس', 'yesterday', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0ca8f2bd-eb4e-541c-b039-005e32498cf3', 'غدوة', 'ghodwa', 'غدا', 'tomorrow', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('8abd36fe-f10c-563d-bbb2-dfabfa6dea43', 'العشية', '3chiya', 'المساء', 'evening', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('72021a7a-4505-55a7-b525-59ca1086f207', 'نهار', 'nhar', 'يوم', 'day', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('d0fab397-8acc-5bd8-a89a-e4503d247034', 'ديما', 'dima', 'دائما', 'always', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('06ff66de-bccc-5b7e-a3a6-8e4cc9dd2aaa', 'مرات', 'merrat', 'أحيانا', 'sometimes', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('50ef8521-259f-58e2-8aeb-d3f08c0a9790', 'هوني', 'houni', 'هنا', 'here (variant)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('fc5a06db-361d-5e97-ac5c-106827c5bd84', 'تما', 'temma', 'هناك', 'there', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('eb81e1ff-dc73-5f7d-932d-115776a6c724', 'برا', 'barra', 'خارج', 'outside', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('655e5dc3-9c11-5397-8ba9-5b8ebdb605e1', 'عند', '3and', 'لدى', 'at / has (possession)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('27d39e84-1174-5253-946d-643ba3ad7683', 'عندك', '3andek', 'لديك', 'you have', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('f77cdf99-cdb4-535a-af32-72afd0bc09e8', 'عندي', '3andi', 'لدي', 'I have', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('513805f2-c292-5bc1-92ec-240f44304073', 'عندنا', '3andna', 'لدينا', 'we have', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('91fb99f8-aefe-5b26-bf92-27a348895dc8', 'متاع', 'mte3', 'خاص بـ', 'belonging to (genitive)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('896f883b-f910-54bc-9ed9-aa462c63629e', 'متاعي', 'mte3i', 'خاص بي', 'mine', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('436d970f-0479-5b6c-95e3-22576c6d0606', 'معايا', 'm3aya', 'معي', 'with me', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('9827d60d-2a16-57e4-a599-ba61141b52a0', 'معاك', 'm3ak', 'معك', 'with you', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('8c298f66-7428-5309-8723-0833b5831e51', 'باش', 'bch', 'من أجل', 'in order to', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('be637dc8-f6c4-542d-af55-6d206fc99476', 'كان', 'ken', 'إذا', 'if', 0.7, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('18c5ca16-9469-527e-ae76-953ab46113a8', 'برك', 'bark', 'فقط', 'only', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('4e23f2e3-1fca-53c7-b5b6-0c1839451c18', 'زادة', 'zeda', 'أيضا', 'also', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('8daf630f-5856-5afb-b514-d580f2a0746f', 'زيد', 'zid', 'زد', 'more / add', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3fa4cb2c-cf37-5869-84a9-b3302bcf233e', 'كيما', 'kima', 'مثل', 'like / as', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3ae5211a-6e1a-5040-9cbe-f0a831e15873', 'كيف كيف', 'kif kif', 'نفسه', 'the same', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('bdcaa33d-10f0-5465-82aa-21c7195840b2', 'هكا', 'heka', 'هكذا', 'like this', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('757cc06b-db04-5b0f-8168-239c377b7b4b', 'هكاك', 'hekkak', 'هكذا', 'like that', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('e56a6abf-a7ca-5899-b466-bd5ac6ece308', 'هكة', 'heka', 'هكذا', 'thus', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('b85cf2a1-e012-551c-9e13-a1b14a2fb9de', 'على خاطر', '3la khater', 'لأن', 'because', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('6b49ee59-e374-58dd-956c-531357f45317', 'خاطر', 'khater', 'لأن', 'because', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('74f86eb6-ae72-59be-965e-67e9bebe7931', 'تالي', 'tali', 'التالي', 'next', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('35621453-f2b6-5215-bc35-2a6719f6da4b', 'على الخط', '3la l khat', 'عبر الإنترنت', 'online', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d1d5e838-b1b3-54af-99dd-b5f987fe709d', 'بالشوية', 'bchwaya', 'ببطء', 'slowly', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('596ccc21-7b99-599e-a81d-b9f247e652fd', 'بالطبيعة', 'bettabi3a', 'بالطبع', 'of course', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a35cb081-70c2-53cb-89a0-ef496b11274c', 'بعدا', 'ba3da', 'أولا', 'first of all', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('30a33dfc-fe46-5eea-bf80-45266ea1c5f0', 'بوحده', 'bou7dou', 'وحده', 'alone', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3cbdeb0d-a58f-57c2-aff2-9273ecf86def', 'من بعد', 'men ba3d', 'فيما بعد', 'afterwards', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('898a8fcf-98a6-5efc-8ce1-2cf1725641c4', 'من قبل', 'men qbel', 'سابقا', 'previously', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('32f74e88-105f-5349-a78d-2a08692c6594', 'على طول', '3la toul', 'مباشرة', 'straight away', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0abf67c3-ae8a-5aef-89f2-1dde8c1491e4', 'كل مرة', 'kol marra', 'في كل مرة', 'each time', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('27ae77f0-ce40-522a-9ab4-10850cc61315', 'قدام', '9oddem', 'أمام', 'in front of', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('7bde2043-2d1b-5ebe-abc0-a023e3ab2ebd', 'ورا', 'wra', 'خلف', 'behind', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3d47acd2-39ff-5328-8f04-b44501d4ff7d', 'جنب', 'jneb', 'بجانب', 'beside', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('e48d2b69-458f-5058-bc2d-09f900392bcd', 'جمعة', 'jem3a', 'أسبوع', 'week', 0.6, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('603dc784-a32d-51b6-a22c-538edd6488cf', 'دين', 'din', 'دَين', 'debt', 0.55, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('6a39e917-c5f5-506f-82f3-df5c607eebff', 'شهرية', 'chahriya', 'قسط شهري', 'monthly instalment', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a75c7c66-ffe1-590f-bcc9-a1dff75cc927', 'مرحبا', 'mar7ba', 'أهلا', 'welcome', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('78b22a4e-59b0-5165-8356-940355ffbac4', 'خدمة', 'khedma', 'عمل', 'work (noun)', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('33770626-f145-5ff7-9c74-567ebc67c1f5', 'شغل', 'choghl', 'عمل', 'work', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('01022d86-fd15-5252-9b23-93edfaafd024', 'بطاقة تعريف', 'bar9a ta3rif', 'بطاقة هوية', 'identity card', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('bf007bf4-bd0e-5e0f-a60e-7191e1c27d59', 'بنت', 'bent', 'ابنة', 'daughter', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0f20118e-2486-5147-9f57-6471f708fc8c', 'ضمان بنكي', 'dhaman banki', 'ضمان مصرفي', 'bank guarantee', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d95822a0-863d-5ec4-bd93-fe91d838f821', 'اثنين', 'thnin', 'اثنان', 'two', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('dae2bcde-778a-543c-844d-caa29326f63a', 'عشرين', '3chrin', 'عشرون', 'twenty', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3b14a97b-d5d3-5e07-969d-3478e6427014', 'اللي', 'elli', 'الذي', 'who / which (relative marker)', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('2519699d-c5a4-560c-8126-834bc36115ad', 'حاجة', '7aja', 'شيء', 'thing', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('bc49d97a-be3a-5efd-8b65-374c29020599', 'حوايج', '7wayej', 'أشياء', 'things', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('4c2b8cd1-5f2f-52bd-bf40-f65466e57656', 'ياسر', 'yaser', 'كثيرا', 'a lot (Tunisian)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3a9a573c-063e-51c4-8513-3e29b745d7a9', 'بزاف', 'bizzaf', 'كثيرا', 'a lot (Maghrebi)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3dfd7d87-25d9-53e9-9a10-51eb8219a11a', 'أحسن', 'a7sen', 'أفضل', 'better', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('a9f654b4-6b52-5d40-b92d-02d242577a64', 'أردأ', 'arda2', 'أسوأ', 'worse', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('8595a4da-49c2-554a-a267-149749d7246a', 'خير', 'khir', 'أفضل', 'better (than)', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('4dd9df7e-1fce-5ca2-91d4-3600e813db9d', 'بحال', 'b7al', 'مثل', 'like / as (Maghrebi)', 0.85, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('2377c0a0-c3b6-54b3-a787-292698beccf6', 'بيدو', 'bidou', 'بنفسه', 'by himself', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('8ffd9b9d-9480-52eb-8c14-b0c45534478e', 'راسو', 'rasou', 'نفسه', 'himself', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('9fb607de-efb2-56c0-9271-d9988b12137e', 'راسي', 'rasi', 'نفسي', 'myself', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d9681346-1ac4-552c-b003-f2f32fab5a7a', 'هاني', 'hani', 'ها أنا', 'here I am', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0bb8108c-9d2e-5ba8-95bc-ef36ffd578a6', 'هاك', 'hak', 'خذ', 'take (imperative)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('bffc15e3-062f-558e-8191-08c2f33af778', 'هذاكة', 'hadhaka', 'ذلك', 'that (masc.)', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('ffbc2b6f-b950-5290-bbe4-66891b9d8070', 'هاكة', 'haka', 'تلك', 'that (fem.)', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('b06e4ef6-a8d4-502b-adfe-01e3253d36a2', 'المرة الجاية', 'el marra ejjeya', 'المرة القادمة', 'next time', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('cc74410f-dfb5-55cf-b251-2cee95f52387', 'المرة اللي فاتت', 'el marra elli fatet', 'المرة الماضية', 'last time', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('2b70168b-cc4e-5ec9-9f8b-5b2b037e326a', 'العام الجاي', 'el 3am ejjay', 'السنة القادمة', 'next year', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('e29df65a-478d-56f0-91cc-1acd81d42760', 'العام اللي فات', 'el 3am elli fat', 'السنة الماضية', 'last year', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('6a9d8866-8156-571e-b85e-2305408b2a9a', 'الشهر الجاي', 'ech chhar ejjay', 'الشهر القادم', 'next month', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('84086ed9-a31d-51e4-8952-b9823dbfdb97', 'الشهر اللي فات', 'ech chhar elli fat', 'الشهر الماضي', 'last month', 0.98, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('723a6145-8f85-5b17-ae22-16978efd5945', 'الجاي', 'ejjay', 'القادم', 'the coming / next', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('3147b36e-f16d-5ed4-b535-ae24c4cf42c5', 'الفات', 'elli fat', 'السابق', 'the previous', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('79ab2a92-398a-5519-a1a3-fa99954663f0', 'غدوة الصباح', 'ghodwa sbeh', 'غدا صباحا', 'tomorrow morning', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('9cc33092-fdab-5df5-9bb8-05934ea5dda9', 'ودن', 'wden', 'أذن', 'ear', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('ad1bba1d-5842-5fff-88f3-86dc13f7ee25', 'كرش', 'karch', 'بطن', 'belly', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('512856eb-50f8-593e-a74b-659d84897d6c', 'ساقي', 'sa9i', 'قدمي', 'my foot / leg', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('52b1700e-bcc8-5157-abe6-d2a380f2bb61', 'زوج', 'zouj', 'اثنان', 'two', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('8ff1718e-bd37-539f-a74e-55dc9e77466c', 'ثلاث', 'thleth', 'ثلاثة', 'three', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('1954ce86-d2e0-59db-9cde-2296875a054c', 'خمس', 'khams', 'خمسة', 'five', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');
INSERT INTO derja_msa_map (id, derja_ar, derja_latin, msa, gloss_en, confidence, source, status, created_by) VALUES
  ('f24ea28a-cf24-5104-bcf0-a0939ec1edd3', 'عشر', '3achr', 'عشرة', 'ten', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('d2a2086d-9c7e-5862-a787-fc68b2585039', 'وحد', 'wa7d', 'واحد', 'one', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('126eddc8-6b1b-5fc1-9583-460e5aa761bd', 'سوايع', 'swaye3', 'ساعات', 'hours', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('270bd4aa-9258-5671-ac2b-aa0985f6a7e9', 'شهور', 'chhour', 'أشهر', 'months', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('dc78072c-12f9-513b-a99a-cdbb6f60ba45', 'سنين', 'snin', 'سنوات', 'years', 0.95, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect'),
  ('0e57104f-4af8-52aa-990b-feb3fe66d1b2', 'أيامات', 'eyyamat', 'أيام', 'days', 0.9, 'SEED', 'ACTIVE', 'flyway:V903__seed_dialect');

-- ── invariants a reviewer can re-run ─────────────────────────────────────────────────────────────
-- SELECT count(*) FROM derja_msa_map;                        → 366
-- SELECT count(*) FROM derja_msa_map WHERE derja_latin IS NOT NULL;  → 366
-- SELECT count(*) FROM derja_msa_map WHERE confidence < 0.80; → 6
-- SELECT count(*) FROM derja_msa_map WHERE source <> 'SEED';  → 0
-- SELECT count(*) FROM derja_msa_map WHERE status <> 'ACTIVE'; → 0
--
-- Context-gated rows (the mapping is conditional; see contextWhen in specs/i18n/derja-msa.json):
--   ماشي → لا يعمل   when query reports a malfunction
--   مازال → لم يحن بعد   when followed by a negated or expected event
--   عدى → عبر   when followed by a place or a time complement
--   حوش → فناء   when never applied to a property-finance question
--   بوليصة → وثيقة تأمين   when query is not about a generic document upload
--   معارضة → اعتراض   when query mentions a cheque or a card
--   معلوم → رسم   when query mentions a tariff, a fee or a document stamp
--   أداء → أداء جبائي   when query is fiscal (VAT, tax ID, stamp duty)
--   كان → إذا   when no finite verb immediately follows
--   جمعة → أسبوع   when query is a duration question, not a date question
--   دين → دَين   when intent is financial and not SHARIA_CONCEPT
