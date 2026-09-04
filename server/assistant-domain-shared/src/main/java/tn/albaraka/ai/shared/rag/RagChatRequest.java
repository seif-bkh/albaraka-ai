package tn.albaraka.ai.shared.rag;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * POST /v1/rag/chat body — internal contract docs/08 §8.2 + docs/04 §2 (X-RAG-Contract: 1).
 * Wire names are snake_case, the pydantic models on the Python side; Jackson 3 keeps its
 * annotations in com.fasterxml (only core/databind moved to tools.jackson). Optional context
 * fields (retrieval_config/prompt/model/history) are omitted when null by the global
 * non_null inclusion, matching the pydantic defaults.
 */
public record RagChatRequest(
        String text,
        Context context
) {
    public record Context(
            @JsonProperty("conversation_id") UUID conversationId,
            @JsonProperty("message_id") UUID messageId,
            String locale,
            String channel,
            String audience,
            @JsonProperty("max_classification") String maxClassification,
            @JsonProperty("retrieval_config") Map<String, Object> retrievalConfig,
            Map<String, Object> prompt,
            Map<String, Object> model,
            List<HistoryTurn> history
    ) {
    }

    public record HistoryTurn(String role, String content) {}
}
