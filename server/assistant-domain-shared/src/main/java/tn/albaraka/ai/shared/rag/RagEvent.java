package tn.albaraka.ai.shared.rag;

import java.util.List;

/** Parsed SSE frames from rag-assistant (docs/08 §8 frame contract). */
public sealed interface RagEvent {

    record Accepted(String messageId, String conversationId, String locale, String dir) implements RagEvent {}
    record Status(String stage, String label) implements RagEvent {}
    record Sources(List<RagSource> sources) implements RagEvent {}
    record Token(String token) implements RagEvent {}
    record Answer(String messageId, String answerMarkdown, String language, String dir, double confidence,
                  List<RagSource> usedSources, List<Citation> citations, List<String> caveats,
                  List<String> disclaimers, boolean needsHuman, boolean cached, String models,
                  int latencyMs, int ttftMs) implements RagEvent {}
    record Refusal(String messageId, String refusalCode, String title, String body, String locale,
                   List<RagSource> sources, String fatwaRequestRef, boolean handoffAvailable) implements RagEvent {}
    record Error(String code, String message, String refusalCode) implements RagEvent {}
    record Done(String messageId, int tokensIn, int tokensOut, int latencyMs) implements RagEvent {}

    record RagSource(String documentId, String documentTitle, String url, String excerpt,
                     String locale, Double score, String validFrom, String validUntil) {}

    record Citation(String documentId, String title, String url, Double score, String locale) {}
}
