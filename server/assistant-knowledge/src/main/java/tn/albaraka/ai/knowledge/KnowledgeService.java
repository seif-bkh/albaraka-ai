package tn.albaraka.ai.knowledge;

import tools.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tn.albaraka.ai.shared.error.ApiException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Knowledge-base lifecycle (ADR-009 boundary: Spring owns documents/versions/chunks and the
 * publication gate; rag-assistant owns embeddings/retrieval).
 */
@Service
public class KnowledgeService {

    private final JdbcTemplate db;
    private final ObjectMapper json;

    public KnowledgeService(JdbcTemplate db, ObjectMapper json) { this.db = db; this.json = json; }

    public record NewDocument(UUID id, UUID versionId, int chunkCount) {}

    /** Create a document (if new) + a DRAFT version + chunks. Caller then submits the review. */
    @Transactional
    public NewDocument createVersion(String titleFr, String titleAr, String titleEn, String bodyText,
                                     String lang, List<String> paragraphs, String actor) {
        List<UUID> collections = db.query("SELECT id FROM albaraka_ai.collection WHERE code = 'PRODUCTS'",
                (rs, i) -> rs.getObject("id", UUID.class));
        UUID collectionId = collections.isEmpty()
                ? db.queryForObject("INSERT INTO albaraka_ai.collection (id, code, name_fr, name_ar, name_en) " +
                        "VALUES (?, 'PRODUCTS', 'Produits', 'المنتجات', 'Products') RETURNING id",
                        (rs, i) -> rs.getObject("id", UUID.class), UUID.randomUUID())
                : collections.getFirst();

        UUID docId;
        var existing = db.query("SELECT id FROM albaraka_ai.document WHERE title_fr = ? LIMIT 1",
                (rs, i) -> rs.getObject("id", UUID.class), titleFr);
        if (!existing.isEmpty()) {
            docId = existing.getFirst();
        } else {
            docId = UUID.randomUUID();
            db.update("""
                    INSERT INTO albaraka_ai.document
                      (id, collection_id, title_fr, title_ar, title_en, source_lang, lifecycle_state, created_by)
                    VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?)
                    """, docId, collectionId, titleFr, titleAr, titleEn, lang, actor);
        }
        UUID versionId = UUID.randomUUID();
        db.update("""
                INSERT INTO albaraka_ai.document_version
                  (id, document_id, version_no, body_text, body_lang, state, body_sha256, created_by)
                VALUES (?, ?, 1, ?, ?, 'DRAFT', ?, ?)
                """, versionId, docId, bodyText, lang, sha256(bodyText), actor);

        int ordinal = 0;
        for (String p : paragraphs) {
            if (p.isBlank()) continue;
            ordinal++;
            UUID chunkId = UUID.randomUUID();
            db.update("""
                    INSERT INTO albaraka_ai.chunk
                      (id, document_version_id, ordinal, content, heading_path, token_count, lang,
                       normalized_text, content_sha256, embedding_status)
                    VALUES (?, ?, ?, ?, ARRAY['DRAFT'], ?, ?, ?, ?, 'PENDING')
                    """, chunkId, versionId, ordinal, p, tokenCount(p), lang, p, sha256(p));
        }
        return new NewDocument(docId, versionId, ordinal);
    }

    /** Sharia-approved version → publish (publication is the only way chunks become searchable). */
    @Transactional
    public void publish(UUID versionId, UUID reviewId, String actor) {
        db.update("""
                UPDATE albaraka_ai.document_version
                SET state = 'PUBLISHED', published_at = now(), published_by = ?
                WHERE id = ? AND state IN ('SHARIA_APPROVED','IN_REVIEW','CHANGES_REQUESTED')
                """, actor, versionId);
        db.update("""
                UPDATE albaraka_ai.document d SET lifecycle_state = 'PUBLISHED', current_version_id = ?, updated_by = ?
                WHERE id = (SELECT document_id FROM albaraka_ai.document_version WHERE id = ?)
                """, versionId, actor, versionId);
        // Mark embeddings READY for the mock backend; the python service seeds its own demo vectors.
        db.update("UPDATE albaraka_ai.chunk SET embedding_status = 'EMBEDDED', embedding_model = 'mock-embeddings', " +
                        "embedding_dim = 1536, sharia_approved = true, published = true WHERE document_version_id = ?",
                versionId);
    }

    public List<Map<String, Object>> listDocuments() {
        return db.query("""
                SELECT d.id, d.title_fr, d.title_ar, d.title_en, d.lifecycle_state, d.version,
                       v.id AS version_id, v.state AS version_state, v.sharia_review_id
                FROM albaraka_ai.document d
                LEFT JOIN albaraka_ai.document_version v ON v.document_id = d.id
                ORDER BY d.created_at DESC
                """, (rs, i) -> map(
                "id", rs.getObject("id", UUID.class).toString(),
                "titleFr", nz(rs.getString("title_fr")),
                "titleAr", nz(rs.getString("title_ar")),
                "titleEn", nz(rs.getString("title_en")),
                "lifecycleState", rs.getString("lifecycle_state"),
                "version", rs.getInt("version"),
                "versionId", rs.getObject("version_id") == null ? null : rs.getObject("version_id", UUID.class).toString(),
                "versionState", rs.getString("version_state"),
                "reviewId", rs.getObject("sharia_review_id") == null ? null : rs.getObject("sharia_review_id", UUID.class).toString()));
    }

    public Map<String, Object> getDocument(UUID id) {
        var docs = db.query("""
                SELECT d.*, v.id AS version_id, v.body_text, v.state AS version_state
                FROM albaraka_ai.document d
                LEFT JOIN albaraka_ai.document_version v ON v.document_id = d.id AND v.state = 'PUBLISHED'
                WHERE d.id = ?
                """, (rs, i) -> map(
                "id", rs.getObject("id", UUID.class).toString(),
                "titleFr", nz(rs.getString("title_fr")),
                "titleAr", nz(rs.getString("title_ar")),
                "titleEn", nz(rs.getString("title_en")),
                "lifecycleState", rs.getString("lifecycle_state"),
                "bodyText", rs.getString("body_text") == null ? "" : nz(rs.getString("body_text")),
                "versionId", rs.getObject("version_id") == null ? null : rs.getObject("version_id", UUID.class).toString(),
                "versionState", rs.getString("version_state")), id);
        if (docs.isEmpty()) throw ApiException.notFound("RESOURCE.NOT_FOUND", "document not found");
        return docs.getFirst();
    }

    public List<Map<String, Object>> listCollections() {
        return db.query("SELECT code, name_fr, name_ar, name_en FROM albaraka_ai.collection ORDER BY code",
                (rs, i) -> map("code", rs.getString("code"), "nameFr", nz(rs.getString("name_fr")),
                        "nameAr", nz(rs.getString("name_ar")), "nameEn", nz(rs.getString("name_en"))));
    }


    /** Null-tolerant map for response rows (Map.of rejects null values). */
    static java.util.Map<String, Object> map(Object... kv) {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    private static String nz(String s) { return s == null ? "" : s; }

    private static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static int tokenCount(String s) { return Math.max(1, s.split("\\s+").length); }
}
