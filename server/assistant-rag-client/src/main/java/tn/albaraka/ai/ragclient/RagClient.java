package tn.albaraka.ai.ragclient;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import tn.albaraka.ai.shared.config.AlbarakaProperties;
import tn.albaraka.ai.shared.rag.RagChatRequest;
import tn.albaraka.ai.shared.rag.RagEvent;
import tn.albaraka.ai.shared.rag.RagIngestRequest;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Client for the internal RAG contract (docs/08 §8). The ONLY caller of rag-assistant;
 * egress to model providers lives behind this boundary (ADR-009).
 */
@Component
public class RagClient {

    private static final Logger log = LoggerFactory.getLogger(RagClient.class);

    private static final ParameterizedTypeReference<ServerSentEvent<String>> SSE =
            new ParameterizedTypeReference<>() {};

    private final WebClient web;
    private final ObjectMapper json;
    private final AlbarakaProperties.Rag cfg;

    public RagClient(WebClient.Builder builder, ObjectMapper json, AlbarakaProperties props) {
        this.cfg = props.rag();
        this.json = json;
        this.web = builder.baseUrl(cfg.baseUrl()).build();
    }

    public Mono<Map<String, Object>> health() {
        return web.get().uri("/v1/rag/health")
                .header("X-RAG-Contract", String.valueOf(cfg.contract()))
                .retrieve().bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {});
    }

    public Flux<RagEvent> streamChat(RagChatRequest request) {
        return web.post().uri("/v1/rag/chat")
                .accept(MediaType.TEXT_EVENT_STREAM)
                .headers(h -> {
                    h.set("X-RAG-Contract", String.valueOf(cfg.contract()));
                    h.setBearerAuth(cfg.serviceToken());
                })
                .bodyValue(request)
                .retrieve().bodyToFlux(SSE)
                .mapNotNull(this::parse)
                .doOnComplete(() -> log.debug("rag stream completed normally"))
                .doOnError(err -> log.warn("rag stream errored: {}", err.toString()));
    }

    public Mono<Void> ingest(RagIngestRequest request) {
        return web.post().uri("/v1/rag/ingest")
                .headers(h -> {
                    h.set("X-RAG-Contract", String.valueOf(cfg.contract()));
                    h.setBearerAuth(cfg.serviceToken());
                })
                .bodyValue(request)
                .retrieve().bodyToMono(Void.class)
                .onErrorResume(e -> Mono.empty()); // KB publication must not fail on a RAG hiccup
    }

    private RagEvent parse(ServerSentEvent<String> sse) {
        if (sse.data() == null || sse.event() == null) {
            log.debug("rag frame skipped (missing {}): {}", sse.event() == null ? "event" : "data",
                    sse.data() == null ? sse.event() : sse.data().substring(0, Math.min(80, sse.data().length())));
            return null;
        }
        log.debug("rag frame received: {} ({} bytes)", sse.event(), sse.data().length());
        try {
            JsonNode n = json.readTree(sse.data());
            return switch (sse.event()) {
                case "accepted" -> new RagEvent.Accepted(text(n, "messageId"), text(n, "conversationId"),
                        text(n, "locale"), text(n, "dir"));
                case "status" -> new RagEvent.Status(text(n, "stage"), text(n, "label"));
                case "sources" -> new RagEvent.Sources(citations(n.path("citations")));
                case "token" -> new RagEvent.Token(text(n, "delta"));
                case "answer" -> new RagEvent.Answer(text(n, "messageId"), text(n, "answerMarkdown"),
                        text(n, "language"), text(n, "dir"), n.path("confidence").asDouble(1.0),
                        sources(n.path("usedSources")), citations(n.path("citations")),
                        strings(n.path("caveats")), strings(n.path("disclaimers")),
                        n.path("needsHuman").asBoolean(false), n.path("cached").asBoolean(false),
                        text(n, "models"), n.path("latencyMs").asInt(0), n.path("ttftMs").asInt(0));
                case "refusal" -> new RagEvent.Refusal(text(n, "messageId"), text(n, "refusalCode"),
                        text(n, "title"), text(n, "body"), text(n, "locale"),
                        sources(n.path("sources")), text(n, "fatwaRequestRef"),
                        n.path("handoffAvailable").asBoolean(true));
                case "error" -> new RagEvent.Error(text(n, "code"), text(n, "message"), text(n, "refusalCode"));
                case "done" -> new RagEvent.Done(text(n, "messageId"), n.path("tokensIn").asInt(0),
                        n.path("tokensOut").asInt(0), n.path("latencyMs").asInt(0));
                default -> null;
            };
        } catch (Exception e) {
            log.warn("rag frame [{}] failed to parse: {}", sse.event(), e.toString());
            return new RagEvent.Error("RAG_MALFORMED_FRAME", e.getMessage(), null);
        }
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n.path(field);
        return v.isNull() || v.isMissingNode() ? null : v.asText();
    }

    private static List<String> strings(JsonNode arr) {
        List<String> out = new ArrayList<>();
        if (arr.isArray()) arr.forEach(x -> out.add(x.asText()));
        return out;
    }

    private static List<RagEvent.RagSource> sources(JsonNode arr) {
        List<RagEvent.RagSource> out = new ArrayList<>();
        if (arr.isArray()) arr.forEach(x -> out.add(new RagEvent.RagSource(
                text(x, "documentId"), text(x, "documentTitle"), text(x, "url"),
                text(x, "excerpt"), text(x, "locale"),
                x.path("score").isNumber() ? x.path("score").asDouble() : null,
                text(x, "validFrom"), text(x, "validUntil"))));
        return out;
    }

    private static List<RagEvent.Citation> citations(JsonNode arr) {
        List<RagEvent.Citation> out = new ArrayList<>();
        if (arr.isArray()) arr.forEach(x -> out.add(new RagEvent.Citation(
                text(x, "id"), text(x, "chunkId"), text(x, "documentId"), text(x, "documentTitle"),
                text(x, "documentTitleLocale"), text(x, "collectionCode"), strings(x.path("headingPath")),
                text(x, "excerpt"), text(x, "url"), text(x, "locale"),
                text(x, "validFrom"), text(x, "validUntil"),
                x.path("score").isNumber() ? x.path("score").asDouble() : null)));
        return out;
    }
}
