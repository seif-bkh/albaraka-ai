package tn.albaraka.ai.api;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import tn.albaraka.ai.analytics.JdbcConversationStore;
import tn.albaraka.ai.ragclient.RagClient;
import tn.albaraka.ai.shared.Locales;
import tn.albaraka.ai.shared.rag.RagChatRequest;
import tn.albaraka.ai.shared.rag.RagEvent;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Anonymous chat SSE endpoint (docs/08 §4). Orchestration: persist the user turn, stream the
 * rag-assistant frames back verbatim (renamed to the wire event names), persist assistant
 * answers/refusals/traces/usage in parallel.
 */
@RestController
@RequestMapping("/api/v1/chat")
public class ChatController {

    private static final Logger log = LoggerFactory.getLogger(ChatController.class);

    private final RagClient rag;
    private final JdbcConversationStore store;
    private final ObjectMapper json;

    public ChatController(RagClient rag, JdbcConversationStore store, ObjectMapper json) {
        this.rag = rag; this.store = store; this.json = json;
    }

    public record ChatRequest(String text, String locale, String clientId, String deviceId, String conversationId) {}

    private record ChatContext(UUID conversationId, UUID userMessageId, int ordinal) {}

    @PostMapping(produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> chat(@RequestBody ChatRequest req) {
        String locale = req.locale() == null ? "fr-FR" : req.locale();
        Mono<ChatContext> ctx = Mono.fromCallable(() -> {
            var conv = store.findOrCreateConversation(req.deviceId(), locale);
            int ord = store.nextOrdinal(conv.id());
            UUID userMsg = store.saveUserMessage(conv.id(), ord, req.text(), locale,
                    Locales.dirOf(locale), req.clientId());
            return new ChatContext(conv.id(), userMsg, ord);
        }).subscribeOn(Schedulers.boundedElastic());

        return ctx.flatMapMany(c -> rag.streamChat(RagChatRequest.chat(
                        req.text(), c.conversationId(), c.userMessageId(), locale,
                        "WEB_APP", "PUBLIC", "PUBLIC", Map.of()))
                .concatMap(e -> persistAndSse(c, e))
                .subscribeOn(Schedulers.boundedElastic()));
    }

    private Mono<ServerSentEvent<String>> persistAndSse(ChatContext c, RagEvent e) {
        return Mono.fromCallable(() -> {
                    switch (e) {
                        case RagEvent.Answer a -> {
                            UUID assistant = store.saveAnswer(c.conversationId(), c.ordinal() + 1, a,
                                    "PRODUCT_QUESTION", write(a.citations()));
                            store.saveLlmCall(assistant, "CHAT_PRIMARY", "MOCK", modelOf(a), 0, 0,
                                    a.latencyMs(), 0.0);
                        }
                        case RagEvent.Refusal r -> {
                            UUID assistant = store.saveRefusal(c.conversationId(), c.ordinal() + 1, r,
                                    "OUT_OF_SCOPE", write(r.sources()));
                            store.saveGuardrailEvent(assistant, policyOf(r), "BLOCK",
                                    "HIGH", r.refusalCode(), r.title(), r.refusalCode(), "OUTPUT");
                            if (r.fatwaRequestRef() != null) {
                                store.saveFatwaRequest(r.fatwaRequestRef(), c.conversationId(), assistant,
                                        null);
                            }
                        }
                        case RagEvent.Sources s -> store.saveRetrievalTrace(c.userMessageId(), "PRODUCT_QUESTION",
                                write(s.citations()), bestScore(s), "ANSWERED");
                        case RagEvent.Done d -> { /* usage is attributed on the answer frame */ }
                        default -> { }
                    }
                    return ServerSentEvent.<String>builder()
                            .event(nameOf(e))
                            .data(dataOf(e))
                            .build();
                }).doOnNext(sse -> log.debug("chat frame [{}] forwarded ({})", sse.event(),
                        sse.data() == null ? 0 : sse.data().length()))
                .doOnError(err -> log.warn("chat frame [{}] persistence/emission failed: {}",
                        nameOf(e), err.toString()))
                .subscribeOn(Schedulers.boundedElastic());
    }

    private static String nameOf(RagEvent e) {
        return switch (e) {
            case RagEvent.Accepted ignored -> "accepted";
            case RagEvent.Status ignored -> "status";
            case RagEvent.Sources ignored -> "sources";
            case RagEvent.Token ignored -> "token";
            case RagEvent.Answer ignored -> "answer";
            case RagEvent.Refusal ignored -> "refusal";
            case RagEvent.Error ignored -> "error";
            case RagEvent.Done ignored -> "done";
        };
    }

    private String write(Object o) {
        try { return json.writeValueAsString(o); } catch (Exception e) { return "{}"; }
    }

    /**
     * The answer frame's public payload (docs/08 §3.1) carries {@code models} as an OBJECT
     * ({@code {"chat": ..., "reranker": ..., "degradationStep": ...}}). RagClient stores it as
     * JSON text (Jackson 3 refuses to coerce an ObjectNode to String), so it is re-parsed here
     * to keep the documented wire shape on the public side.
     */
    private String dataOf(RagEvent e) {
        if (e instanceof RagEvent.Answer a) {
            Map<String, Object> wire = new LinkedHashMap<>();
            wire.put("messageId", a.messageId());
            wire.put("answerMarkdown", a.answerMarkdown());
            wire.put("language", a.language());
            wire.put("dir", a.dir());
            wire.put("confidence", a.confidence());
            wire.put("usedSources", a.usedSources());
            wire.put("citations", a.citations());
            wire.put("caveats", a.caveats());
            wire.put("disclaimers", a.disclaimers());
            wire.put("needsHuman", a.needsHuman());
            wire.put("cached", a.cached());
            wire.put("models", modelsNode(a.models()));
            wire.put("latencyMs", a.latencyMs());
            wire.put("ttftMs", a.ttftMs());
            return write(wire);
        }
        return write(e);
    }

    private JsonNode modelsNode(String models) {
        if (models == null || models.isBlank()) return null;
        try { return json.readTree(models); } catch (Exception ex) { return null; }
    }

    private static double bestScore(RagEvent.Sources s) {
        return s.citations().stream().mapToDouble(x -> x.score() == null ? 0.0 : x.score()).max().orElse(0.0);
    }

    private String modelOf(RagEvent.Answer a) {
        if (a.models() == null || a.models().isBlank()) return "undisclosed";
        try {
            JsonNode chat = json.readTree(a.models()).path("chat");
            return chat.isTextual() ? chat.asText() : a.models();
        } catch (Exception ex) {
            return a.models();
        }
    }

    private static String policyOf(RagEvent.Refusal r) {
        return switch (r.refusalCode() == null ? "" : r.refusalCode()) {
            case "REF-03" -> "NO_FATWA";
            case "REF-04" -> "PII_EGRESS";
            case "REF-05" -> "RATE_LIMIT";
            default -> "PROHIBITED_TOPICS";
        };
    }
}
