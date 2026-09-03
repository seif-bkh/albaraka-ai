package tn.albaraka.ai.shared.rag;

import java.util.List;

/** POST /v1/rag/chat body (docs/08 §8). */
public record RagChatRequest(
        String message,
        String locale,
        String clientId,
        String conversationId,
        boolean stream,
        List<HistoryTurn> history
) {
    public record HistoryTurn(String role, String content) {}
}
