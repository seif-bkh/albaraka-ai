/**
 * rag.js — hybrid retrieval over the REAL Sharia gate.
 *
 * The only predicate used is `chunk.searchable` (published AND sharia_approved AND not
 * quarantined AND embedded AND within validity), maintained by the schema trigger — a chunk can
 * never be retrieved before its document version is published. Ranking is a hybrid of:
 *   · FTS rank over albaraka_fts with OR semantics (stemming-tolerant: "ouvrir" must match the
 *     chunk that says "ouverture"),
 *   · trigram similarity (typo / Arabic-script tolerance — the parser keeps Arabic tokens exact),
 *   · keyword containment.
 * The Spring AI / pgvector dense path replaces the ranking layer in the target topology while
 * keeping the same SQL contract (searchable gate, audience scoping, locale preference).
 */
function normalizeWords(text) {
  return [...new Set(
    String(text).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3)
  )];
}

/** Arabic-script folding: diacritics/variants + definite article, plus a root-ish fallback
 *  (drop the leading alef) — the demo stems far enough for exact-token FTS to have a friend. */
function arabicPatterns(words) {
  const out = [];
  for (const w of words) {
    if (!/[\u0600-\u06FF]/.test(w)) continue;
    let f = w.replace(/[\u064B-\u065F\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
    if (f.startsWith('ال') && f.length > 4) out.push(f.slice(2));
    out.push(f);
    if (f.startsWith('ا') && f.length >= 4) out.push(f.slice(1));
  }
  return [...new Set(out)].slice(0, 12);
}

export async function retrieve({ text, locale, pool, limit = 8 }) {
  const langs = locale === 'ar-TN' ? ['ar-TN', 'fr-FR', 'en-GB'] : [locale, 'fr-FR', 'en-GB'];
  const words = normalizeWords(text);
  const orQ = words.join(' | ');
  const patterns = [...new Set([...words, ...arabicPatterns(words)])].map((w) => `%${w}%`);
  const { rows } = await pool.query(
    `SELECT c.id::text AS chunk_id, c.ordinal, c.content, c.lang, c.normalized_text, c.valid_to,
            d.id::text AS document_id, d.title_fr, d.title_ar, d.title_en, d.source_uri,
            ts_rank(c.tsv, to_tsquery('albaraka_ai.albaraka_fts', $3))::float AS ftsscore,
            albaraka_ai.similarity(c.normalized_text, $1)::float AS sim
       FROM albaraka_ai.chunk c
       JOIN albaraka_ai.document_version dv ON dv.id = c.document_version_id
       JOIN albaraka_ai.document d          ON d.id  = dv.document_id
      WHERE c.searchable
        AND c.audience = 'PUBLIC'
        AND c.lang = ANY($2)
        AND (  c.tsv @@ to_tsquery('albaraka_ai.albaraka_fts', $3)
            OR c.tsv @@ websearch_to_tsquery('albaraka_ai.albaraka_fts', $1)
            OR albaraka_ai.similarity(c.normalized_text, $1) > 0.05
            OR c.normalized_text ILIKE ANY($4) )
      ORDER BY (CASE WHEN c.tsv @@ to_tsquery('albaraka_ai.albaraka_fts', $3) THEN 1 ELSE 0 END) DESC,
               (CASE WHEN c.normalized_text ILIKE ANY($4) THEN 1 ELSE 0 END) DESC,
               albaraka_ai.similarity(c.normalized_text, $1) DESC
      LIMIT $5`,
    [text, langs, orQ, patterns, limit]
  );
  const candidates = rows.map((r, i) => ({
    ...r,
    title: r.title_fr || r.title_ar || r.title_en,
    score: Math.max(0, +(0.95 - i * 0.07).toFixed(4)),
    rank: i + 1,
  }));

  // closest sources for honest refusals (REF-05 shows the three nearest approved documents)
  const { rows: near } = await pool.query(
    `SELECT DISTINCT ON (d.id) d.id::text AS document_id, d.title_fr, d.title_ar, d.title_en,
            c.id::text AS chunk_id, c.content, c.lang,
            albaraka_ai.similarity(c.normalized_text, $1)::float AS sim
       FROM albaraka_ai.chunk c
       JOIN albaraka_ai.document_version dv ON dv.id = c.document_version_id
       JOIN albaraka_ai.document d          ON d.id  = dv.document_id
      WHERE c.searchable AND c.audience = 'PUBLIC'
      ORDER BY d.id, sim DESC
      LIMIT 9`,
    [text]
  );
  const topSources = near
    .sort((a, b) => (b.sim ?? 0) - (a.sim ?? 0))
    .slice(0, 3)
    .map((r) => ({ documentId: r.document_id, title: r.title_fr || r.title_ar || r.title_en, score: +(r.sim ?? 0).toFixed(4), chunkId: r.chunk_id }));

  return { candidates, topSources };
}
