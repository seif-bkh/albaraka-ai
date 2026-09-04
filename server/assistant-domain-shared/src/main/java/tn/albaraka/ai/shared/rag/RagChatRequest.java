package tn.albaraka.ai.shared.rag;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * POST /v1/rag/chat body — internal contract docs/08 §8.2 + docs/04 §2 (X-RAG-Contract: 1).
 * The wire shape is snake_case to match the pydantic ChatRequest in rag-assistant:
 * {text, context:{conversation_id, message_id, locale, channel, audience,
 * max_classification, retrieval_config, prompt, model, history}}.
 *
 * The context is carried as a map because this module has no Jackson on its classpath (annotations
 * are unavailable here); wire keys live in this one factory so the contract stays reviewable.
 * prompt/model/history are omitted when null — the pydantic side applies its defaults.
 */
public record RagChatRequest(
        String text,
        Map<String, Object> context
) {
    public static RagChatRequest chat(String text, UUID conversationId, UUID messageId, String locale,
                                      String channel, String audience, String maxClassification,
                                      Map<String, Object> retrievalConfig) {
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("conversation_id", conversationId);
        ctx.put("message_id", messageId);
        ctx.put("locale", locale);
        ctx.put("channel", channel);
        ctx.put("audience", audience);
        ctx.put("max_classification", maxClassification);
        ctx.put("retrieval_config", retrievalConfig == null ? Map.of() : retrievalConfig);
        return new RagChatRequest(text, ctx);
    }
}
