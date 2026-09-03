package tn.albaraka.ai.shared.rag;

import java.util.List;

/** POST /v1/rag/ingest body — KB publication hook (docs/08 §8). */
public record RagIngestRequest(
        String collectionCode,
        String documentId,
        String title,
        String locale,
        List<RagChunk> chunks
) {
    public record RagChunk(String id, int ordinal, String lang, String content, List<String> headingPath) {}
}
