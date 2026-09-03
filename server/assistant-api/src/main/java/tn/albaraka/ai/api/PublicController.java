package tn.albaraka.ai.api;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;
import tn.albaraka.ai.knowledge.KnowledgeService;
import tn.albaraka.ai.ragclient.RagClient;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** Public surface: health, published documents. */
@RestController
@RequestMapping("/api/v1")
public class PublicController {

    private final KnowledgeService knowledge;
    private final RagClient rag;

    public PublicController(KnowledgeService knowledge, RagClient rag) {
        this.knowledge = knowledge; this.rag = rag;
    }

    @GetMapping("/health")
    public Mono<Map<String, Object>> health() {
        return rag.health().defaultIfEmpty(Map.of("status", "UNKNOWN")).map(r -> {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("status", "UP");
            out.put("services", Map.of("rag", r.getOrDefault("status", "UP"),
                    "database", "UP"));
            return out;
        }).onErrorReturn(Map.of("status", "DEGRADED", "services", Map.of("rag", "DOWN", "database", "UP")));
    }

    @GetMapping("/public/documents/{id}")
    public Map<String, Object> document(@PathVariable UUID id) {
        return knowledge.getDocument(id);
    }
}
