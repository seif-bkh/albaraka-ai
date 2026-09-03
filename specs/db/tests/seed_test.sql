-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--  Al-Mouchir — seed content tests (G5)
--
--  Runs AFTER specs/db/schema.sql and the generated content migrations in specs/db/seed/. It tests
--  the seeded DATA, which schema_test.sql cannot: the schema can be perfect and the seed can still
--  be wrong, and a wrong seed fails at runtime as bad answers rather than as an error.
--
--    psql -v ON_ERROR_STOP=1 \
--      -f specs/db/schema.sql \
--      -f specs/db/seed/V900__seed_glossary.sql \
--      -f specs/db/seed/V903__seed_dialect.sql \
--      -f specs/db/tests/seed_test.sql
--
--  Or:  cd tools/db-verify && npm run verify:seed
--
--  What each assertion is really protecting:
--    G5a  no collection carries a chunking strategy the pipeline does not implement
--    G5b  no glossary label is an empty string (NOT NULL permits '', and '' renders as a blank term)
--    G5c  no term forbids its own correct rendering — the guard would block every right answer
--    G5d  the dialect map has no identity rows and no chains (a chain rewrites twice in one pass)
--    G5e  the dialect map carries the examples docs/06 §7 promises the reader
--    G5f  Arabic survives the write/read round trip — the encoding canary for the whole seed
--    G5g  every seed row is SEED/ACTIVE and inside the confidence domain
--    G5h  chunking_policy is machine-readable JSON with the keys the backoffice edits
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
SET search_path TO albaraka_ai, public;
SET client_min_messages TO NOTICE;

-- ───────────────────────────── fixtures ─────────────────────────────
-- The seeds must already be applied; without them every assertion below is vacuous, so say so
-- loudly rather than passing on an empty table.
DO $$
BEGIN
  IF (SELECT count(*) FROM term_glossary) = 0 OR (SELECT count(*) FROM derja_msa_map) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED G5-fixture: term_glossary or derja_msa_map is empty — apply specs/db/seed/V900 and V903 before this file';
  END IF;
  RAISE NOTICE 'PASS G5-fixture: seeds are present (% terms, % dialect rows, % collections)',
    (SELECT count(*) FROM term_glossary),
    (SELECT count(*) FROM derja_msa_map),
    (SELECT count(*) FROM collection);
END $$;

-- G5a: every collection names a chunking strategy the ingestion pipeline implements.
-- A typo here is silent: the chunker falls back to generic sizing, and tariff rows start being
-- split mid-row, which is the one failure docs/04 §15 explicitly forbids.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(code || '→' || coalesce(chunking_policy::jsonb->>'strategy', '(none)'), ', ')
    INTO bad
    FROM collection
   WHERE coalesce(chunking_policy::jsonb->>'strategy', '') NOT IN
         ('HEADING_BLOCK', 'TABLE_ROW', 'STEP_SEQUENCE', 'ARTICLE', 'ENTRY', 'PARAGRAPH', 'QA_PAIR');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED G5a: collection(s) with a strategy the pipeline does not implement: %', bad;
  END IF;
  RAISE NOTICE 'PASS G5a: all % collections name an implemented chunking strategy', (SELECT count(*) FROM collection);
END $$;

-- G5b: no glossary label is blank. NOT NULL does not forbid '', and '' would render as an empty
-- term in the backoffice and as a missing label in an answer.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(canonical_code, ', ') INTO bad
    FROM term_glossary
   WHERE length(btrim(term_fr)) = 0 OR length(btrim(term_ar)) = 0 OR length(btrim(term_en)) = 0;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED G5b: glossary term(s) with a blank label: %', bad;
  END IF;
  RAISE NOTICE 'PASS G5b: all % glossary terms carry three non-blank labels', (SELECT count(*) FROM term_glossary);
END $$;

-- G5c: no term forbids its own correct rendering.
-- forbidden_renderings is matched literally by the output guard. If a row forbade its own term, the
-- guard would block every correct answer about that product — a self-inflicted refusal that looks
-- exactly like an over-strict Sharia gate and would be very expensive to diagnose.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(t.canonical_code || ' forbids ' || f, ', ') INTO bad
    FROM term_glossary t, unnest(t.forbidden_renderings) AS f
   WHERE lower(btrim(f)) IN (lower(btrim(t.term_fr)), lower(btrim(t.term_ar)), lower(btrim(t.term_en)));
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED G5c: %', bad;
  END IF;
  RAISE NOTICE 'PASS G5c: no term forbids its own rendering (% terms carry forbidden lists)',
    (SELECT count(*) FROM term_glossary WHERE cardinality(forbidden_renderings) > 0);
END $$;

-- G5d: the dialect map has no identity rows and no chains.
-- A chain (آش → ما → لا) rewrites twice in one pass and turns "what" into "not". tools/i18n-lint D13
-- enforces this on the spec; this enforces it on the data that actually reached the database, which
-- is the copy the runtime reads.
DO $$
DECLARE ident integer; chains text;
BEGIN
  SELECT count(*) INTO ident FROM derja_msa_map WHERE derja_ar = msa;
  IF ident > 0 THEN
    RAISE EXCEPTION 'TEST FAILED G5d: % identity row(s) in derja_msa_map — identical forms belong in sharedVocabulary, not in the seed', ident;
  END IF;
  SELECT string_agg(m.derja_ar || ' → ' || m.msa || ' → ' || n.msa, ', ') INTO chains
    FROM derja_msa_map m JOIN derja_msa_map n ON n.derja_ar = m.msa;
  IF chains IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED G5d: mapping chain(s), rewritten twice in one pass: %', chains;
  END IF;
  RAISE NOTICE 'PASS G5d: no identity rows and no chains across % mappings', (SELECT count(*) FROM derja_msa_map);
END $$;

-- G5e: the examples docs/06 §7 shows the reader must exist in the seed.
-- The document is the promise; if the seed drifts from it, an administrator following the docs
-- finds nothing.
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(e.derja, ', ') INTO missing
    FROM (VALUES ('نحب','أريد'), ('باش','من أجل'), ('برشة','كثيرا'),
                 ('فلوس','أموال'), ('قداش','كم'), ('كرهبة','سيارة'),
                 ('شنية','ما هي'), ('وين','أين'), ('شهرية','قسط شهري')) AS e(derja, msa)
   WHERE NOT EXISTS (SELECT 1 FROM derja_msa_map d
                      WHERE d.derja_ar = e.derja AND d.msa = e.msa);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED G5e: documented Derja examples absent from the seed: %', missing;
  END IF;
  RAISE NOTICE 'PASS G5e: the documented Derja → MSA examples are all seeded';
END $$;

-- G5f: Arabic survives the write/read round trip.
-- This is the encoding canary. On a non-UTF8 database these comparisons fail, or worse the values
-- are stored as blanks, and the assistant silently loses the ability to answer in Arabic.
DO $$
DECLARE got_msa text; got_term text;
BEGIN
  SELECT msa INTO got_msa FROM derja_msa_map WHERE derja_ar = 'نحب';
  SELECT term_ar INTO got_term FROM term_glossary WHERE canonical_code = 'MOURABAHA';
  IF got_msa IS DISTINCT FROM 'أريد' THEN
    RAISE EXCEPTION 'TEST FAILED G5f: نحب round-tripped as %, expected أريد — the database is not storing Arabic correctly (server_encoding = %)',
      coalesce(got_msa, '(null)'), current_setting('server_encoding');
  END IF;
  IF got_term IS DISTINCT FROM 'مرابحة' THEN
    RAISE EXCEPTION 'TEST FAILED G5f: MOURABAHA.term_ar round-tripped as %, expected مرابحة', coalesce(got_term, '(null)');
  END IF;
  RAISE NOTICE 'PASS G5f: Arabic round-trips byte-exact in both seeded tables (server_encoding = %)',
    current_setting('server_encoding');
END $$;

-- G5g: every seeded row is SEED/ACTIVE and inside the confidence domain.
-- confidence is numeric(3,2); a value above 1.00 is rejected by the column, but a value of exactly
-- 1.00 on a row that needs context would claim certainty the mapping does not have.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(derja_ar || '=' || confidence || '/' || source || '/' || status, ', ') INTO bad
    FROM derja_msa_map
   WHERE source <> 'SEED' OR status <> 'ACTIVE' OR confidence <= 0 OR confidence > 1;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED G5g: seed row(s) outside the seeded domain: %', bad;
  END IF;
  RAISE NOTICE 'PASS G5g: all % rows are SEED/ACTIVE with confidence in (0,1]', (SELECT count(*) FROM derja_msa_map);
END $$;

-- G5h: chunking_policy is machine-readable, with the keys the backoffice renders and edits.
-- Storing it as opaque text would make the chunking window uneditable without a migration.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(code, ', ') INTO bad
    FROM collection
   WHERE NOT (chunking_policy::jsonb ? 'strategy')
      OR NOT (chunking_policy::jsonb ? 'minTokens')
      OR NOT (chunking_policy::jsonb ? 'maxTokens')
      OR (chunking_policy::jsonb->>'minTokens')::int <= 0
      OR (chunking_policy::jsonb->>'maxTokens')::int < (chunking_policy::jsonb->>'minTokens')::int;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED G5h: collection(s) whose chunking_policy is not editable JSON with a sane token window: %', bad;
  END IF;
  RAISE NOTICE 'PASS G5h: every chunking_policy carries strategy, minTokens and maxTokens with min ≤ max';
END $$;
