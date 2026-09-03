package tn.albaraka.ai.governance;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tn.albaraka.ai.shared.ReviewDecision;
import tn.albaraka.ai.shared.ReviewState;
import tn.albaraka.ai.shared.RiskTier;
import tn.albaraka.ai.shared.error.ApiException;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Two-eyes Sharia review workflow (ADR-006). The no-self-approval rule and the T3
 * quorum are also enforced by schema triggers — this service is the authored API on top.
 */
@Service
public class ShariaReviewService {

    /** Approver roles per tier, matching the backoffice review UI and the Keycloak realm roles. */
    private static final Map<String, List<String>> TASKS = Map.of(
            RiskTier.T1_LOW.name(), List.of("sharia-officer"),
            RiskTier.T2_MEDIUM.name(), List.of("sharia-officer", "analyst"),
            RiskTier.T3_HIGH.name(), List.of("sharia-officer", "compliance"));

    private final JdbcTemplate db;

    public ShariaReviewService(JdbcTemplate db) { this.db = db; }

    @Transactional
    public record ReviewCreated(UUID reviewId, String ref, List<String> tasks) {}

    @Transactional
    public ReviewCreated submitDocumentVersion(UUID versionId, String label, RiskTier riskTier, String actor) {
        String ref = "RV-" + System.currentTimeMillis() / 1000 + "-" + UUID.randomUUID().toString().substring(0, 6);
        UUID reviewId = UUID.randomUUID();
        db.update("""
                INSERT INTO albaraka_ai.sharia_review
                  (id, ref, subject_type, subject_id, subject_label, risk_tier, state, submitted_by, due_at)
                VALUES (?, ?, 'DOCUMENT_VERSION', ?, ?, ?, 'IN_REVIEW', ?, now() + interval '7 days')
                """, reviewId, ref, versionId, label, riskTier.name(), actor);
        for (String role : TASKS.getOrDefault(riskTier.name(), List.of("sharia-officer"))) {
            db.update("INSERT INTO albaraka_ai.review_task (id, review_id, assignee_role) VALUES (?, ?, ?)",
                    UUID.randomUUID(), reviewId, role);
        }
        db.update("UPDATE albaraka_ai.document_version SET state = 'IN_REVIEW', sharia_review_id = ? WHERE id = ?",
                reviewId, versionId);
        db.update("UPDATE albaraka_ai.document SET lifecycle_state = 'IN_REVIEW' " +
                        "WHERE id = (SELECT document_id FROM albaraka_ai.document_version WHERE id = ?)",
                versionId);
        return new ReviewCreated(reviewId, ref, TASKS.getOrDefault(riskTier.name(), List.of("sharia-officer")));
    }

    @Transactional
    public String decide(UUID reviewId, ReviewDecision decision, String comments, String actor, String actorRole) {
        var row = db.query("SELECT state, submitted_by FROM albaraka_ai.sharia_review WHERE id = ?",
                (rs, i) -> new Object[]{rs.getString("state"), rs.getString("submitted_by")}, reviewId);
        if (row.isEmpty()) throw ApiException.notFound("RESOURCE.NOT_FOUND", "review not found");
        String state = (String) row.getFirst()[0];
        String submitter = (String) row.getFirst()[1];
        if (!List.of("PENDING", "IN_REVIEW", "CHANGES_REQUESTED").contains(state)) {
            throw ApiException.conflict("STATE.TRANSITION", "review is not actionable in state " + state);
        }
        if (actor.equals(submitter)) {
            throw ApiException.unprocessable("GOVERNANCE.SELF_APPROVAL", "a submitter cannot approve their own submission");
        }
        var tasks = db.query("SELECT id, assignee_role, decision FROM albaraka_ai.review_task " +
                        "WHERE review_id = ? AND assignee_role = ? AND decided_at IS NULL ORDER BY created_at LIMIT 1",
                (rs, i) -> new Object[]{rs.getObject("id", UUID.class), rs.getString("assignee_role"),
                        rs.getString("decision")}, reviewId, actorRole);
        if (tasks.isEmpty()) {
            throw ApiException.conflict("CONFLICT", "no pending task for role " + actorRole);
        }
        UUID taskId = (UUID) tasks.getFirst()[0];
        db.update("""
                UPDATE albaraka_ai.review_task SET decision = ?, comments = ?, assignee_id = ?, decided_at = now()
                WHERE id = ?
                """, decision.name(), comments, actor, taskId);

        long pending = count("SELECT count(*) FROM albaraka_ai.review_task " +
                "WHERE review_id = ? AND decided_at IS NULL", reviewId);
        String nextState;
        if (decision == ReviewDecision.APPROVE) {
            nextState = pending == 0 ? ReviewState.APPROVED.name() : state;
        } else {
            nextState = decision == ReviewDecision.REJECT ? ReviewState.REJECTED.name() : ReviewState.CHANGES_REQUESTED.name();
            db.update("UPDATE albaraka_ai.review_task SET decision = ?, decided_at = now() " +
                            "WHERE review_id = ? AND decided_at IS NULL",
                    decision.name(), reviewId);
        }
        db.update("""
                UPDATE albaraka_ai.sharia_review SET state = ?, decided_at = now(), decision_by = ?
                WHERE id = ?
                """, nextState, actor, reviewId);
        return nextState;
    }

    public List<Map<String, Object>> listOpen() {
        return db.query("""
                SELECT r.id, r.ref, r.subject_label, r.risk_tier, r.state, r.submitted_by, r.due_at,
                       (SELECT count(*) FROM albaraka_ai.review_task t WHERE t.review_id = r.id AND t.decided_at IS NULL) AS pending
                FROM albaraka_ai.sharia_review r
                WHERE r.state IN ('PENDING','IN_REVIEW','CHANGES_REQUESTED')
                ORDER BY r.due_at
                """, (rs, i) -> map(
                "id", rs.getObject("id", UUID.class).toString(),
                "ref", rs.getString("ref"),
                "subjectLabel", rs.getString("subject_label"),
                "riskTier", rs.getString("risk_tier"),
                "state", rs.getString("state"),
                "submittedBy", rs.getString("submitted_by"),
                "dueAt", rs.getObject("due_at", OffsetDateTime.class).toString(),
                "pendingTasks", rs.getInt("pending")));
    }

    public boolean isApproved(UUID reviewId) {
        return count("SELECT count(*) FROM albaraka_ai.sharia_review WHERE id = ? AND state = 'APPROVED'", reviewId) == 1;
    }


    /** Null-tolerant map for response rows (Map.of rejects null values). */
    static java.util.Map<String, Object> map(Object... kv) {
        java.util.Map<String, Object> m = new java.util.LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(String.valueOf(kv[i]), kv[i + 1]);
        return m;
    }

    private long count(String sql, Object... args) {
        var rows = db.query(sql, (rs, i) -> rs.getLong(1), args);
        return rows.isEmpty() ? 0 : rows.getFirst();
    }
}
