package tn.albaraka.ai.api;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tn.albaraka.ai.audit.AuditEventStore;
import tn.albaraka.ai.governance.ShariaReviewService;
import tn.albaraka.ai.knowledge.KnowledgeService;
import tn.albaraka.ai.shared.ReviewDecision;
import tn.albaraka.ai.shared.RiskTier;
import tn.albaraka.ai.shared.error.ApiException;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Objects;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Backoffice API (admin-api.ts contract, specs/openapi.yaml /api/v1/admin). */
@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {

    private final JdbcTemplate db;
    private final KnowledgeService knowledge;
    private final ShariaReviewService reviews;
    private final AuditEventStore audit;

    public AdminController(JdbcTemplate db, KnowledgeService knowledge, ShariaReviewService reviews,
                           AuditEventStore audit) {
        this.db = db; this.knowledge = knowledge; this.reviews = reviews; this.audit = audit;
    }

    // ── identity ────────────────────────────────────────────────────────────────────────────────
    @GetMapping("/me")
    public Map<String, Object> me(@AuthenticationPrincipal Jwt jwt) {
        Map<String, Object> realm = jwt.getClaimAsMap("realm_access");
        return map("subject", jwt.getSubject(),
                "email", jwt.getClaimAsString("email"),
                "roles", realm != null && realm.get("roles") instanceof List<?> l
                        ? l.stream().map(String::valueOf).toList() : List.of());
    }

    // ── dashboard ────────────────────────────────────────────────────────────────────────────────
    @GetMapping("/dashboard")
    public Map<String, Object> dashboard() {
        Map<String, Object> out = new HashMap<>();
        out.put("documents", count("SELECT count(*) FROM albaraka_ai.document"));
        out.put("published", count("SELECT count(*) FROM albaraka_ai.document WHERE lifecycle_state = 'PUBLISHED'"));
        out.put("conversations", count("SELECT count(*) FROM albaraka_ai.conversation"));
        out.put("messages", count("SELECT count(*) FROM albaraka_ai.message"));
        out.put("pendingReviews", count("SELECT count(*) FROM albaraka_ai.sharia_review WHERE state IN ('PENDING','IN_REVIEW','CHANGES_REQUESTED')"));
        out.put("guardrailEvents", count("SELECT count(*) FROM albaraka_ai.guardrail_event"));
        out.put("pendingFatwas", count("SELECT count(*) FROM albaraka_ai.fatwa_request WHERE state IN ('OPEN','ASSIGNED')"));
        out.put("feedbackNew", count("SELECT count(*) FROM albaraka_ai.feedback WHERE status = 'NEW'"));
        return out;
    }

    // ── knowledge base ────────────────────────────────────────────────────────────────────────
    @GetMapping("/documents")
    public List<Map<String, Object>> documents() { return knowledge.listDocuments(); }

    @GetMapping("/documents/{id}")
    public Map<String, Object> document(@PathVariable UUID id) { return knowledge.getDocument(id); }

    public record CreateDocumentRequest(String titleFr, String titleAr, String titleEn, String bodyText,
                                        String lang, List<String> paragraphs) {}

    @PostMapping("/documents")
    public Map<String, Object> createDocument(@RequestBody CreateDocumentRequest body,
                                              @AuthenticationPrincipal Jwt jwt) {
        String lang = body.lang() == null ? "fr-FR" : body.lang();
        List<String> paragraphs = body.paragraphs() != null && !body.paragraphs().isEmpty()
                ? body.paragraphs() : body.bodyText() == null ? List.of() : List.of(body.bodyText());
        if (body.titleFr() == null && body.titleAr() == null && body.titleEn() == null) {
            throw ApiException.badRequest("VALIDATION_ERROR", "at least one title is required");
        }
        var created = knowledge.createVersion(body.titleFr(), body.titleAr(), body.titleEn(),
                body.bodyText() == null ? "" : body.bodyText(), lang, paragraphs, jwt.getSubject());
        audit.record(jwt.getSubject(), "document.version.created", "DOCUMENT_VERSION",
                created.versionId().toString(), null);
        return map("id", created.id(), "versionId", created.versionId(), "chunks", created.chunkCount());
    }

    public record SubmitReviewRequest(String riskTier) {}

    @PostMapping("/documents/{id}/submit-review")
    public Map<String, Object> submitReview(@PathVariable UUID id, @RequestBody SubmitReviewRequest body,
                                            @AuthenticationPrincipal Jwt jwt) {
        UUID versionId = resolveVersion(id);
        RiskTier tier = RiskTier.valueOf(body == null || body.riskTier() == null ? "T2_MEDIUM" : body.riskTier());
        var created = reviews.submitDocumentVersion(versionId, labelOf(versionId), tier, jwt.getSubject());
        audit.record(jwt.getSubject(), "review.submitted", "SHARIA_REVIEW", created.reviewId().toString(), null);
        return map("id", created.reviewId(), "ref", created.ref(), "tasks", created.tasks());
    }

    @PostMapping("/documents/{id}/publish")
    public Map<String, Object> publish(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        UUID versionId = resolveVersion(id);
        List<UUID> reviewIds = db.query("SELECT sharia_review_id FROM albaraka_ai.document_version WHERE id = ?",
                (rs, i) -> rs.getObject("sharia_review_id", UUID.class), versionId);
        UUID reviewId = reviewIds.stream().filter(java.util.Objects::nonNull).findFirst().orElse(null);
        if (reviewId == null || !reviews.isApproved(reviewId)) {
            throw ApiException.conflict("GOVERNANCE.REVIEW_REQUIRED",
                    "a version must be Sharia-approved before publication");
        }
        knowledge.publish(versionId, reviewId, jwt.getSubject());
        audit.record(jwt.getSubject(), "document.published", "DOCUMENT_VERSION", versionId.toString(), null);
        return map("published", true, "versionId", versionId.toString());
    }

    // ── reviews ───────────────────────────────────────────────────────────────────────────────
    @GetMapping("/reviews")
    public List<Map<String, Object>> reviews() { return reviews.listOpen(); }

    public record DecisionRequest(String decision, String comments) {}

    @PostMapping("/reviews/{id}/decision")
    public Map<String, Object> decision(@PathVariable UUID id, @RequestBody DecisionRequest body,
                                        @AuthenticationPrincipal Jwt jwt) {
        ReviewDecision decision = ReviewDecision.valueOf(body == null || body.decision() == null
                ? "APPROVE" : body.decision());
        String role = firstRole(jwt);
        String next = reviews.decide(id, decision, body == null ? null : body.comments(), jwt.getSubject(), role);
        if ("APPROVED".equals(next)) {
            String versionId = db.query("""
                            SELECT dv.id::text FROM albaraka_ai.document_version dv
                            WHERE dv.sharia_review_id = ? LIMIT 1""",
                    (rs, i) -> rs.getString(1), id)
                    .stream().findFirst().orElse(null);
            if (versionId != null) {
                knowledge.publish(UUID.fromString(versionId), id, jwt.getSubject());
            }
        }
        audit.record(jwt.getSubject(), "review.decided", "SHARIA_REVIEW", id.toString(), null);
        return map("state", next);
    }

    // ── configuration reads (Phase 3 editing) ─────────────────────────────────────────────────
    @GetMapping("/prompts")
    public List<Map<String, Object>> prompts() {
        return db.query("""
                SELECT id, code, locale, version_no, state, change_note_fr, activated_at
                FROM albaraka_ai.prompt_version ORDER BY created_at DESC LIMIT 50""",
                (rs, i) -> map(
                        "id", rs.getObject("id", UUID.class).toString(),
                        "code", rs.getString("code"),
                        "locale", nz(rs.getString("locale")),
                        "versionNo", rs.getInt("version_no"),
                        "state", rs.getString("state"),
                        "changeNoteFr", nz(rs.getString("change_note_fr")),
                        "activatedAt", rs.getObject("activated_at") == null ? null : rs.getObject("activated_at").toString()));
    }

    @GetMapping("/models")
    public List<Map<String, Object>> models() {
        return db.query("""
                SELECT id, code, provider, model_id, state, version_no, temperature, enabled
                FROM albaraka_ai.model_config ORDER BY code, version_no""",
                (rs, i) -> map(
                        "id", rs.getObject("id", UUID.class).toString(),
                        "code", rs.getString("code"),
                        "provider", rs.getString("provider"),
                        "modelId", nz(rs.getString("model_id")),
                        "state", rs.getString("state"),
                        "versionNo", rs.getInt("version_no"),
                        "temperature", rs.getObject("temperature") == null ? null : rs.getString("temperature"),
                        "enabled", rs.getBoolean("enabled")));
    }

    @GetMapping("/retrieval-config")
    public List<Map<String, Object>> retrievalConfig() {
        return db.query("""
                SELECT id, version_no, state, channel, top_k_dense, top_k_fts, rrF_k, rerank_enabled,
                       context_token_budget, created_at
                FROM albaraka_ai.retrieval_config ORDER BY version_no DESC LIMIT 20""",
                (rs, i) -> map(
                        "id", rs.getObject("id", UUID.class).toString(),
                        "versionNo", rs.getInt("version_no"),
                        "state", rs.getString("state"),
                        "channel", rs.getString("channel"),
                        "topKDense", rs.getInt("top_k_dense"),
                        "topKFts", rs.getInt("top_k_fts"),
                        "rrfK", rs.getInt("rrf_k"),
                        "rerankEnabled", rs.getBoolean("rerank_enabled"),
                        "contextTokenBudget", rs.getInt("context_token_budget")));
    }

    @PostMapping("/retrieval-config/{id}/activate")
    public Map<String, Object> activateRetrieval(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        int n = db.update("UPDATE albaraka_ai.retrieval_config SET state = 'ACTIVE' WHERE id = ?", id);
        if (n == 0) throw ApiException.notFound("RESOURCE.NOT_FOUND", "retrieval config not found");
        audit.record(jwt.getSubject(), "retrieval.config.activated", "RETRIEVAL_CONFIG", id.toString(), null);
        return map("activated", true, "id", id.toString());
    }

    // ── audit ─────────────────────────────────────────────────────────────────────────────────
    @GetMapping("/audit")
    public List<Map<String, Object>> audit() {
        return db.query("""
                SELECT id, actor, actor_role, action, subject_type, subject_id, reason_code, prev_hash, hash, created_at
                FROM albaraka_ai.audit_event ORDER BY created_at DESC LIMIT 100""",
                (rs, i) -> map(
                        "id", rs.getObject("id", UUID.class).toString(),
                        "actor", nz(rs.getString("actor")),
                        "actorRole", nz(rs.getString("actor_role")),
                        "action", rs.getString("action"),
                        "subjectType", rs.getString("subject_type"),
                        "subjectId", rs.getObject("subject_id") == null ? null : rs.getObject("subject_id").toString(),
                        "prevHash", rs.getString("prev_hash"),
                        "hash", rs.getString("hash"),
                        "createdAt", rs.getObject("created_at").toString()));
    }

    @GetMapping("/audit/verify")
    public Map<String, Object> auditVerify() {
        try {
            Boolean ok = db.queryForObject("SELECT albaraka_ai.fn_verify_audit_chain(now() - interval '90 days', now())",
                    Boolean.class);
            return map("valid", Boolean.TRUE.equals(ok), "window", "90d");
        } catch (Exception e) {
            return map("valid", false, "error", e.getMessage());
        }
    }

    // ── feedback ──────────────────────────────────────────────────────────────────────────────
    @GetMapping("/feedback")
    public List<Map<String, Object>> feedback() {
        return db.query("""
                SELECT id, rating, comment, status, created_at
                FROM albaraka_ai.feedback ORDER BY created_at DESC LIMIT 50""",
                (rs, i) -> map(
                        "id", rs.getObject("id", UUID.class).toString(),
                        "rating", rs.getString("rating"),
                        "comment", rs.getObject("comment") == null ? "" : rs.getString("comment"),
                        "status", rs.getString("status"),
                        "createdAt", rs.getObject("created_at").toString()));
    }

    // ── helpers ───────────────────────────────────────────────────────────────────────────────
    private UUID resolveVersion(UUID id) {
        List<UUID> versions = db.query("""
                SELECT v.id FROM albaraka_ai.document_version v
                WHERE v.id = ?
                   OR (v.document_id = ? AND v.state IN ('DRAFT','IN_REVIEW','CHANGES_REQUESTED'))
                ORDER BY v.id = ? DESC, v.created_at DESC LIMIT 1""",
                (rs, i) -> rs.getObject("id", UUID.class), id, id, id);
        if (versions.isEmpty()) throw ApiException.notFound("RESOURCE.NOT_FOUND", "document/version not found");
        return versions.getFirst();
    }

    private String labelOf(UUID versionId) {
        List<String> labels = db.query("""
                SELECT coalesce(d.title_fr, d.title_ar, d.title_en, 'document') FROM albaraka_ai.document_version v
                JOIN albaraka_ai.document d ON d.id = v.document_id WHERE v.id = ? LIMIT 1""",
                (rs, i) -> rs.getString(1), versionId);
        return labels.isEmpty() ? "document" : labels.getFirst();
    }

    private static String firstRole(Jwt jwt) {
        Map<String, Object> realm = jwt.getClaimAsMap("realm_access");
        if (realm != null && realm.get("roles") instanceof List<?> l) {
            return l.stream().map(String::valueOf)
                    .filter(r -> List.of("sharia-officer", "compliance", "analyst", "platform-admin",
                            "kb-editor", "ai-engineer").contains(r))
                    .findFirst().orElse("analyst");
        }
        return "analyst";
    }

    private long count(String sql) {
        var rows = db.query(sql, (rs, i) -> rs.getLong(1));
        return rows.isEmpty() ? 0 : rows.getFirst();
    }


    /** Null-tolerant map for response rows (Map.of rejects null values). */
    static java.util.Map<String, Object> map(Object... kv) {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    private static String nz(String s) { return s == null ? "" : s; }
}
