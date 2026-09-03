-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--  Al-Mouchir — reference DDL
--  Al Baraka Bank Tunisia · trilingual Sharia-compliant RAG assistant
--
--  Target   : PostgreSQL 17 + pgvector 0.8.1 + pg_trgm + unaccent + pgcrypto
--  Schema   : albaraka_ai
--  Status   : Phase 0 reference. In Phase 1 this is split into Flyway migrations
--             (V1__extensions.sql, V2__enums.sql, V3__knowledge.sql, …) and this file is
--             regenerated from them so it always mirrors the deployed schema.
--  Conventions
--    · ids are uuid, generated application-side as UUIDv7 (time-ordered → better index locality)
--    · all timestamps are timestamptz
--    · money is numeric(18,3) — the Tunisian dinar has three decimals (1 TND = 1000 millimes)
--    · enums are Postgres enums; adding a value is a migration, removing one never is
--    · high-volume tables are partitioned monthly by (created_at | occurred_at)
--
--  THE THREE HARD GUARANTEES encoded here (see docs/adr/ADR-006-sharia-review-gate.md):
--    1. chunk.searchable is maintained by trigger and is the ONLY gate retrieval uses.
--    2. audit_event is append-only (UPDATE/DELETE raise) and hash-chained.
--    3. a reviewer cannot approve their own submission, and a T3 subject needs a quorum.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS albaraka_ai;
SET search_path TO albaraka_ai, public;

-- ─────────────────────────────────────────── extensions ───────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector 0.8.1 : halfvec, hnsw, iterative scans
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- typo / transliteration tolerance
CREATE EXTENSION IF NOT EXISTS unaccent;    -- French accent folding (FTS only)
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid(), digest() for the audit chain

-- ─────────────────────────── full-text search configuration ───────────────────────────────────
-- Stock PostgreSQL has no Arabic stemmer. Normalisation, diacritic stripping, alef folding,
-- light stemming and Derja→MSA mapping happen in the application (assistant-knowledge) and the
-- result is indexed here with a simple, dependency-free configuration.
-- Display text is never modified — see docs/03-data-model.md §8.
--
-- EVERY token type the default parser can emit must be mapped, or its tokens are discarded in
-- silence. `uint` is the one that matters most: Postgres classifies a bare integer as `uint`, and
-- reserves `int` for a leading sign — which only appears where a hyphen was read as a minus. An
-- earlier revision of this file mapped `int` and `float` but not `uint`, so every plain integer in
-- the corpus was dropped from the index: tariff minimums and maximums ("minimum 150 DT maximum
-- 1500 DT"), the numbers that identify the legal corpus ("loi n° 2016-48", "circulaire 2021-05"),
-- article numbers, years and quantities. Nothing errors, nothing warns; it surfaces only as poor
-- recall on TARIFF_FEES — the one intent whose numeric grounding is a blocking metric at 100 %
-- (docs/11 §3). Measured before the fix: "loi n° 2016-48 du 11 mai 2016" indexed as
-- '-48' 'du' 'loi' 'mai' 'n°', with both occurrences of 2016 gone.
--
-- The G4 assertions in specs/db/tests/schema_test.sql fail if any of these mappings is removed and
-- if a token type appears that is neither mapped nor declared intentionally unmapped.
--
-- Requires server_encoding = UTF8 (asserted by G4f). In a SQL_ASCII cluster the default parser
-- classifies every non-ASCII token as `blank`, Arabic included, and the index holds no Arabic at
-- all — again silently, and again only visible as recall.
--
-- Deliberately NOT mapped: `blank` (whitespace), `tag` (markup: indexing "<td>" is pure noise in a
-- corpus of normalised plain text), `entity` (character references such as "&amp;" → "amp"),
-- `protocol` ("http"/"https" — the URL itself is already indexed by `url` and `host`).
CREATE TEXT SEARCH CONFIGURATION albaraka_fts (PARSER = default);
ALTER  TEXT SEARCH CONFIGURATION albaraka_fts
       ADD MAPPING FOR asciiword, word, numword, asciihword, hword WITH unaccent, simple;
ALTER  TEXT SEARCH CONFIGURATION albaraka_fts
       ADD MAPPING FOR numhword, hword_part, hword_asciipart, hword_numpart WITH unaccent, simple;
ALTER  TEXT SEARCH CONFIGURATION albaraka_fts
       ADD MAPPING FOR uint, int, float, sfloat WITH simple;
ALTER  TEXT SEARCH CONFIGURATION albaraka_fts
       ADD MAPPING FOR email, url, url_path, host, file, version WITH simple;

-- Retrieval sessions must keep k results despite metadata filters (pgvector 0.8).
-- ALTER ROLE albaraka_app SET hnsw.iterative_scan = 'relaxed_order';
-- ALTER ROLE albaraka_app SET hnsw.ef_search      = 80;

-- ─────────────────────────────────────────── enums ────────────────────────────────────────────
CREATE TYPE locale_code    AS ENUM ('fr-FR','ar-TN','en-GB');
CREATE TYPE direction      AS ENUM ('ltr','rtl');
CREATE TYPE lifecycle_state AS ENUM
  ('DRAFT','IN_REVIEW','CHANGES_REQUESTED','SHARIA_APPROVED','PUBLISHED','DEPRECATED','WITHDRAWN','RETIRED');
CREATE TYPE review_state   AS ENUM
  ('PENDING','IN_REVIEW','CHANGES_REQUESTED','APPROVED','REJECTED','WITHDRAWN');
CREATE TYPE review_decision AS ENUM ('APPROVE','REQUEST_CHANGES','REJECT');
CREATE TYPE risk_tier      AS ENUM ('T1_LOW','T2_MEDIUM','T3_HIGH');
CREATE TYPE audience       AS ENUM ('PUBLIC','AGENT','INTERNAL');      -- ordered: scope containment
CREATE TYPE classification AS ENUM ('PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED');
CREATE TYPE channel        AS ENUM ('WEB_APP','WIDGET','AGENT_DESK','API');
CREATE TYPE message_role   AS ENUM ('USER','ASSISTANT','SYSTEM','AGENT','TOOL');
CREATE TYPE job_status     AS ENUM ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED');
CREATE TYPE job_type       AS ENUM ('INGEST_DOCUMENT','RECHUNK','REEMBED','REINDEX_MODEL_CHANGE','TRANSLATE');
CREATE TYPE ingestion_stage AS ENUM ('PARSE','CLEAN','CHUNK','NORMALISE','TRANSLATE','EMBED','STORE','DONE');
CREATE TYPE embedding_status AS ENUM ('PENDING','EMBEDDED','FAILED','STALE');
CREATE TYPE retrieval_strategy AS ENUM ('DENSE','FTS','TRGM');
CREATE TYPE rerank_reason  AS ENUM ('PRODUCT_TERMS','PROCEDURE_STEPS','TARIFF','SHARIA_BASIS','OFF_TOPIC','OUTDATED');
CREATE TYPE exclusion_reason AS ENUM
  ('BELOW_THRESHOLD','AUDIENCE_FILTER','CLASSIFICATION_FILTER','VALIDITY_EXPIRED','DROPPED_BY_RERANKER','DEDUPED_TRANSLATION','BUDGET');
CREATE TYPE refusal_code   AS ENUM ('REF-01','REF-02','REF-03','REF-04','REF-05','REF-06');
CREATE TYPE intent_code    AS ENUM
  ('PRODUCT_QUESTION','PRODUCT_COMPARISON','SHARIA_CONCEPT','RELIGIOUS_RULING_REQUEST','PROCEDURE',
   'TARIFF_FEES','BRANCH_LOCATOR','DIGITAL_CHANNEL','ACCOUNT_STATUS','COMPLAINT','SMALL_TALK',
   'OUT_OF_SCOPE','ABUSE','ADVERSARIAL');
CREATE TYPE feedback_rating AS ENUM
  ('UP','DOWN','SHARIA_CONCERN','FACTUAL_ERROR','WRONG_LANGUAGE','INCOMPLETE','OFFENSIVE');
CREATE TYPE feedback_status AS ENUM ('NEW','TRIAGED','IN_PROGRESS','RESOLVED','DISMISSED');
CREATE TYPE guardrail_severity AS ENUM ('CRITICAL','HIGH','MEDIUM','LOW');
CREATE TYPE guardrail_decision AS ENUM ('BLOCK','WARN','LOG','PASS');
CREATE TYPE guardrail_scope  AS ENUM ('INPUT','OUTPUT','BOTH');
CREATE TYPE guardrail_policy_code AS ENUM
  ('PROHIBITED_TOPICS','NO_FATWA','PII_EGRESS','INJECTION','NUMERIC_CLAIMS','LANGUAGE_CONSISTENCY',
   'HALLUCINATED_ENTITIES','RATE_LIMIT','MAX_TURNS','OUTPUT_TOXICITY');
CREATE TYPE prompt_code AS ENUM
  ('SYSTEM_ASSISTANT','SYSTEM_RERANKER','QUERY_REWRITE','INTENT_CLASSIFIER','GUARDRAIL_JUDGE',
   'EVAL_JUDGE','ANSWER_CONTRACT','SUMMARIZER');
CREATE TYPE config_state AS ENUM ('DRAFT','IN_REVIEW','ACTIVE','RETIRED');
CREATE TYPE model_role AS ENUM
  ('CHAT_PRIMARY','CHAT_FAST','CHAT_FALLBACK','RERANKER','GUARD_SAFETY','GUARD_INJECTION','EMBEDDING');
CREATE TYPE provider_code AS ENUM ('GROQ','GOOGLE','ONPREM','MOCK');
CREATE TYPE fatwa_state AS ENUM ('OPEN','ASSIGNED','ANSWERED','PUBLISHED_AS_KB','CLOSED');
CREATE TYPE conversation_state AS ENUM ('ACTIVE','ARCHIVED','ESCALATED','CLOSED');
CREATE TYPE review_subject_type AS ENUM
  ('DOCUMENT_VERSION','PROMPT_VERSION','GUARDRAIL_POLICY','GLOSSARY_TERM','RETRIEVAL_CONFIG','MODEL_CONFIG','GOLDEN_SET');
CREATE TYPE glossary_domain AS ENUM ('PRODUCT','SHARIA','PROCEDURE','FINANCIAL','DIGITAL','GOVERNANCE','TECHNICAL');
CREATE TYPE severity_level AS ENUM ('S1','S2','S3','S4');
CREATE TYPE gate_result AS ENUM ('PASS','FAIL','RUNNING','PENDING');

-- ─────────────────────────────────── common helper functions ──────────────────────────────────
CREATE OR REPLACE FUNCTION fn_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION canonical_audit_json(e RECORD) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  -- Deterministic serialisation: fixed field order, no volatile values.
  RETURN jsonb_build_object(
    'seq', e.seq, 'id', e.id, 'occurredAt', to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'actor', e.actor, 'action', e.action, 'subjectType', e.subject_type, 'subjectId', e.subject_id,
    'before', coalesce(e.before_json,'{}'::jsonb), 'after', coalesce(e.after_json,'{}'::jsonb),
    'reason', coalesce(e.reason,''), 'reasonCode', coalesce(e.reason_code,''),
    'correlationId', coalesce(e.correlation_id::text,''), 'prevHash', e.prev_hash
  )::text;
END; $$;

-- ══════════════════════════════════════ KNOWLEDGE DOMAIN ═══════════════════════════════════════

CREATE TABLE collection (
  id                     uuid        PRIMARY KEY,
  code                   text        NOT NULL UNIQUE,
  name_fr                text        NOT NULL,
  name_ar                text        NOT NULL,
  name_en                text        NOT NULL,
  default_audience       audience    NOT NULL DEFAULT 'PUBLIC',
  default_classification classification NOT NULL DEFAULT 'PUBLIC',
  default_risk_tier      risk_tier   NOT NULL DEFAULT 'T2_MEDIUM',
  chunking_policy        text        NOT NULL DEFAULT 'GENERIC',
  description_fr         text,
  description_ar         text,
  description_en         text,
  enabled                boolean     NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE collection IS 'Logical grouping used for retrieval scoping and admin navigation.';
CREATE TRIGGER trg_collection_touch BEFORE UPDATE ON collection
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE TABLE term_glossary (
  id                    uuid        PRIMARY KEY,
  canonical_code        text        NOT NULL UNIQUE,
  term_fr               text        NOT NULL,
  term_ar               text        NOT NULL,
  term_en               text        NOT NULL,
  transliteration_ar    text,
  definition_fr         text,
  definition_ar         text,
  definition_en         text,
  forbidden_renderings  text[]      NOT NULL DEFAULT '{}',
  synonyms_fr           text[]      NOT NULL DEFAULT '{}',
  synonyms_ar           text[]      NOT NULL DEFAULT '{}',
  synonyms_en           text[]      NOT NULL DEFAULT '{}',
  domain                glossary_domain NOT NULL DEFAULT 'PRODUCT',
  sharia_sensitive      boolean     NOT NULL DEFAULT false,
  status                text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DEPRECATED')),
  version               integer     NOT NULL DEFAULT 0,
  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN term_glossary.forbidden_renderings IS
  'Renderings the assistant must NEVER use for this concept; enforced deterministically at output.';
CREATE INDEX idx_glossary_domain ON term_glossary (domain) WHERE status = 'ACTIVE';
CREATE INDEX idx_glossary_terms_trgm ON term_glossary USING gin
  ((term_fr || ' ' || term_ar || ' ' || term_en) gin_trgm_ops);
CREATE TRIGGER trg_glossary_touch BEFORE UPDATE ON term_glossary
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE TABLE derja_msa_map (
  id            uuid        PRIMARY KEY,
  derja_ar      text        NOT NULL,
  derja_latin   text,
  msa           text        NOT NULL,
  gloss_en      text,
  confidence    numeric(3,2) NOT NULL DEFAULT 1.00,
  source        text        NOT NULL DEFAULT 'SEED' CHECK (source IN ('SEED','ADMIN','MINED')),
  status        text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REJECTED','RETIRED')),
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (derja_ar)
);
COMMENT ON TABLE derja_msa_map IS 'Tunisian dialect → Modern Standard Arabic normalisation, incl. arabizi.';
CREATE INDEX idx_derja_latin ON derja_msa_map (lower(derja_latin)) WHERE derja_latin IS NOT NULL;

CREATE TABLE agency (
  id          uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_code text       NOT NULL UNIQUE,
  name_fr    text        NOT NULL,
  name_ar    text        NOT NULL,
  name_en    text        NOT NULL,
  region_fr  text        NOT NULL,
  region_ar  text        NOT NULL,
  address_fr text,
  address_ar text,
  phone      text,
  lat        numeric(9,6),
  lon        numeric(9,6),
  hours_fr   text,
  hours_ar   text,
  is_active  boolean     NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE document (
  id                  uuid        PRIMARY KEY,
  collection_id       uuid        NOT NULL REFERENCES collection(id),
  external_ref        text,
  title_fr            text,
  title_ar            text,
  title_en            text,
  source_uri          text,
  mime_type           text,
  size_bytes          bigint,
  sha256              text,
  source_lang         locale_code NOT NULL DEFAULT 'fr-FR',
  classification      classification NOT NULL DEFAULT 'PUBLIC',
  audience            audience    NOT NULL DEFAULT 'PUBLIC',
  product_codes       text[]      NOT NULL DEFAULT '{}',
  valid_from          date,
  valid_to            date,
  current_version_id  uuid,
  lifecycle_state     lifecycle_state NOT NULL DEFAULT 'DRAFT',
  owner_role          text,
  version             integer     NOT NULL DEFAULT 0,
  created_by          text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          text,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_document_has_a_title CHECK (title_fr IS NOT NULL OR title_ar IS NOT NULL OR title_en IS NOT NULL),
  CONSTRAINT ck_document_validity CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_to >= valid_from),
  CONSTRAINT ck_document_classification_reachable CHECK (
      NOT (classification IN ('CONFIDENTIAL','RESTRICTED') AND audience = 'PUBLIC'))
);
COMMENT ON CONSTRAINT ck_document_classification_reachable ON document IS
  'Confidential or restricted content can never be exposed to the public audience.';
CREATE UNIQUE INDEX uq_document_sha256 ON document (sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX idx_document_collection_state ON document (collection_id, lifecycle_state);
CREATE INDEX idx_document_products ON document USING gin (product_codes);
CREATE INDEX idx_document_validity ON document (valid_to) WHERE valid_to IS NOT NULL;
CREATE TRIGGER trg_document_touch BEFORE UPDATE ON document
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE TABLE document_version (
  id                 uuid        PRIMARY KEY,
  document_id        uuid        NOT NULL REFERENCES document(id) ON DELETE CASCADE,
  version_no         integer     NOT NULL,
  body_text          text        NOT NULL,
  body_lang          locale_code NOT NULL DEFAULT 'fr-FR',
  change_summary_fr  text,
  change_summary_ar  text,
  change_summary_en  text,
  state              lifecycle_state NOT NULL DEFAULT 'DRAFT',
  chunking_policy    text        NOT NULL DEFAULT 'GENERIC',
  sharia_review_id   uuid,
  body_sha256        text        NOT NULL,
  published_at       timestamptz,
  published_by       text,
  version            integer     NOT NULL DEFAULT 0,
  created_by         text        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_no),
  CONSTRAINT ck_version_published_needs_stamp CHECK (state <> 'PUBLISHED' OR published_at IS NOT NULL)
);
ALTER TABLE document ADD CONSTRAINT fk_document_current_version
  FOREIGN KEY (current_version_id) REFERENCES document_version(id) DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX idx_docver_state ON document_version (state);
CREATE TRIGGER trg_docver_touch BEFORE UPDATE ON document_version
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE TABLE chunk (
  id                   uuid        PRIMARY KEY,
  document_version_id  uuid        NOT NULL REFERENCES document_version(id) ON DELETE CASCADE,
  ordinal              integer     NOT NULL,
  content              text        NOT NULL,
  contextual_header    text,
  heading_path         text[]      NOT NULL DEFAULT '{}',
  token_count          integer     NOT NULL DEFAULT 0,
  lang                 locale_code NOT NULL,
  is_translation       boolean     NOT NULL DEFAULT false,
  machine_translated   boolean     NOT NULL DEFAULT false,
  human_verified       boolean     NOT NULL DEFAULT false,
  source_chunk_id      uuid        REFERENCES chunk(id) ON DELETE SET NULL,
  normalized_text      text        NOT NULL DEFAULT '',
  tsv                  tsvector    GENERATED ALWAYS AS
                       (to_tsvector('albaraka_ai.albaraka_fts', coalesce(normalized_text,''))) STORED,
  -- Denormalised governance facts, maintained by trigger from the parent version/document.
  audience             audience    NOT NULL DEFAULT 'PUBLIC',
  classification       classification NOT NULL DEFAULT 'PUBLIC',
  product_codes        text[]      NOT NULL DEFAULT '{}',
  published            boolean     NOT NULL DEFAULT false,
  sharia_approved      boolean     NOT NULL DEFAULT false,
  valid_from           date,
  valid_to             date,
  -- ★ THE SHARIA GATE. The only predicate retrieval filters on. Maintained by trigger.
  searchable           boolean     NOT NULL DEFAULT false,
  embedding_status     embedding_status NOT NULL DEFAULT 'PENDING',
  embedding_model      text,
  embedding_dim        integer,
  content_sha256       text        NOT NULL,
  quarantined          boolean     NOT NULL DEFAULT false,
  quarantine_reason    text,
  version              integer     NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_version_id, ordinal, lang),
  CONSTRAINT ck_chunk_translation_verified CHECK (
      NOT (machine_translated AND NOT human_verified AND sharia_approved)),
  CONSTRAINT ck_chunk_embedded_needs_model CHECK (
      embedding_status <> 'EMBEDDED' OR (embedding_model IS NOT NULL AND embedding_dim IS NOT NULL))
);
COMMENT ON COLUMN chunk.searchable IS
  'Materialised Sharia gate: published AND sharia_approved AND within validity AND not quarantined '
  'AND embedding ready. Retrieval MUST filter on it. Maintained by trigger + expiry sweeper.';
COMMENT ON CONSTRAINT ck_chunk_translation_verified ON chunk IS
  'A machine-translated chunk cannot be Sharia-approved without human verification (ADR-007).';
CREATE INDEX idx_chunk_searchable ON chunk (audience, lang, searchable) WHERE searchable;
CREATE INDEX idx_chunk_tsv        ON chunk USING gin (tsv);
CREATE INDEX idx_chunk_trgm       ON chunk USING gin (normalized_text gin_trgm_ops);
CREATE INDEX idx_chunk_products   ON chunk USING gin (product_codes);
CREATE INDEX idx_chunk_version    ON chunk (document_version_id);
CREATE INDEX idx_chunk_expiry     ON chunk (valid_to) WHERE valid_to IS NOT NULL;
CREATE TRIGGER trg_chunk_touch BEFORE UPDATE ON chunk
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

-- ── the gate: recompute chunk.searchable from its own governance facts ─────────────────────────
CREATE OR REPLACE FUNCTION fn_recompute_chunk_searchable() RETURNS trigger AS $$
BEGIN
  NEW.searchable :=
        NEW.published
    AND NEW.sharia_approved
    AND NOT NEW.quarantined
    AND NEW.embedding_status = 'EMBEDDED'
    AND (NEW.valid_from IS NULL OR NEW.valid_from <= current_date)
    AND (NEW.valid_to   IS NULL OR NEW.valid_to   >= current_date);
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chunk_gate BEFORE INSERT OR UPDATE OF
  published, sharia_approved, quarantined, embedding_status, valid_from, valid_to ON chunk
  FOR EACH ROW EXECUTE FUNCTION fn_recompute_chunk_searchable();

-- Propagate document/version governance decisions down to the chunks.
CREATE OR REPLACE FUNCTION fn_sync_chunk_governance() RETURNS trigger AS $$
BEGIN
  UPDATE chunk c SET
    published       = (NEW.state = 'PUBLISHED'),
    sharia_approved = (NEW.state IN ('SHARIA_APPROVED','PUBLISHED')),
    updated_at      = now()
  WHERE c.document_version_id = NEW.id
    AND (c.published, c.sharia_approved) IS DISTINCT FROM
        ((NEW.state = 'PUBLISHED'), (NEW.state IN ('SHARIA_APPROVED','PUBLISHED')));
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_docver_sync_chunks AFTER UPDATE OF state ON document_version
  FOR EACH ROW WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION fn_sync_chunk_governance();

-- Temporal validity sweeper: called by the scheduler every minute (and on publish).
CREATE OR REPLACE FUNCTION fn_sweep_chunk_validity() RETURNS integer AS $$
DECLARE n integer;
BEGIN
  UPDATE chunk SET searchable = false, updated_at = now()
   WHERE searchable AND (
         (valid_from IS NOT NULL AND valid_from > current_date)
      OR (valid_to   IS NOT NULL AND valid_to   < current_date));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$ LANGUAGE plpgsql;

CREATE TABLE chunk_embedding (
  chunk_id     uuid        PRIMARY KEY REFERENCES chunk(id) ON DELETE CASCADE,
  embedding    vector(1536),
  embedding_h  halfvec(1536),
  model        text        NOT NULL,
  dim          integer     NOT NULL DEFAULT 1536,
  task_type    text        NOT NULL DEFAULT 'RETRIEVAL_DOCUMENT',
  title_used   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN chunk_embedding.embedding_h IS
  'Production column: fp16 halves storage/index size vs fp32 with negligible recall loss.';
COMMENT ON COLUMN chunk_embedding.embedding IS
  'fp32 column kept only for A/B validation of the halfvec migration; null in steady state.';
CREATE INDEX idx_chunk_emb_hnsw ON chunk_embedding
  USING hnsw (embedding_h halfvec_cosine_ops) WITH (m = 16, ef_construction = 128);

CREATE TABLE chunk_translation (
  id                uuid        PRIMARY KEY,
  chunk_id          uuid        NOT NULL REFERENCES chunk(id) ON DELETE CASCADE,
  lang              locale_code NOT NULL,
  title             text,
  excerpt_display   text,
  machine           boolean     NOT NULL DEFAULT false,
  verified_by       text,
  verified_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chunk_id, lang)
);

CREATE TABLE ingestion_job (
  id                uuid        PRIMARY KEY,
  type              job_type    NOT NULL,
  status            job_status  NOT NULL DEFAULT 'QUEUED',
  stage             ingestion_stage NOT NULL DEFAULT 'PARSE',
  progress          numeric(4,3) NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  document_id       uuid        REFERENCES document(id) ON DELETE CASCADE,
  document_version_id uuid      REFERENCES document_version(id) ON DELETE CASCADE,
  payload           jsonb       NOT NULL DEFAULT '{}',
  attempts          integer     NOT NULL DEFAULT 0,
  max_attempts      integer     NOT NULL DEFAULT 5,
  next_retry_at     timestamptz,
  locked_by         text,
  locked_at         timestamptz,
  error             text,
  quarantine_reason text,
  embedding_model   text,
  embedding_dim     integer,
  priority          smallint    NOT NULL DEFAULT 5,
  created_by        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);
COMMENT ON TABLE ingestion_job IS 'DB-backed queue consumed with FOR UPDATE SKIP LOCKED (no broker in v1).';
CREATE INDEX idx_job_claimable ON ingestion_job (priority, next_retry_at, created_at)
  WHERE status IN ('QUEUED','FAILED');
CREATE INDEX idx_job_running ON ingestion_job (status, locked_at);

-- ══════════════════════════════ CONFIGURATION DOMAIN ("polishable") ════════════════════════════

CREATE TABLE prompt_template (
  code                     prompt_code NOT NULL,
  locale                   locale_code NOT NULL DEFAULT 'fr-FR',
  description_fr           text,
  description_ar           text,
  description_en           text,
  requires_sharia_approval boolean     NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (code, locale)
);

CREATE TABLE prompt_version (
  id                       uuid        PRIMARY KEY,
  code                     prompt_code NOT NULL,
  locale                   locale_code NOT NULL DEFAULT 'fr-FR',
  version_no               integer     NOT NULL,
  body                     text        NOT NULL,
  variables                text[]      NOT NULL DEFAULT '{}',
  protected_clauses        text[]      NOT NULL DEFAULT '{}',
  requires_sharia_approval boolean     NOT NULL DEFAULT false,
  state                    config_state NOT NULL DEFAULT 'DRAFT',
  change_note_fr           text,
  change_note_ar           text,
  change_note_en           text,
  review_id                uuid,
  eval_run_id              uuid,
  activated_at             timestamptz,
  activated_by             text,
  activated_from_version   uuid,
  canary_percent           integer     NOT NULL DEFAULT 100 CHECK (canary_percent BETWEEN 0 AND 100),
  token_estimate           integer,
  version                  integer     NOT NULL DEFAULT 0,
  created_by               text        NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, locale, version_no)
);
-- Exactly one ACTIVE version per (code, locale).
CREATE UNIQUE INDEX uq_prompt_version_active ON prompt_version (code, locale) WHERE state = 'ACTIVE';
CREATE INDEX idx_prompt_version_state ON prompt_version (state, created_at DESC);

CREATE TABLE model_config (
  id                  uuid        PRIMARY KEY,
  code                model_role  NOT NULL,
  provider            provider_code NOT NULL,
  model_id            text        NOT NULL,
  state               config_state NOT NULL DEFAULT 'DRAFT',
  version_no          integer     NOT NULL DEFAULT 1,
  temperature         numeric(3,2),
  top_p               numeric(3,2),
  max_tokens          integer,
  timeout_ms          integer     NOT NULL DEFAULT 30000,
  retries             integer     NOT NULL DEFAULT 2,
  fallback_config_id  uuid        REFERENCES model_config(id),
  rate_limit_per_min  integer,
  daily_budget_usd    numeric(10,2),
  embedding_dim       integer,
  task_type           text,
  enabled             boolean     NOT NULL DEFAULT true,
  notes               text,
  version             integer     NOT NULL DEFAULT 0,
  created_by          text        NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_model_embedding_dim CHECK (code <> 'EMBEDDING' OR embedding_dim IS NOT NULL),
  CONSTRAINT ck_model_no_self_fallback CHECK (fallback_config_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX uq_model_config_active ON model_config (code) WHERE state = 'ACTIVE' AND enabled;

CREATE TABLE model_pricing (
  id             uuid        PRIMARY KEY,
  provider       provider_code NOT NULL,
  model_id       text        NOT NULL,
  usd_per_m_in   numeric(10,6) NOT NULL DEFAULT 0,
  usd_per_m_out  numeric(10,6) NOT NULL DEFAULT 0,
  valid_from     date        NOT NULL DEFAULT current_date,
  valid_to       date,
  UNIQUE (provider, model_id, valid_from)
);

CREATE TABLE retrieval_config (
  id                             uuid        PRIMARY KEY,
  version_no                     integer     NOT NULL,
  channel                        channel     NOT NULL DEFAULT 'WEB_APP',
  state                          config_state NOT NULL DEFAULT 'DRAFT',
  top_k_dense                     integer     NOT NULL DEFAULT 25,
  top_k_fts                      integer     NOT NULL DEFAULT 20,
  top_k_trgm                     integer     NOT NULL DEFAULT 10,
  rrf_k                          integer     NOT NULL DEFAULT 60,
  w_dense                        numeric(4,2) NOT NULL DEFAULT 1.00,
  w_fts                          numeric(4,2) NOT NULL DEFAULT 0.85,
  w_trgm                         numeric(4,2) NOT NULL DEFAULT 0.45,
  min_score_dense                numeric(4,3) NOT NULL DEFAULT 0.350,
  min_score_fts                  numeric(4,3) NOT NULL DEFAULT 0.050,
  rerank_enabled                 boolean     NOT NULL DEFAULT true,
  rerank_top_n                   integer     NOT NULL DEFAULT 8,
  rerank_min_relevance           integer     NOT NULL DEFAULT 4,
  context_token_budget           integer     NOT NULL DEFAULT 6000,
  mmr_lambda                     numeric(3,2) NOT NULL DEFAULT 0.75,
  hyde_enabled                   boolean     NOT NULL DEFAULT false,
  query_expansion_enabled        boolean     NOT NULL DEFAULT true,
  cross_lingual_enabled          boolean     NOT NULL DEFAULT true,
  cross_lingual_fallback_min_hits integer    NOT NULL DEFAULT 3,
  boost_recent_days              integer     NOT NULL DEFAULT 90,
  embedding_variant              text        NOT NULL DEFAULT 'gemini-embedding-001@1536',
  review_id                      uuid,
  activated_at                   timestamptz,
  activated_by                   text,
  canary_percent                 integer     NOT NULL DEFAULT 100,
  version                        integer     NOT NULL DEFAULT 0,
  created_by                     text        NOT NULL,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, version_no)
);
CREATE UNIQUE INDEX uq_retrieval_config_active ON retrieval_config (channel) WHERE state = 'ACTIVE';

CREATE TABLE guardrail_policy (
  id             uuid        PRIMARY KEY,
  code           guardrail_policy_code NOT NULL,
  version_no     integer     NOT NULL,
  applies_to     guardrail_scope NOT NULL DEFAULT 'BOTH',
  severity       guardrail_severity NOT NULL DEFAULT 'HIGH',
  decision_on_hit guardrail_decision NOT NULL DEFAULT 'BLOCK',
  enabled        boolean     NOT NULL DEFAULT true,
  params         jsonb       NOT NULL DEFAULT '{}',
  risk_tier      risk_tier   NOT NULL DEFAULT 'T3_HIGH',
  state          config_state NOT NULL DEFAULT 'DRAFT',
  review_id      uuid,
  activated_at   timestamptz,
  activated_by   text,
  version        integer     NOT NULL DEFAULT 0,
  created_by     text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version_no)
);
CREATE UNIQUE INDEX uq_guardrail_active ON guardrail_policy (code) WHERE state = 'ACTIVE';
COMMENT ON COLUMN guardrail_policy.params IS
  'Lexicons (fr/ar/en + transliterations + Derja), thresholds, refusal template ids.';

CREATE TABLE assistant_config (
  key          text        PRIMARY KEY,
  value        jsonb       NOT NULL,
  value_type   text        NOT NULL DEFAULT 'JSON' CHECK (value_type IN ('STRING','TEXT','JSON','BOOL','INT')),
  locale       locale_code,
  risk_tier    risk_tier   NOT NULL DEFAULT 'T1_LOW',
  description  text,
  version      integer     NOT NULL DEFAULT 0,
  updated_by   text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE assistant_config IS
  'Suggested questions, disclaimers, refusal templates, feature flags, kb_epoch, kill-switch mode.';
CREATE TRIGGER trg_assistant_config_touch BEFORE UPDATE ON assistant_config
  FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();

CREATE TABLE message_bundle (
  message_key  text        NOT NULL,
  locale       locale_code NOT NULL,
  text         text        NOT NULL,
  PRIMARY KEY (message_key, locale)
);
COMMENT ON TABLE message_bundle IS 'DB-driven backend messages: errors, statuses, refusals, notifications.';

-- ══════════════════════════════════ CONVERSATION DOMAIN ════════════════════════════════════════

CREATE TABLE conversation (
  id               uuid        PRIMARY KEY,
  channel          channel     NOT NULL DEFAULT 'WEB_APP',
  principal_id     text,
  device_id        text,
  locale           locale_code NOT NULL DEFAULT 'fr-FR',
  state            conversation_state NOT NULL DEFAULT 'ACTIVE',
  handoff_ref      text,
  pii_class        classification NOT NULL DEFAULT 'PUBLIC',
  page_context     text,
  persist_conversation boolean NOT NULL DEFAULT true,
  turn_count       integer     NOT NULL DEFAULT 0,
  started_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  anonymised_at    timestamptz,
  CONSTRAINT ck_conversation_identity CHECK (principal_id IS NOT NULL OR device_id IS NOT NULL)
);
CREATE INDEX idx_conversation_principal ON conversation (principal_id, last_message_at DESC);
CREATE INDEX idx_conversation_device ON conversation (device_id, last_message_at DESC);
CREATE INDEX idx_conversation_state ON conversation (state) WHERE state <> 'CLOSED';

-- Partitioned monthly. PK includes the partition key.
CREATE TABLE message (
  id                  uuid        NOT NULL,
  conversation_id     uuid        NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  ordinal             integer     NOT NULL,
  role                message_role NOT NULL,
  content_raw         text,
  content_redacted    text,
  content_rendered    text,
  locale              locale_code NOT NULL,
  dir                 direction   NOT NULL DEFAULT 'ltr',
  detected_lang       locale_code,
  detected_intent     intent_code,
  citations           jsonb       NOT NULL DEFAULT '[]',
  refusal_code        refusal_code,
  disclaimer_ids      text[]      NOT NULL DEFAULT '{}',
  confidence          numeric(4,3),
  needs_human         boolean     NOT NULL DEFAULT false,
  no_answer           boolean     NOT NULL DEFAULT false,
  no_answer_reason    text,
  cached              boolean     NOT NULL DEFAULT false,
  prompt_version_id   uuid,
  model_config_id     uuid,
  retrieval_config_id uuid,
  experiment_arm      text,
  degradation_step    smallint    NOT NULL DEFAULT 1 CHECK (degradation_step BETWEEN 1 AND 5),
  ttft_ms             integer,
  latency_ms          integer,
  tokens_in           integer,
  tokens_out          integer,
  cost_usd            numeric(10,6),
  idempotency_key     uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  UNIQUE (conversation_id, ordinal, created_at),
  UNIQUE (idempotency_key, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_message_conv ON message (conversation_id, ordinal);
CREATE INDEX idx_message_intent ON message (detected_intent, created_at DESC);
CREATE INDEX idx_message_refusal ON message (refusal_code, created_at DESC) WHERE refusal_code IS NOT NULL;

CREATE TABLE retrieval_trace (
  id                 uuid        PRIMARY KEY,
  message_id         uuid        NOT NULL,
  message_created_at timestamptz NOT NULL,
  normalized_query   text,
  expanded_queries   jsonb       NOT NULL DEFAULT '[]',
  intent             intent_code,
  detected_lang      locale_code,
  answer_lang        locale_code,
  retrieval_config_id uuid,
  prompt_version_id  uuid,
  model_config_id    uuid,
  kb_epoch           integer,
  experiment_arm     text,
  context_tokens     integer,
  budget_tokens      integer,
  assembled_context  jsonb       NOT NULL DEFAULT '[]',
  best_score         numeric(5,4),
  outcome            text        NOT NULL DEFAULT 'ANSWERED'
                     CHECK (outcome IN ('ANSWERED','REFUSED','ERROR','CACHED','DEGRADED')),
  grounding_checked  integer     NOT NULL DEFAULT 0,
  grounding_failed   integer     NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (message_id, message_created_at) REFERENCES message (id, created_at) ON DELETE CASCADE
);
CREATE INDEX idx_trace_message ON retrieval_trace (message_id);

CREATE TABLE retrieval_candidate (
  id                uuid        NOT NULL,
  trace_id          uuid        NOT NULL REFERENCES retrieval_trace(id) ON DELETE CASCADE,
  chunk_id          uuid,
  strategy          retrieval_strategy NOT NULL,
  rank              integer     NOT NULL,
  score             numeric(7,6) NOT NULL,
  rrf_score         numeric(8,6),
  rerank_score      integer,
  reason_code       rerank_reason,
  selected          boolean     NOT NULL DEFAULT false,
  excluded_because  exclusion_reason,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_candidate_trace ON retrieval_candidate (trace_id, selected DESC, rrf_score DESC NULLS LAST);
CREATE INDEX idx_candidate_chunk ON retrieval_candidate (chunk_id, created_at DESC);

CREATE TABLE feedback (
  id              uuid        PRIMARY KEY,
  message_id      uuid        NOT NULL,
  message_created_at timestamptz NOT NULL,
  rating          feedback_rating NOT NULL,
  comment         text,
  contact_opt_in  boolean     NOT NULL DEFAULT false,
  contact         text,
  status          feedback_status NOT NULL DEFAULT 'NEW',
  triaged_by      text,
  triage_action   text,
  resolution_ref  text,
  review_id       uuid,
  eval_case_id    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  FOREIGN KEY (message_id, message_created_at) REFERENCES message (id, created_at) ON DELETE CASCADE
);
CREATE INDEX idx_feedback_status ON feedback (status, created_at DESC);
CREATE INDEX idx_feedback_sharia ON feedback (created_at DESC) WHERE rating = 'SHARIA_CONCERN';

CREATE TABLE llm_call_log (
  id             uuid        NOT NULL,
  message_id     uuid,
  purpose        model_role  NOT NULL,
  provider       provider_code NOT NULL,
  model_id       text        NOT NULL,
  status         text        NOT NULL,
  tokens_in      integer     NOT NULL DEFAULT 0,
  tokens_out     integer     NOT NULL DEFAULT 0,
  latency_ms     integer,
  cost_usd       numeric(10,6) NOT NULL DEFAULT 0,
  request_redacted  jsonb,
  response_redacted jsonb,
  error          text,
  correlation_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_llm_call_purpose ON llm_call_log (purpose, created_at DESC);
CREATE INDEX idx_llm_call_model ON llm_call_log (provider, model_id, created_at DESC);
COMMENT ON COLUMN llm_call_log.request_redacted IS 'Payload AFTER the egress PII gate. Never the raw text.';

CREATE TABLE guardrail_event (
  id              uuid        NOT NULL,
  message_id      uuid,
  chunk_id        uuid,
  policy_code     guardrail_policy_code NOT NULL,
  policy_version  integer     NOT NULL,
  decision        guardrail_decision NOT NULL,
  severity        guardrail_severity NOT NULL,
  violation_code  text        NOT NULL,
  evidence        text,
  refusal_code    refusal_code,
  stage           text        NOT NULL DEFAULT 'OUTPUT' CHECK (stage IN ('INPUT','OUTPUT','INGESTION')),
  correlation_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE INDEX idx_guardrail_event_policy ON guardrail_event (policy_code, decision, created_at DESC);
CREATE INDEX idx_guardrail_event_severity ON guardrail_event (created_at DESC)
  WHERE severity IN ('CRITICAL','HIGH');
COMMENT ON COLUMN guardrail_event.chunk_id IS
  'Set when the trigger was ingested content (indirect prompt injection) rather than a user message.';

CREATE TABLE token_usage_daily (
  day          date        NOT NULL,
  purpose      model_role  NOT NULL,
  provider     provider_code NOT NULL,
  model_id     text        NOT NULL,
  calls        bigint      NOT NULL DEFAULT 0,
  tokens_in    bigint      NOT NULL DEFAULT 0,
  tokens_out   bigint      NOT NULL DEFAULT 0,
  cost_usd     numeric(14,4) NOT NULL DEFAULT 0,
  errors       bigint      NOT NULL DEFAULT 0,
  PRIMARY KEY (day, purpose, provider, model_id)
);

-- ══════════════════════════════════ GOVERNANCE DOMAIN ══════════════════════════════════════════

CREATE TABLE sharia_review (
  id               uuid        PRIMARY KEY,
  ref              text        NOT NULL UNIQUE,
  subject_type     review_subject_type NOT NULL,
  subject_id       uuid        NOT NULL,
  subject_label    text,
  risk_tier        risk_tier   NOT NULL,
  risk_factors     jsonb       NOT NULL DEFAULT '[]',
  state            review_state NOT NULL DEFAULT 'PENDING',
  submitted_by     text        NOT NULL,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  due_at           timestamptz NOT NULL,
  decided_at       timestamptz,
  decision_reason_fr text,
  decision_reason_ar text,
  decision_reason_en text,
  decision_by      text,
  committee_ref    text,
  version          integer     NOT NULL DEFAULT 0,
  CONSTRAINT ck_review_tier_sane CHECK (risk_tier IN ('T1_LOW','T2_MEDIUM','T3_HIGH'))
);
COMMENT ON TABLE sharia_review IS 'Workflow instance. Two-eyes and quorum are enforced by trigger.';
CREATE INDEX idx_review_queue ON sharia_review (state, due_at)
  WHERE state IN ('PENDING','IN_REVIEW','CHANGES_REQUESTED');
CREATE INDEX idx_review_subject ON sharia_review (subject_type, subject_id);

ALTER TABLE document_version ADD CONSTRAINT fk_docver_review
  FOREIGN KEY (sharia_review_id) REFERENCES sharia_review(id);
ALTER TABLE prompt_version   ADD CONSTRAINT fk_prompt_review
  FOREIGN KEY (review_id) REFERENCES sharia_review(id);
ALTER TABLE retrieval_config ADD CONSTRAINT fk_retrieval_review
  FOREIGN KEY (review_id) REFERENCES sharia_review(id);
ALTER TABLE guardrail_policy ADD CONSTRAINT fk_policy_review
  FOREIGN KEY (review_id) REFERENCES sharia_review(id);

CREATE TABLE review_task (
  id            uuid        PRIMARY KEY,
  review_id     uuid        NOT NULL REFERENCES sharia_review(id) ON DELETE CASCADE,
  assignee_role text        NOT NULL,
  assignee_id   text,
  required      boolean     NOT NULL DEFAULT true,
  decision      review_decision,
  comments      text,
  scope         text        NOT NULL DEFAULT 'ALL_CHUNKS' CHECK (scope IN ('ALL_CHUNKS','SELECTED_CHUNKS')),
  chunk_ids     uuid[]      NOT NULL DEFAULT '{}',
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_task_decided_has_actor CHECK (decision IS NULL OR (assignee_id IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE INDEX idx_review_task_queue ON review_task (assignee_role, decided_at) WHERE decided_at IS NULL;
CREATE INDEX idx_review_task_review ON review_task (review_id);

-- ── HARD GUARANTEE 3a: nobody approves their own submission ────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_reject_self_approval() RETURNS trigger AS $$
DECLARE submitter text;
BEGIN
  IF NEW.decision IS NULL THEN RETURN NEW; END IF;
  SELECT submitted_by INTO submitter FROM sharia_review WHERE id = NEW.review_id;
  IF submitter IS NOT DISTINCT FROM NEW.assignee_id THEN
    RAISE EXCEPTION 'GOVERNANCE.SELF_APPROVAL: % cannot decide on review % they submitted',
      NEW.assignee_id, NEW.review_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_review_no_self_approval BEFORE INSERT OR UPDATE OF decision ON review_task
  FOR EACH ROW EXECUTE FUNCTION fn_reject_self_approval();

-- ── HARD GUARANTEE 3b: T3 needs a Sharia officer AND compliance ────────────────────────────────
CREATE OR REPLACE FUNCTION fn_require_t3_quorum() RETURNS trigger AS $$
DECLARE officers integer; compliance_n integer; rejected integer;
BEGIN
  IF NEW.state IS DISTINCT FROM 'APPROVED' THEN RETURN NEW; END IF;
  SELECT count(*) FILTER (WHERE assignee_role = 'SHARIA_OFFICER' AND decision = 'APPROVE'),
         count(*) FILTER (WHERE assignee_role = 'COMPLIANCE'     AND decision = 'APPROVE'),
         count(*) FILTER (WHERE decision = 'REJECT')
    INTO officers, compliance_n, rejected
    FROM review_task WHERE review_id = NEW.id;

  IF rejected > 0 THEN
    RAISE EXCEPTION 'GOVERNANCE.STATE_TRANSITION_INVALID: review % has a rejection', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.risk_tier = 'T3_HIGH' AND (officers < 1 OR compliance_n < 1) THEN
    RAISE EXCEPTION 'GOVERNANCE.QUORUM_NOT_MET: T3 review % needs SHARIA_OFFICER + COMPLIANCE approvals', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.risk_tier = 'T2_MEDIUM' AND officers < 1 THEN
    RAISE EXCEPTION 'GOVERNANCE.QUORUM_NOT_MET: T2 review % needs at least one approval', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.decided_at := now();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_t3_quorum BEFORE UPDATE OF state ON sharia_review
  FOR EACH ROW EXECUTE FUNCTION fn_require_t3_quorum();

CREATE TABLE fatwa_request (
  id              uuid        PRIMARY KEY,
  ref             text        NOT NULL UNIQUE,
  origin          text        NOT NULL DEFAULT 'CHAT' CHECK (origin IN ('CHAT','ADMIN','COMMITTEE')),
  conversation_id uuid        REFERENCES conversation(id) ON DELETE SET NULL,
  message_id      uuid,
  question_fr     text,
  question_ar     text,
  question_en     text,
  question_locale locale_code NOT NULL DEFAULT 'fr-FR',
  state           fatwa_state NOT NULL DEFAULT 'OPEN',
  assigned_to     text,
  answer_fr       text,
  answer_ar       text,
  answer_en       text,
  committee_ref   text,
  resulting_document_id uuid REFERENCES document(id) ON DELETE SET NULL,
  contact         text,
  sla_due_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  answered_at     timestamptz
);
CREATE INDEX idx_fatwa_queue ON fatwa_request (state, sla_due_at) WHERE state IN ('OPEN','ASSIGNED');

CREATE TABLE incident (
  id            uuid        PRIMARY KEY,
  ref           text        NOT NULL UNIQUE,
  severity      severity_level NOT NULL,
  title         text        NOT NULL,
  trigger_type  text        NOT NULL CHECK (trigger_type IN
                  ('GUARDRAIL','FEEDBACK','WITHDRAWAL','KILL_SWITCH','PROVIDER','SECURITY','DATA','OTHER')),
  status        text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CONTAINED','RESOLVED','CLOSED')),
  opened_by     text,
  opened_at     timestamptz NOT NULL DEFAULT now(),
  contained_at  timestamptz,
  resolved_at   timestamptz,
  root_cause    text,
  corrective_action text,
  evidence_pack_id uuid,
  review_id     uuid REFERENCES sharia_review(id)
);
CREATE INDEX idx_incident_open ON incident (severity, opened_at DESC) WHERE status <> 'CLOSED';

-- ═══════════════════════════════════ QUALITY DOMAIN ════════════════════════════════════════════

CREATE TABLE eval_case (
  id                    text        PRIMARY KEY,
  question              text        NOT NULL,
  question_lang         locale_code NOT NULL,
  expected_answer_lang  locale_code NOT NULL,
  expected_intents      intent_code[] NOT NULL DEFAULT '{}',
  must_cite_chunks      text[]      NOT NULL DEFAULT '{}',
  must_not_cite_chunks  text[]      NOT NULL DEFAULT '{}',
  must_contain_terms    text[]      NOT NULL DEFAULT '{}',
  must_not_contain_terms text[]     NOT NULL DEFAULT '{}',
  must_contain_patterns text[]      NOT NULL DEFAULT '{}',
  expect_refusal_code   refusal_code,
  reference_answer      text,
  tags                  text[]      NOT NULL DEFAULT '{}',
  weight                integer     NOT NULL DEFAULT 1 CHECK (weight > 0),
  source                text,
  review_id             uuid REFERENCES sharia_review(id),
  state                 text        NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','RETIRED','BROKEN')),
  created_by            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_eval_case_tags ON eval_case USING gin (tags) WHERE state = 'ACTIVE';

CREATE TABLE eval_run (
  id             uuid        PRIMARY KEY,
  scope          text        NOT NULL DEFAULT 'FULL' CHECK (scope IN ('PR_SUBSET','FULL','RED_TEAM_ONLY')),
  status         job_status  NOT NULL DEFAULT 'QUEUED',
  gate           gate_result NOT NULL DEFAULT 'RUNNING',
  bundle         jsonb       NOT NULL DEFAULT '{}',
  case_count     integer     NOT NULL DEFAULT 0,
  scorecard      jsonb,
  cost_usd       numeric(10,4) NOT NULL DEFAULT 0,
  duration_ms    bigint,
  triggered_by   text,
  release_bundle_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
COMMENT ON COLUMN eval_run.bundle IS 'kbEpoch, promptVersions, retrievalConfig, modelConfig, guardrailPolicies.';

CREATE TABLE eval_case_result (
  id                  uuid        PRIMARY KEY,
  eval_run_id         uuid        NOT NULL REFERENCES eval_run(id) ON DELETE CASCADE,
  eval_case_id        text        NOT NULL REFERENCES eval_case(id),
  passed              boolean     NOT NULL,
  answer_markdown     text,
  refusal_code        refusal_code,
  cited_chunks        text[]      NOT NULL DEFAULT '{}',
  faithfulness        numeric(5,4),
  context_recall      numeric(5,4),
  context_precision   numeric(5,4),
  answer_relevancy    numeric(3,1),
  numeric_grounded    boolean,
  terminology_ok      boolean,
  language_ok         boolean,
  policy_violations   text[]      NOT NULL DEFAULT '{}',
  latency_ms          integer,
  cost_usd            numeric(10,6),
  failure_reasons     text[]      NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_eval_result_run ON eval_case_result (eval_run_id, passed);
CREATE INDEX idx_eval_result_case ON eval_case_result (eval_case_id, created_at DESC);

ALTER TABLE prompt_version ADD CONSTRAINT fk_prompt_eval_run
  FOREIGN KEY (eval_run_id) REFERENCES eval_run(id);

CREATE TABLE experiment (
  id             uuid        PRIMARY KEY,
  code           text        NOT NULL UNIQUE,
  hypothesis     text        NOT NULL,
  kind           text        NOT NULL CHECK (kind IN ('PROMPT','RETRIEVAL_CONFIG','MODEL_CONFIG')),
  arm_a          jsonb       NOT NULL,
  arm_b          jsonb       NOT NULL,
  traffic_percent integer    NOT NULL DEFAULT 10 CHECK (traffic_percent BETWEEN 0 AND 100),
  target_metrics text[]      NOT NULL DEFAULT '{}',
  stop_conditions jsonb      NOT NULL DEFAULT '{}',
  state          text        NOT NULL DEFAULT 'DRAFT'
                 CHECK (state IN ('DRAFT','RUNNING','STOPPED','PROMOTED','ABANDONED')),
  started_at     timestamptz,
  ended_at       timestamptz,
  created_by     text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ═════════════════════════════ AUDIT, RIGHTS, RELEASES ═════════════════════════════════════════

CREATE TABLE audit_event (
  seq            bigserial,
  id             uuid        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor          text        NOT NULL,
  actor_role     text,
  action         text        NOT NULL,
  subject_type   text        NOT NULL,
  subject_id     text,
  before_json    jsonb,
  after_json     jsonb,
  reason         text,
  reason_code    text,
  correlation_id uuid,
  prev_hash      text        NOT NULL,
  hash           text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (seq, created_at)
) PARTITION BY RANGE (created_at);
-- Uniqueness of seq across partitions is guaranteed by the sequence itself; a UNIQUE index on a
-- partitioned table would have to include the partition key, so it is deliberately omitted here.
CREATE INDEX idx_audit_actor ON audit_event (actor, occurred_at DESC);
CREATE INDEX idx_audit_subject ON audit_event (subject_type, subject_id, occurred_at DESC);
CREATE INDEX idx_audit_action ON audit_event (action, occurred_at DESC);
COMMENT ON COLUMN audit_event.reason_code IS 'Break-glass justification for personal-data access.';

-- ── HARD GUARANTEE 2: append-only + hash chain ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT.IMMUTABLE: audit_event cannot be modified or deleted'
    USING ERRCODE = 'insufficient_privilege';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION fn_audit_append_only();
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION fn_audit_append_only();

CREATE OR REPLACE FUNCTION fn_audit_hash_chain() RETURNS trigger AS $$
DECLARE prev text; e record;
BEGIN
  SELECT hash INTO prev FROM audit_event ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := coalesce(prev, repeat('0',64));
  IF NEW.occurred_at IS NULL THEN NEW.occurred_at := now(); END IF;
  e := NEW;  -- seq not yet assigned; filled below for determinism
  IF NEW.seq IS NULL THEN NEW.seq := nextval(pg_get_serial_sequence('albaraka_ai.audit_event','seq')); END IF;
  e := NEW;
  NEW.hash := encode(digest(e.prev_hash || canonical_audit_json(e), 'sha256'), 'hex');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_chain BEFORE INSERT ON audit_event
  FOR EACH ROW EXECUTE FUNCTION fn_audit_hash_chain();

CREATE OR REPLACE FUNCTION fn_verify_audit_chain(p_from timestamptz, p_to timestamptz)
RETURNS TABLE(valid boolean, events_checked bigint, head_hash text, first_broken_seq bigint) AS $$
DECLARE cur record; expected_prev text := NULL; broken bigint := NULL; n bigint := 0; head text := NULL;
BEGIN
  FOR cur IN
    SELECT seq, id, occurred_at, actor, action, subject_type, subject_id, before_json, after_json,
           reason, reason_code, correlation_id, prev_hash, hash
      FROM audit_event
     WHERE occurred_at >= p_from AND occurred_at < p_to
     ORDER BY seq
  LOOP
    n := n + 1;
    IF expected_prev IS NOT NULL AND cur.prev_hash <> expected_prev THEN
      IF broken IS NULL THEN broken := cur.seq; END IF;
    END IF;
    IF cur.hash <> encode(digest(cur.prev_hash || canonical_audit_json(cur), 'sha256'), 'hex') THEN
      IF broken IS NULL THEN broken := cur.seq; END IF;
    END IF;
    expected_prev := cur.hash;
    head := cur.hash;
  END LOOP;
  valid := (broken IS NULL); events_checked := n; head_hash := head; first_broken_seq := broken;
  RETURN NEXT;
END; $$ LANGUAGE plpgsql;

CREATE TABLE erasure_request (
  id             uuid        PRIMARY KEY,
  subject_ref    text        NOT NULL,
  scope          text        NOT NULL DEFAULT 'CONVERSATIONS'
                 CHECK (scope IN ('CONVERSATIONS','FEEDBACK_CONTACT','ALL')),
  legal_hold     boolean     NOT NULL DEFAULT false,
  status         text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','EXECUTED','REJECTED')),
  requested_by   text        NOT NULL,
  approved_by    text,
  executed_at    timestamptz,
  evidence       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_preference (
  principal_id   text        NOT NULL,
  locale         locale_code NOT NULL DEFAULT 'fr-FR',
  numeral_system text        NOT NULL DEFAULT 'western' CHECK (numeral_system IN ('western','eastern')),
  text_scale     numeric(3,2) NOT NULL DEFAULT 1.00,
  theme          text        NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','high-contrast','system')),
  notify_review  boolean     NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id)
);

CREATE TABLE release_bundle (
  id             uuid        PRIMARY KEY,
  name           text        NOT NULL,
  git_sha        text        NOT NULL,
  image_tag      text        NOT NULL,
  kb_epoch       integer     NOT NULL,
  prompt_versions jsonb      NOT NULL DEFAULT '{}',
  retrieval_config_version integer NOT NULL,
  model_config_versions jsonb NOT NULL DEFAULT '{}',
  guardrail_policy_versions jsonb NOT NULL DEFAULT '{}',
  eval_run_id    uuid        REFERENCES eval_run(id),
  gate           gate_result NOT NULL DEFAULT 'PENDING',
  approvals      jsonb       NOT NULL DEFAULT '[]',
  environments   text[]      NOT NULL DEFAULT '{}',
  created_by     text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  promoted_at    timestamptz
);
CREATE UNIQUE INDEX uq_release_bundle_git ON release_bundle (git_sha, kb_epoch);

-- ═══════════════════════════════════ PARTITION MAINTENANCE ════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_ensure_monthly_partition(p_table text, p_month date) RETURNS void AS $$
DECLARE part text; start_d date := date_trunc('month', p_month)::date;
        end_d date := (date_trunc('month', p_month) + interval '1 month')::date;
BEGIN
  part := format('%s_%s', p_table, to_char(start_d,'YYYYMM'));
  IF to_regclass(format('albaraka_ai.%I', part)) IS NULL THEN
    EXECUTE format('CREATE TABLE albaraka_ai.%I PARTITION OF albaraka_ai.%I FOR VALUES FROM (%L) TO (%L)',
                   part, p_table, start_d, end_d);
  END IF;
END; $$ LANGUAGE plpgsql;

-- Called by the scheduler on the 20th of each month for the next two months.
CREATE OR REPLACE FUNCTION fn_ensure_partitions_ahead() RETURNS void AS $$
DECLARE t text; m date;
BEGIN
  FOREACH t IN ARRAY ARRAY['message','retrieval_candidate','llm_call_log','guardrail_event','audit_event']
  LOOP
    FOR i IN 0..2 LOOP
      m := (date_trunc('month', now()) + (i || ' month')::interval)::date;
      PERFORM fn_ensure_monthly_partition(t, m);
    END LOOP;
  END LOOP;
END; $$ LANGUAGE plpgsql;

-- Default partitions so nothing is ever rejected before the scheduler runs.
-- CAVEAT: creating a monthly partition later fails if the DEFAULT partition already holds rows in
-- that range, which is why fn_ensure_partitions_ahead() always runs one to two months ahead.
CREATE TABLE message_default             PARTITION OF message             DEFAULT;
CREATE TABLE retrieval_candidate_default PARTITION OF retrieval_candidate DEFAULT;
CREATE TABLE llm_call_log_default        PARTITION OF llm_call_log        DEFAULT;
CREATE TABLE guardrail_event_default     PARTITION OF guardrail_event     DEFAULT;
CREATE TABLE audit_event_default         PARTITION OF audit_event         DEFAULT;
SELECT fn_ensure_partitions_ahead();

-- ═══════════════════════════════════════ VIEWS ═════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_review_queue AS
SELECT r.id, r.ref, r.subject_type, r.subject_label, r.risk_tier, r.state, r.due_at,
       r.submitted_by, t.id AS task_id, t.assignee_role, t.assignee_id, t.decision,
       (r.due_at < now() AND t.decision IS NULL) AS overdue,
       age(now(), r.submitted_at) AS waiting_for
  FROM sharia_review r JOIN review_task t ON t.review_id = r.id
 WHERE r.state IN ('PENDING','IN_REVIEW','CHANGES_REQUESTED');

CREATE OR REPLACE VIEW v_governance_kpis AS
SELECT
  (SELECT count(*) FROM sharia_review WHERE state IN ('PENDING','IN_REVIEW'))                       AS reviews_open,
  (SELECT count(*) FROM sharia_review WHERE state IN ('PENDING','IN_REVIEW') AND due_at < now())    AS reviews_overdue,
  (SELECT count(*) FROM fatwa_request  WHERE state IN ('OPEN','ASSIGNED'))                          AS fatwa_open,
  (SELECT count(*) FROM incident WHERE status <> 'CLOSED' AND severity IN ('S1','S2'))              AS incidents_open,
  (SELECT count(*) FROM feedback WHERE rating = 'SHARIA_CONCERN' AND status NOT IN ('RESOLVED','DISMISSED'))
                                                                                                    AS sharia_concerns_open,
  (SELECT count(*) FROM chunk WHERE searchable)                                                     AS chunks_searchable,
  (SELECT count(*) FROM chunk WHERE embedding_status <> 'EMBEDDED')                                 AS chunks_pending_embedding,
  (SELECT count(*) FROM document WHERE valid_to IS NOT NULL AND valid_to <= current_date + 30
       AND lifecycle_state = 'PUBLISHED')                                                           AS documents_expiring_30d;

CREATE OR REPLACE VIEW v_coverage_gaps AS
SELECT m.no_answer_reason,
       m.detected_intent,
       m.locale,
       count(*)                                     AS occurrences,
       max(m.created_at)                            AS last_seen,
       array_agg(DISTINCT left(coalesce(m.content_redacted, m.content_raw), 140)) FILTER (WHERE m.content_raw IS NOT NULL)
                                                    AS sample_questions
  FROM message m
 WHERE m.role = 'ASSISTANT' AND (m.no_answer OR m.refusal_code = 'REF-05')
 GROUP BY 1,2,3
 ORDER BY occurrences DESC;

CREATE OR REPLACE VIEW v_cost_daily AS
SELECT day, purpose, provider, model_id, calls, tokens_in, tokens_out, cost_usd, errors
  FROM token_usage_daily
 ORDER BY day DESC, cost_usd DESC;

-- ═══════════════════════════════════════ GRANTS ════════════════════════════════════════════════
-- DO NOT GRANT UPDATE/DELETE ON audit_event TO ANY ROLE.
--
-- CREATE ROLE albaraka_app        LOGIN PASSWORD :'pwd';
-- CREATE ROLE albaraka_worker     LOGIN PASSWORD :'pwd';
-- CREATE ROLE albaraka_readonly   LOGIN PASSWORD :'pwd';
-- GRANT USAGE ON SCHEMA albaraka_ai TO albaraka_app, albaraka_worker, albaraka_readonly;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA albaraka_ai TO albaraka_app;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA albaraka_ai TO albaraka_worker;
-- GRANT SELECT ON ALL TABLES IN SCHEMA albaraka_ai TO albaraka_readonly;
-- REVOKE UPDATE, DELETE ON albaraka_ai.audit_event FROM albaraka_app, albaraka_worker;
-- GRANT USAGE ON ALL SEQUENCES IN SCHEMA albaraka_ai TO albaraka_app, albaraka_worker;
