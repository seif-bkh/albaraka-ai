-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--  Al-Mouchir — schema behavioural tests
--
--  Proves the three hard guarantees of docs/adr/ADR-006-sharia-review-gate.md against a real
--  PostgreSQL instance:
--    G1  chunk.searchable is the Sharia gate, maintained by trigger, and never true by accident
--    G2  audit_event is append-only and hash-chained (tampering is detectable)
--    G3  two-eyes: no self-approval, and a T3 subject needs the Sharia-officer + compliance quorum
--    G4  albaraka_fts indexes every token class the corpus actually contains — integers, decimals,
--        version numbers, URLs and Arabic — and runs on a UTF8 cluster
--
--  Run with ON_ERROR_STOP: any failed assertion aborts the script with a non-zero exit code.
--    psql -v ON_ERROR_STOP=1 -f specs/db/schema.sql -f specs/db/tests/schema_test.sql
--  Each assertion prints "PASS: …" via RAISE NOTICE.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET search_path TO albaraka_ai, public;
SET client_min_messages TO NOTICE;

-- ───────────────────────────── fixtures ─────────────────────────────
INSERT INTO collection (id, code, name_fr, name_ar, name_en)
VALUES ('11111111-1111-7111-8111-111111111111', 'PRODUCTS_RETAIL_TEST',
        'Produits particuliers (test)', 'منتجات الأفراد (اختبار)', 'Retail products (test)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO document (id, collection_id, title_fr, title_ar, source_lang, classification, audience,
                      product_codes, valid_from, valid_to, lifecycle_state, created_by)
VALUES ('22222222-2222-7222-8222-222222222222', '11111111-1111-7111-8111-111111111111',
        'Mourabaha — particuliers (test)', 'المرابحة — الأفراد (اختبار)', 'fr-FR',
        'PUBLIC', 'PUBLIC', '{MOURABAHA}', current_date - 1, current_date + 365,
        'DRAFT', 'tester')
ON CONFLICT DO NOTHING;

INSERT INTO document_version (id, document_id, version_no, body_text, body_lang, state, body_sha256, created_by)
VALUES ('33333333-3333-7333-8333-333333333333', '22222222-2222-7222-8222-222222222222', 1,
        'La Mourabaha est une vente au prix de revient majoré d''une marge bénéficiaire convenue.',
        'fr-FR', 'DRAFT', 'deadbeef', 'tester')
ON CONFLICT DO NOTHING;

INSERT INTO chunk (id, document_version_id, ordinal, content, heading_path, token_count, lang,
                   normalized_text, audience, classification, product_codes, content_sha256)
VALUES ('44444444-4444-7444-8444-444444444444', '33333333-3333-7333-8333-333333333333', 1,
        'La Mourabaha est une vente au prix de revient majoré d''une marge bénéficiaire convenue.',
        '{Mourabaha,Définition}', 24, 'fr-FR',
        'mourabaha vente prix revient majore marge beneficiaire convenue',
        'PUBLIC', 'PUBLIC', '{MOURABAHA}', 'cafe01')
ON CONFLICT DO NOTHING;

-- ───────────────────────────── G1 · the Sharia gate ─────────────────────────────
DO $$
DECLARE s boolean;
BEGIN
  SELECT searchable INTO s FROM chunk WHERE id = '44444444-4444-7444-8444-444444444444';
  IF s THEN RAISE EXCEPTION 'TEST FAILED G1a: a DRAFT chunk must not be searchable'; END IF;
  RAISE NOTICE 'PASS G1a: draft content is unreachable (searchable=false)';
END $$;

-- embedding alone must not make content reachable
INSERT INTO chunk_embedding (chunk_id, embedding_h, model, dim, task_type)
VALUES ('44444444-4444-7444-8444-444444444444', NULL, 'gemini-embedding-001', 1536, 'RETRIEVAL_DOCUMENT');

UPDATE chunk SET embedding_status = 'EMBEDDED', embedding_model = 'gemini-embedding-001',
                 embedding_dim = 1536
 WHERE id = '44444444-4444-7444-8444-444444444444';

DO $$
DECLARE s boolean;
BEGIN
  SELECT searchable INTO s FROM chunk WHERE id = '44444444-4444-7444-8444-444444444444';
  IF s THEN RAISE EXCEPTION 'TEST FAILED G1b: an embedded but unapproved chunk must not be searchable'; END IF;
  RAISE NOTICE 'PASS G1b: embedding without approval does not publish anything';
END $$;

-- approval + publication flips the gate in one update
UPDATE document_version SET state = 'PUBLISHED', published_at = now(), published_by = 'sharia-officer'
 WHERE id = '33333333-3333-7333-8333-333333333333';

DO $$
DECLARE s boolean; a boolean; p boolean;
BEGIN
  SELECT searchable, sharia_approved, published INTO s, a, p
    FROM chunk WHERE id = '44444444-4444-7444-8444-444444444444';
  IF NOT (s AND a AND p) THEN
    RAISE EXCEPTION 'TEST FAILED G1c: publishing an approved version must make its chunks searchable (searchable=%, approved=%, published=%)', s, a, p;
  END IF;
  RAISE NOTICE 'PASS G1c: publish transaction propagates approval to chunks and opens the gate';
END $$;

-- machine-translated content cannot be approved without human verification
DO $$
BEGIN
  BEGIN
    INSERT INTO chunk (id, document_version_id, ordinal, content, lang, normalized_text,
                       is_translation, machine_translated, human_verified,
                       published, sharia_approved, embedding_status, content_sha256)
    VALUES ('55555555-5555-7555-8555-555555555555', '33333333-3333-7333-8333-333333333333', 2,
            'المرابحة بيع بثمن التكلفة مع هامش ربح متفق عليه', 'ar-TN',
            'مرابحه بيع ثمن تكلفه هامش ربح متفق عليه',
            true, true, false, true, true, 'EMBEDDED', 'cafe02');
    RAISE EXCEPTION 'TEST FAILED G1d: an unverified machine translation must not be approvable';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS G1d: unverified machine translation cannot be Sharia-approved';
  END;
END $$;

-- withdrawal closes the gate immediately
UPDATE document_version SET state = 'WITHDRAWN'
 WHERE id = '33333333-3333-7333-8333-333333333333';
DO $$
DECLARE s boolean;
BEGIN
  SELECT searchable INTO s FROM chunk WHERE id = '44444444-4444-7444-8444-444444444444';
  IF s THEN RAISE EXCEPTION 'TEST FAILED G1e: withdrawn content must stop being searchable'; END IF;
  RAISE NOTICE 'PASS G1e: emergency withdrawal removes content from retrieval at once';
END $$;

-- expired validity closes the gate (the column trigger does it inline; the sweeper is the backstop
-- for rows whose validity lapsed without any write)
UPDATE document_version SET state = 'PUBLISHED' WHERE id = '33333333-3333-7333-8333-333333333333';
UPDATE chunk SET valid_to = current_date - 1 WHERE id = '44444444-4444-7444-8444-444444444444';
DO $$
DECLARE s boolean; n integer;
BEGIN
  SELECT searchable INTO s FROM chunk WHERE id = '44444444-4444-7444-8444-444444444444';
  IF s THEN RAISE EXCEPTION 'TEST FAILED G1f: expired content must leave retrieval immediately'; END IF;
  n := fn_sweep_chunk_validity();
  SELECT searchable INTO s FROM chunk WHERE id = '44444444-4444-7444-8444-444444444444';
  IF s THEN RAISE EXCEPTION 'TEST FAILED G1g: validity sweeper must keep expired content unreachable'; END IF;
  RAISE NOTICE 'PASS G1f: expired validity closes the gate inline (sweeper backstop found % row(s))', n;
END $$;

-- restore a clean state for the governance tests
UPDATE chunk SET valid_to = NULL WHERE id = '44444444-4444-7444-8444-444444444444';

-- ───────────────────────────── G3 · two-eyes & quorum ─────────────────────────────
INSERT INTO sharia_review (id, ref, subject_type, subject_id, risk_tier, state, submitted_by, due_at)
VALUES ('66666666-6666-7666-8666-666666666666', 'R-TEST-0001', 'DOCUMENT_VERSION',
        '33333333-3333-7333-8333-333333333333', 'T3_HIGH', 'IN_REVIEW', 'alice.editor',
        now() + interval '5 days');

DO $$
BEGIN
  BEGIN
    INSERT INTO review_task (id, review_id, assignee_role, assignee_id, required, decision, decided_at)
    VALUES ('77777777-7777-7777-8777-777777777777', '66666666-6666-7666-8666-666666666666',
            'SHARIA_OFFICER', 'alice.editor', true, 'APPROVE', now());
    RAISE EXCEPTION 'TEST FAILED G3a: a submitter must not be able to approve their own submission';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS G3a: self-approval rejected by trigger (GOVERNANCE.SELF_APPROVAL)';
  END;
END $$;

-- a single Sharia approval is not enough for T3: compliance is also required
INSERT INTO review_task (id, review_id, assignee_role, assignee_id, required, decision, decided_at)
VALUES ('77777777-7777-7777-8777-777777777701', '66666666-6666-7666-8666-666666666666',
        'SHARIA_OFFICER', 'bob.sharia', true, 'APPROVE', now());

DO $$
BEGIN
  BEGIN
    UPDATE sharia_review SET state = 'APPROVED' WHERE id = '66666666-6666-7666-8666-666666666666';
    RAISE EXCEPTION 'TEST FAILED G3b: T3 approval without a compliance decision must be refused';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS G3b: T3 quorum enforced (GOVERNANCE.QUORUM_NOT_MET)';
  END;
END $$;

INSERT INTO review_task (id, review_id, assignee_role, assignee_id, required, decision, decided_at)
VALUES ('77777777-7777-7777-8777-777777777702', '66666666-6666-7666-8666-666666666666',
        'COMPLIANCE', 'carol.compliance', true, 'APPROVE', now());

UPDATE sharia_review SET state = 'APPROVED' WHERE id = '66666666-6666-7666-8666-666666666666';
DO $$
BEGIN
  IF (SELECT state FROM sharia_review WHERE id = '66666666-6666-7666-8666-666666666666') <> 'APPROVED' THEN
    RAISE EXCEPTION 'TEST FAILED G3c: a fully quorate T3 review must be approvable';
  END IF;
  RAISE NOTICE 'PASS G3c: quorate T3 review (Sharia officer + compliance) approved';
END $$;

-- a rejection blocks approval
INSERT INTO sharia_review (id, ref, subject_type, subject_id, risk_tier, state, submitted_by, due_at)
VALUES ('66666666-6666-7666-8666-666666666667', 'R-TEST-0002', 'PROMPT_VERSION',
        '33333333-3333-7333-8333-333333333333', 'T3_HIGH', 'IN_REVIEW', 'alice.editor',
        now() + interval '5 days');
INSERT INTO review_task (id, review_id, assignee_role, assignee_id, required, decision, decided_at)
VALUES ('77777777-7777-7777-8777-777777777703', '66666666-6666-7666-8666-666666666667',
        'SHARIA_OFFICER', 'bob.sharia', true, 'REJECT', now());
INSERT INTO review_task (id, review_id, assignee_role, assignee_id, required, decision, decided_at)
VALUES ('77777777-7777-7777-8777-777777777704', '66666666-6666-7666-8666-666666666667',
        'COMPLIANCE', 'carol.compliance', true, 'APPROVE', now());
DO $$
BEGIN
  BEGIN
    UPDATE sharia_review SET state = 'APPROVED' WHERE id = '66666666-6666-7666-8666-666666666667';
    RAISE EXCEPTION 'TEST FAILED G3d: a review containing a rejection must not be approvable';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS G3d: rejection blocks approval';
  END;
END $$;

-- ───────────────────────────── G2 · append-only hash-chained audit ─────────────────────────────
INSERT INTO audit_event (id, actor, actor_role, action, subject_type, subject_id, after_json, correlation_id)
VALUES (gen_random_uuid(), 'bob.sharia', 'SHARIA_OFFICER', 'REVIEW_APPROVE', 'SHARIA_REVIEW',
        '66666666-6666-7666-8666-666666666666', '{"decision":"APPROVE"}'::jsonb, gen_random_uuid());
INSERT INTO audit_event (id, actor, actor_role, action, subject_type, subject_id, after_json, correlation_id)
VALUES (gen_random_uuid(), 'carol.compliance', 'COMPLIANCE', 'REVIEW_APPROVE', 'SHARIA_REVIEW',
        '66666666-6666-7666-8666-666666666666', '{"decision":"APPROVE"}'::jsonb, gen_random_uuid());
INSERT INTO audit_event (id, actor, actor_role, action, subject_type, subject_id, before_json, after_json, reason)
VALUES (gen_random_uuid(), 'admin', 'PLATFORM_ADMIN', 'DOCUMENT_PUBLISH', 'DOCUMENT',
        '22222222-2222-7222-8222-222222222222', '{"state":"SHARIA_APPROVED"}'::jsonb,
        '{"state":"PUBLISHED"}'::jsonb, 'Approved by the committee on 2026-09-03');

DO $$
BEGIN
  -- Guard the assertion: a BEFORE ROW trigger never fires on a zero-row statement, so the fixture
  -- must actually exist or the test would pass vacuously.
  IF NOT EXISTS (SELECT 1 FROM audit_event WHERE action = 'DOCUMENT_PUBLISH') THEN
    RAISE EXCEPTION 'TEST FAILED G2-fixture: no DOCUMENT_PUBLISH audit event was written';
  END IF;
  BEGIN
    UPDATE audit_event SET reason = 'rewritten history' WHERE action = 'DOCUMENT_PUBLISH';
    RAISE EXCEPTION 'TEST FAILED G2a: audit_event must reject UPDATE';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS G2a: audit_event rejects UPDATE';
  END;
  BEGIN
    DELETE FROM audit_event WHERE action = 'DOCUMENT_PUBLISH';
    RAISE EXCEPTION 'TEST FAILED G2b: audit_event must reject DELETE';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS G2b: audit_event rejects DELETE';
  END;
END $$;

DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM fn_verify_audit_chain(now() - interval '1 hour', now() + interval '1 hour');
  IF NOT r.valid THEN
    RAISE EXCEPTION 'TEST FAILED G2c: hash chain verification failed at seq %', r.first_broken_seq;
  END IF;
  IF r.events_checked < 3 THEN
    RAISE EXCEPTION 'TEST FAILED G2c: expected at least 3 audit events, found %', r.events_checked;
  END IF;
  RAISE NOTICE 'PASS G2c: hash chain verifies over % events, head=%', r.events_checked, left(r.head_hash, 16);
END $$;

-- consecutive events must link through prev_hash
DO $$
DECLARE broken integer;
BEGIN
  SELECT count(*) INTO broken FROM (
    SELECT lag(hash) OVER (ORDER BY seq) AS prev, prev_hash
      FROM audit_event) x
   WHERE x.prev IS NOT NULL AND x.prev <> x.prev_hash;
  IF broken > 0 THEN
    RAISE EXCEPTION 'TEST FAILED G2d: % audit event(s) do not link to their predecessor', broken;
  END IF;
  RAISE NOTICE 'PASS G2d: every audit event links to its predecessor hash';
END $$;

-- ───────────────────────────── configuration invariants ─────────────────────────────
INSERT INTO prompt_template (code, locale, description_fr, description_en)
VALUES ('SYSTEM_ASSISTANT', 'fr-FR', 'Consigne système (test)', 'System prompt (test)');

INSERT INTO prompt_version (id, code, locale, version_no, body, state, created_by)
VALUES ('88888888-8888-7888-8888-888888888801', 'SYSTEM_ASSISTANT', 'fr-FR', 1, 'v1', 'ACTIVE', 'ai');

DO $$
BEGIN
  BEGIN
    INSERT INTO prompt_version (id, code, locale, version_no, body, state, created_by)
    VALUES ('88888888-8888-7888-8888-888888888802', 'SYSTEM_ASSISTANT', 'fr-FR', 2, 'v2', 'ACTIVE', 'ai');
    RAISE EXCEPTION 'TEST FAILED C1: two ACTIVE prompt versions for the same (code, locale) must be impossible';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'PASS C1: exactly one ACTIVE prompt version per (code, locale)';
  END;
END $$;

-- confidential content can never be exposed to the public audience
DO $$
BEGIN
  BEGIN
    INSERT INTO document (id, collection_id, title_fr, source_lang, classification, audience, created_by)
    VALUES ('99999999-9999-7999-8999-999999999901', '11111111-1111-7111-8111-111111111111',
            'Fuite (test)', 'fr-FR', 'CONFIDENTIAL', 'PUBLIC', 'tester');
    RAISE EXCEPTION 'TEST FAILED C2: CONFIDENTIAL content must not be addressable to a PUBLIC audience';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'PASS C2: classification/audience combination rejected';
  END;
END $$;

-- ─────────────────────── full-text search coverage (G4) ───────────────────────
-- An unmapped token type is not an error in PostgreSQL: its tokens are simply discarded. These
-- assertions exist because that silence once cost the index every plain integer in the corpus —
-- tariff minimums, the numbers identifying loi 2016-48 and circulaire 2021-05, years, quantities —
-- while `int` and `float` were mapped and everything looked correct. See the comment above the
-- albaraka_fts configuration in specs/db/schema.sql.

-- G4a: no token type is left unmapped unless it is on the declared exclusion list.
DO $$
DECLARE unmapped text;
BEGIN
  SELECT string_agg(tt.alias, ', ' ORDER BY tt.alias) INTO unmapped
    FROM ts_token_type('default') tt
   WHERE tt.alias NOT IN ('blank','tag','entity','protocol')   -- intentional; see schema.sql
     AND NOT EXISTS (SELECT 1 FROM pg_ts_config_map m
                      WHERE m.mapcfg = 'albaraka_ai.albaraka_fts'::regconfig
                        AND m.maptokentype = tt.tokid);
  IF unmapped IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED G4a: albaraka_fts leaves token type(s) unmapped: % — their tokens are discarded silently', unmapped;
  END IF;
  RAISE NOTICE 'PASS G4a: every default-parser token type is mapped or intentionally excluded';
END $$;

-- G4b: plain integers reach the index (the `uint` token type).
DO $$
DECLARE v tsvector;
BEGIN
  v := to_tsvector('albaraka_ai.albaraka_fts', 'Commission: minimum 150 DT, maximum 1500 DT');
  IF NOT (v @@ to_tsquery('albaraka_ai.albaraka_fts', '150'))
     OR NOT (v @@ to_tsquery('albaraka_ai.albaraka_fts', '1500')) THEN
    RAISE EXCEPTION 'TEST FAILED G4b: plain integers are not indexed (%): the uint token type is unmapped', v::text;
  END IF;
  RAISE NOTICE 'PASS G4b: tariff minimums and maximums are searchable — %', v::text;
END $$;

-- G4c: decimals and version numbers reach the index.
DO $$
DECLARE v tsvector;
BEGIN
  v := to_tsvector('albaraka_ai.albaraka_fts', 'taux 0.500 % et 3.000 DT, spec version 1.2.3');
  IF NOT (v @@ to_tsquery('albaraka_ai.albaraka_fts', '0.500'))
     OR NOT (v @@ to_tsquery('albaraka_ai.albaraka_fts', '3.000'))
     OR NOT (v @@ to_tsquery('albaraka_ai.albaraka_fts', '1.2.3')) THEN
    RAISE EXCEPTION 'TEST FAILED G4c: a decimal or a version number is not indexed (%)', v::text;
  END IF;
  RAISE NOTICE 'PASS G4c: decimals and version numbers are searchable — %', v::text;
END $$;

-- G4d: the legal corpus is findable by its number.
DO $$
DECLARE v tsvector;
BEGIN
  v := to_tsvector('albaraka_ai.albaraka_fts', 'loi n° 2016-48 du 11 mai 2016, circulaire 2021-05');
  IF NOT (v @@ to_tsquery('albaraka_ai.albaraka_fts', '2016'))
     OR NOT (v @@ to_tsquery('albaraka_ai.albaraka_fts', '2021')) THEN
    RAISE EXCEPTION 'TEST FAILED G4d: the years of the legal corpus are not indexed (%) — the two texts the Sharia governance rests on would be unsearchable by number', v::text;
  END IF;
  -- Documented limitation, asserted so that it stays a decision rather than a surprise: the parser
  -- reads the hyphen in "2016-48" as a minus sign, so the article number indexes as '-48' and a
  -- query for '48' does not match it. Splitting hyphenated numbers is the application normaliser's
  -- job (specs/i18n/normalization.json), not the text-search configuration's.
  IF v @@ to_tsquery('albaraka_ai.albaraka_fts', '48') THEN
    RAISE EXCEPTION 'TEST FAILED G4e: ''48'' now matches "2016-48"; the hyphen-splitting contract of the application normaliser is no longer the only path to the article number';
  END IF;
  RAISE NOTICE 'PASS G4d: loi 2016-48 and circulaire 2021-05 are searchable by year';
  RAISE NOTICE 'PASS G4e: "2016-48" indexes as 2016 and -48, so article numbers depend on the application normaliser splitting hyphens (documented, not accidental)';
END $$;

-- G4f: Arabic reaches the index.
DO $$
DECLARE v tsvector;
BEGIN
  v := to_tsvector('albaraka_ai.albaraka_fts', 'التمويل بالمضاربة نسبة المرابحة');
  IF position('مضاربة' in v::text) = 0 OR position('المرابحة' in v::text) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED G4f: Arabic produced no usable lexemes (%) — check server_encoding and the mapping for the word token type', v::text;
  END IF;
  RAISE NOTICE 'PASS G4f: Arabic tokens are indexed — %', v::text;
END $$;

-- G4g: PostgreSQL will not stem Arabic, which is why the application stemmer exists.
DO $$
BEGIN
  IF to_tsquery('albaraka_ai.albaraka_fts', 'مضاربة')
     @@ to_tsvector('albaraka_ai.albaraka_fts', 'بالمضاربة') THEN
    RAISE EXCEPTION 'TEST FAILED G4g: Postgres matched a prefixed Arabic form unaided — the light stemmer of docs/03 §8 would no longer be load-bearing and the retrieval design should be revisited';
  END IF;
  RAISE NOTICE 'PASS G4g: بالمضاربة does not match مضاربة — the application-side light stemmer is load-bearing, not an optimisation';
END $$;

-- G4h: the cluster encoding. In SQL_ASCII the parser classifies every non-ASCII token as `blank`,
-- Arabic included, and G4f would fail — this assertion names the cause instead.
DO $$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'TEST FAILED G4h: server_encoding is %; the default parser discards every non-ASCII token as blank and no Arabic would be indexed', current_setting('server_encoding');
  END IF;
  RAISE NOTICE 'PASS G4h: server_encoding = UTF8, so Arabic classifies as `word` and not as `blank`';
END $$;

-- ───────────────────────────── views sanity ─────────────────────────────
DO $$
DECLARE n bigint;
BEGIN
  SELECT count(*) INTO n FROM v_governance_kpis;
  IF n <> 1 THEN RAISE EXCEPTION 'TEST FAILED V1: v_governance_kpis must return exactly one row'; END IF;
  RAISE NOTICE 'PASS V1: governance KPI view returns one aggregated row';
  PERFORM count(*) FROM v_review_queue;
  PERFORM count(*) FROM v_coverage_gaps;
  PERFORM count(*) FROM v_cost_daily;
  RAISE NOTICE 'PASS V2: all reporting views are queryable';
END $$;

-- ───────────────────────────── cleanup ─────────────────────────────
DELETE FROM chunk_embedding WHERE chunk_id = '44444444-4444-7444-8444-444444444444';
DELETE FROM review_task WHERE review_id IN ('66666666-6666-7666-8666-666666666666','66666666-6666-7666-8666-666666666667');
DELETE FROM sharia_review WHERE id IN ('66666666-6666-7666-8666-666666666666','66666666-6666-7666-8666-666666666667');
DELETE FROM prompt_version WHERE code = 'SYSTEM_ASSISTANT' AND locale = 'fr-FR';
DELETE FROM prompt_template WHERE code = 'SYSTEM_ASSISTANT' AND locale = 'fr-FR';
DELETE FROM document WHERE id = '22222222-2222-7222-8222-222222222222';
DELETE FROM collection WHERE code = 'PRODUCTS_RETAIL_TEST';

DO $$ BEGIN RAISE NOTICE '── ALL SCHEMA GUARANTEE TESTS PASSED ──'; END $$;
