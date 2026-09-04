package tn.albaraka.ai.api;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;
import tn.albaraka.ai.analytics.JdbcConversationStore;
import tn.albaraka.ai.shared.Locales;
import tn.albaraka.ai.shared.error.ApiException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Frontoffice API — the documented surface of specs/openapi.yaml (docs/08 §3), implemented for the
 * compose demo: bootstrap config, explicit conversation creation (the UUID is the anonymous
 * capability), the SSE send-message stream, and answer feedback.
 */
@RestController
@RequestMapping("/api/v1/assistant")
public class FrontofficeController {

    private static final Set<String> CHANNELS = Set.of("WEB_APP", "WIDGET", "AGENT_DESK", "API");
    private static final Set<String> SUPPORTED_LOCALES = Set.of("fr-FR", "ar-TN", "en-GB");
    private static final int MAX_TURNS = 20;

    private final JdbcConversationStore store;
    private final ChatStreamer streamer;
    private final ObjectMapper json;

    public FrontofficeController(JdbcConversationStore store, ChatStreamer streamer, ObjectMapper json) {
        this.store = store;
        this.streamer = streamer;
        this.json = json;
    }

    public record CreateConversationRequest(String channel, String locale, String pageContext) {}

    public record SendMessageRequest(String text, String locale, String clientId) {}

    public record FeedbackRequest(String rating, String comment, Boolean contactOptIn, String contact) {}

    @GetMapping("/config")
    public Mono<Map<String, Object>> config() {
        return Mono.fromCallable(() -> {
            JsonNode identity = identity();
            String name = textOf(identity, "assistant_name", "Al-Mouchir");
            String bank = textOf(identity, "bank_name", "Al Baraka Bank Tunisia");
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("assistantName", name);
            out.put("enabled", true);
            out.put("mode", "ON");
            out.put("locales", List.of("fr-FR", "ar-TN", "en-GB"));
            out.put("defaultLocale", "fr-FR");
            // DB-driven via admin content ops (assistant_config); nothing is seeded in the demo, so
            // the array is empty until an admin adds entries.
            out.put("suggestedQuestions", List.of());
            out.put("disclaimers", List.of());
            out.put("piiWarning", Map.of(
                    "fr", "Ne communiquez jamais vos identifiants bancaires ni vos données personnelles sensibles dans le chat.",
                    "ar", "لا تشارك أبدًا بياناتك المصرفية أو معلوماتك الشخصية الحساسة في المحادثة.",
                    "en", "Never share your banking credentials or sensitive personal data in the chat."));
            out.put("featureFlags", Map.of(
                    "voiceInput", false, "widgetEnabled", true, "handoffEnabled", false,
                    "fatwaRequestEnabled", false, "publicKbSearch", true));
            out.put("limits", Map.of(
                    "maxMessageChars", 4000, "maxTurnsPerConversation", MAX_TURNS, "messagesPerMinute", 60));
            out.put("support", Map.of(
                    "phone", "+216 71 340 733",
                    "hoursFr", "Lun–Ven 8h30–17h00",
                    "hoursAr", "الاثنين–الجمعة 8:30–17:00",
                    "hoursEn", "Mon–Fri 8:30–17:00"));
            // frontoffice extensions — the OpenAPI schema is open (no additionalProperties: false),
            // and the SPA uses them for the identity line and the demo badge.
            out.put("identity", Map.of(
                    "name", name, "nameAr", textOf(identity, "assistant_name_ar", "المشير"), "bank", bank));
            out.put("demoKb", Map.of("demo", true));
            return out;
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping("/conversations")
    @ResponseStatus(HttpStatus.CREATED)
    public Mono<Map<String, Object>> createConversation(@RequestBody CreateConversationRequest req) {
        String channel = req.channel() == null ? "WEB_APP" : req.channel();
        String locale = req.locale() == null ? "fr-FR" : req.locale();
        if (!CHANNELS.contains(channel)) {
            return Mono.error(ApiException.badRequest("VALIDATION_ERROR", "unsupported channel: " + channel));
        }
        if (!SUPPORTED_LOCALES.contains(locale)) {
            return Mono.error(ApiException.badRequest("VALIDATION_ERROR", "unsupported locale: " + locale));
        }
        return Mono.fromCallable(() -> {
            var info = store.createConversation(channel, locale, req.pageContext());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", info.id());
            out.put("channel", channel);
            out.put("locale", locale);
            out.put("dir", Locales.dirOf(locale));
            out.put("state", "ACTIVE");
            out.put("startedAt", info.startedAt().toString());
            out.put("limits", Map.of("maxTurns", MAX_TURNS,
                    "remainingTurns", Math.max(0, MAX_TURNS - info.turnCount())));
            return out;
        }).subscribeOn(Schedulers.boundedElastic());
    }

    @PostMapping(value = "/conversations/{conversationId}/messages", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> sendMessage(@PathVariable UUID conversationId,
                                                     @RequestBody SendMessageRequest req) {
        String text = req.text() == null ? "" : req.text().trim();
        if (text.isEmpty()) {
            return Flux.error(ApiException.badRequest("VALIDATION_ERROR", "text is required"));
        }
        String locale = req.locale() == null ? "fr-FR" : req.locale();
        if (!SUPPORTED_LOCALES.contains(locale)) {
            return Flux.error(ApiException.badRequest("VALIDATION_ERROR", "unsupported locale: " + locale));
        }
        Mono<ChatStreamer.ChatContext> ctx = Mono.fromCallable(() -> {
            var info = store.requireConversation(conversationId);
            int ord = store.nextOrdinal(conversationId);
            UUID userMsg = store.saveUserMessage(conversationId, ord, text, locale,
                    Locales.dirOf(locale), req.clientId());
            return new ChatStreamer.ChatContext(conversationId, userMsg, ord);
        }).subscribeOn(Schedulers.boundedElastic());
        return ctx.flatMapMany(c -> streamer.stream(c, text, locale));
    }

    @PostMapping("/messages/{messageId}/feedback")
    @ResponseStatus(HttpStatus.CREATED)
    public Mono<Map<String, Object>> feedback(@PathVariable UUID messageId,
                                              @RequestBody FeedbackRequest req) {
        if (req.rating() == null || req.rating().isBlank()) {
            return Mono.error(ApiException.badRequest("VALIDATION_ERROR", "rating is required"));
        }
        return Mono.fromCallable(() -> store.saveFeedback(messageId, req.rating(), req.comment(),
                        Boolean.TRUE.equals(req.contactOptIn()), req.contact()))
                .map(f -> {
                    Map<String, Object> out = new LinkedHashMap<>();
                    out.put("id", f.id());
                    out.put("messageId", messageId);
                    out.put("rating", req.rating());
                    out.put("status", "NEW");
                    out.put("createdAt", f.createdAt().toString());
                    return out;
                }).subscribeOn(Schedulers.boundedElastic());
    }

    private JsonNode identity() {
        String raw = store.configJson("assistant.identity");
        if (raw == null) return json.createObjectNode();
        try { return json.readTree(raw); } catch (Exception e) { return json.createObjectNode(); }
    }

    private static String textOf(JsonNode n, String field, String dflt) {
        JsonNode v = n.path(field);
        return v.isTextual() ? v.asText() : dflt;
    }
}
