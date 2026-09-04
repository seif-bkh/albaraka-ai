package tn.albaraka.ai.shared.rag;

import java.util.List;

/**
 * Parsed SSE frames from rag-assistant (docs/08 §8.3 — the internal frame vocabulary is identical
 * to the public grammar of docs/08 §3.1, so the API forwards without re-marshalling). Record
 * component names ARE the wire names on the public side (the response is never annotated):
 * Token exposes {@code delta}, Sources exposes {@code citations}, Citation exposes the documented
 * field set (documentTitle, not title).
 */
public sealed interface RagEvent {

    record Accepted(String messageId, String conversationId, String locale, String dir) implements RagEvent {}
    record Status(String stage, String label) implements RagEvent {}
    record Sources(List<Citation> citations) implements RagEvent {}
    record Token(String delta) implements RagEvent {}
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

    record Citation(String id, String chunkId, String documentId, String documentTitle,
                    String documentTitleLocale, String collectionCode, List<String> headingPath,
                    String excerpt, String url, String locale, String validFrom, String validUntil,
                    Double score) {}
}
