package tn.albaraka.ai.audit;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.UUID;

/**
 * Append-only audit journal (specs/db/schema.sql). The hash chain and the UPDATE/DELETE
 * rejection are enforced by database triggers; this store only inserts.
 */
@Repository
public class AuditEventStore {

    private record AuditActor(String actor, String role) {}

    private final JdbcTemplate db;

    public AuditEventStore(JdbcTemplate db) { this.db = db; }

    public void record(String actor, String actorRole, String action, String subjectType, String subjectId,
                       String afterJson, String reasonCode) {
        db.update("""
                INSERT INTO albaraka_ai.audit_event
                  (id, actor, actor_role, action, subject_type, subject_id, after_json, reason_code, prev_hash, hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, 'pending', 'pending', now())
                """, UUID.randomUUID(), actor, actorRole, action, subjectType, subjectId, afterJson, reasonCode);
    }

    public void record(String actor, String action, String subjectType, String subjectId, String afterJson) {
        record(actor, null, action, subjectType, subjectId, afterJson, null);
    }
}
