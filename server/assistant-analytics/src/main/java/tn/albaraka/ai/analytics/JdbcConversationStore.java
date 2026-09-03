package tn.albaraka.ai.analytics;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import tn.albaraka.ai.shared.Locales;
import tn.albaraka.ai.shared.rag.RagEvent;

import java.util.UUID;

/**
 * Conversation / message / trace persistence (ADR-009: analytics owns the conversation record).
 * SQL mirrors the legacy node-parity implementation; the schema is specs/db/schema.sql.
 */
@Repository
public class JdbcConversationStore {

    private final JdbcTemplate db;

    public JdbcConversationStore(JdbcTemplate db) { this.db = db; }

    public record ConversationRef(UUID id, String locale) {}

    public ConversationRef findOrCreateConversation(String deviceId, String locale) {
        if (deviceId != null && !deviceId.isBlank()) {
            var rows = db.query("SELECT id, locale FROM albaraka_ai.conversation " +
                            "WHERE device_id = ? AND state = 'ACTIVE' ORDER BY last_message_at DESC LIMIT 1",
                    (rs, i) -> new ConversationRef(rs.getObject("id", UUID.class), rs.getString("locale")),
                    deviceId);
            if (!rows.isEmpty()) return rows.getFirst();
        }
        UUID id = UUID.randomUUID();
        db.update("INSERT INTO albaraka_ai.conversation (id, channel, device_id, locale, state, persist_conversation) " +
                        "VALUES (?, 'WEB_APP', ?, ?, 'ACTIVE', true)",
                id, deviceId != null ? deviceId : UUID.randomUUID().toString(), locale);
        return new ConversationRef(id, locale);
    }

    public int nextOrdinal(UUID conversationId) {
        var rows = db.query("SELECT coalesce(max(ordinal),0)+1 AS n FROM albaraka_ai.message WHERE conversation_id = ?",
                (rs, i) -> rs.getInt("n"), conversationId);
        return rows.isEmpty() ? 1 : rows.getFirst();
    }

    public UUID saveUserMessage(UUID conversationId, int ordinal, String text, String locale, String dir, String idempotencyKey) {
        UUID id = UUID.randomUUID();
        db.update("""
                INSERT INTO albaraka_ai.message
                  (id, conversation_id, ordinal, role, content_raw, content_rendered, locale, dir,
                   idempotency_key, created_at)
                VALUES (?, ?, ?, 'USER', ?, ?, ?, ?, ?, now())
                """, id, conversationId, ordinal, text, text, locale, dir,
                isUuid(idempotencyKey) ? UUID.fromString(idempotencyKey) : null);
        db.update("UPDATE albaraka_ai.conversation SET turn_count = turn_count + 1, last_message_at = now() WHERE id = ?", conversationId);
        return id;
    }

    public UUID saveAnswer(UUID conversationId, int ordinal, RagEvent.Answer e, String intent, String citationsJson) {
        UUID id = UUID.randomUUID();
        db.update("""
                INSERT INTO albaraka_ai.message
                  (id, conversation_id, ordinal, role, content_raw, content_rendered, locale, dir,
                   detected_intent, confidence, citations, needs_human, cached, degradation_step,
                   ttft_ms, latency_ms, tokens_in, tokens_out, created_at)
                VALUES (?, ?, ?, 'ASSISTANT', ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, 1, ?, ?, ?, ?, now())
                """, id, conversationId, ordinal, e.answerMarkdown(), e.answerMarkdown(), e.language(), e.dir(),
                intent, e.confidence(), citationsJson, e.needsHuman(), e.cached(), e.ttftMs(), e.latencyMs(),
                0, 0);
        return id;
    }

    public UUID saveRefusal(UUID conversationId, int ordinal, RagEvent.Refusal e, String intent, String citationsJson) {
        UUID id = UUID.randomUUID();
        db.update("""
                INSERT INTO albaraka_ai.message
                  (id, conversation_id, ordinal, role, content_raw, content_rendered, locale, dir,
                   detected_intent, no_answer, no_answer_reason, refusal_code, citations,
                   degradation_step, tokens_in, tokens_out, created_at)
                VALUES (?, ?, ?, 'ASSISTANT', ?, ?, ?, ?, ?, true, ?, ?, ?::jsonb, 1, ?, ?, now())
                """, id, conversationId, ordinal, e.title() + "\n\n" + e.body(), e.title() + "\n\n" + e.body(),
                e.locale(), Locales.dirOf(e.locale()), intent, "refused", e.refusalCode(),
                citationsJson, 0, 0);
        return id;
    }

    public void saveGuardrailEvent(UUID messageId, String policyCode, String decision, String severity,
                                   String violationCode, String evidence, String refusalCode, String stage) {
        db.update("""
                INSERT INTO albaraka_ai.guardrail_event
                  (id, message_id, policy_code, policy_version, decision, severity, violation_code,
                   evidence, refusal_code, stage, created_at)
                VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, now())
                """, UUID.randomUUID(), messageId, policyCode, decision, severity, violationCode,
                evidence, refusalCode, stage);
    }

    public void saveFatwaRequest(String ref, UUID conversationId, UUID messageId, String questionFr) {
        db.update("""
                INSERT INTO albaraka_ai.fatwa_request
                  (id, ref, origin, conversation_id, message_id, question_fr, question_locale, state, sla_due_at)
                VALUES (?, ?, 'CHAT', ?, ?, ?, 'fr-FR', 'OPEN', now() + interval '5 days')
                ON CONFLICT (ref) DO NOTHING
                """, UUID.randomUUID(), ref, conversationId, messageId, questionFr);
    }

    public void saveRetrievalTrace(UUID messageId, String intent, String contextJson, double bestScore, String outcome) {
        db.update("""
                INSERT INTO albaraka_ai.retrieval_trace
                  (id, message_id, message_created_at, intent, assembled_context, best_score, outcome, created_at)
                VALUES (?, ?, now(), ?, ?::jsonb, ?, ?, now())
                """, UUID.randomUUID(), messageId, intent, contextJson, bestScore, outcome);
    }

    public void saveLlmCall(UUID messageId, String purpose, String provider, String modelId,
                            int tokensIn, int tokensOut, int latencyMs, double costUsd) {
        db.update("""
                INSERT INTO albaraka_ai.llm_call_log
                  (id, message_id, purpose, provider, model_id, status, tokens_in, tokens_out, latency_ms, cost_usd, created_at)
                VALUES (?, ?, ?, ?, ?, 'OK', ?, ?, ?, ?, now())
                """, UUID.randomUUID(), messageId, purpose, provider, modelId, tokensIn, tokensOut, latencyMs, costUsd);
    }

    private static boolean isUuid(String s) {
        if (s == null) return false;
        try { UUID.fromString(s); return true; } catch (IllegalArgumentException e) { return false; }
    }
}
