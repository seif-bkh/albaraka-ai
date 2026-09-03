package tn.albaraka.ai.shared.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Application wiring — mirrors specs/config/application.yaml `albaraka.*` (ADR-009). */
@ConfigurationProperties(prefix = "albaraka")
public record AlbarakaProperties(Rag rag, Keycloak keycloak, Cors cors) {

    public record Rag(String baseUrl, String serviceToken, int contract, String providerMode) {}

    public record Keycloak(String tokenUrl, String backofficeClientId) {}

    public record Cors(java.util.List<String> allowedOrigins) {}
}
