package tn.albaraka.ai.api;

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
import tn.albaraka.ai.shared.Locales;

import java.util.UUID;

/**
 * Device-scoped anonymous chat SSE endpoint (kept for the compose smoke + widget-style clients).
 * The documented frontoffice surface is {@link FrontofficeController} (/api/v1/assistant/**);
 * both entry points share {@link ChatStreamer}.
 */
@RestController
@RequestMapping("/api/v1/chat")
public class ChatController {

    private final JdbcConversationStore store;
    private final ChatStreamer streamer;

    public ChatController(JdbcConversationStore store, ChatStreamer streamer) {
        this.store = store;
        this.streamer = streamer;
    }

    public record ChatRequest(String text, String locale, String clientId, String deviceId, String conversationId) {}

    @PostMapping(produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<String>> chat(@RequestBody ChatRequest req) {
        String locale = req.locale() == null ? "fr-FR" : req.locale();
        Mono<ChatStreamer.ChatContext> ctx = Mono.fromCallable(() -> {
            var conv = store.findOrCreateConversation(req.deviceId(), locale);
            int ord = store.nextOrdinal(conv.id());
            UUID userMsg = store.saveUserMessage(conv.id(), ord, req.text(), locale,
                    Locales.dirOf(locale), req.clientId());
            return new ChatStreamer.ChatContext(conv.id(), userMsg, ord);
        }).subscribeOn(Schedulers.boundedElastic());

        return ctx.flatMapMany(c -> streamer.stream(c, req.text(), locale));
    }
}
