package tn.albaraka.ai.api;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import reactor.core.publisher.Mono;
import tn.albaraka.ai.shared.config.AlbarakaProperties;
import tn.albaraka.ai.shared.error.ApiException;

import java.util.List;
import java.util.Map;

/**
 * Backoffice sign-in bridge: the SPA posts credentials, this endpoint performs the Keycloak
 * password grant against the confidential {@code albaraka-assistant-bridge} client (DAG is
 * enabled only there — realm-lint M14) and returns a bearer + user claims.
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final WebClient web;
    private final ReactiveJwtDecoder jwtDecoder;
    private final AlbarakaProperties.Keycloak kc;

    public AuthController(WebClient.Builder builder, ReactiveJwtDecoder jwtDecoder, AlbarakaProperties props) {
        this.kc = props.keycloak();
        this.jwtDecoder = jwtDecoder;
        this.web = builder.build();
    }

    public record LoginRequest(String email, String password) {}

    public record LoginResponse(String accessToken, Map<String, Object> user) {}

    @PostMapping("/login")
    public Mono<LoginResponse> login(@RequestBody LoginRequest body) {
        if (body.email() == null || body.password() == null) {
            return Mono.error(ApiException.badRequest("VALIDATION_ERROR", "email and password are required"));
        }
        return web.post().uri(kc.tokenUrl())
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(BodyInserters.fromFormData("grant_type", "password")
                        .with("client_id", kc.backofficeClientId())
                        .with("client_secret", kc.backofficeClientSecret())
                        .with("username", body.email())
                        .with("password", body.password())
                        .with("scope", "openid"))
                .retrieve()
                .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                .flatMap(res -> {
                    String token = String.valueOf(res.get("access_token"));
                    if (token == null || token.isBlank() || "null".equals(token)) {
                        return Mono.error(ApiException.unprocessable("AUTH.INVALID_CREDENTIALS", "invalid credentials"));
                    }
                    return jwtDecoder.decode(token)
                            .map(jwt -> new LoginResponse(token, userOf(jwt)))
                            .onErrorMap(e -> {
                                // token issued but our resource server refuses it (audience/issuer/jwk
                                // mismatch) — log the real reason, never the generic error alone
                                log.warn("auth: token rejected by the resource server: {}", e.toString());
                                return ApiException.unprocessable("AUTH.INVALID_CREDENTIALS", "invalid credentials");
                            });
                })
                .onErrorMap(e -> {
                    // Keycloak answers 400 with {error, error_description} for bad user/client
                    // (invalid_grant, invalid_client, invalid_grant for wrong secret, …). Surface it
                    // in the server log so `make logs` pinpoints the cause instead of a silent 401.
                    if (e instanceof WebClientResponseException wce) {
                        log.warn("auth: keycloak token grant rejected (status {}): {}", wce.getStatusCode().value(),
                                wce.getResponseBodyAsString());
                    }
                    return e instanceof ApiException ? e
                            : ApiException.unprocessable("AUTH.INVALID_CREDENTIALS", "invalid credentials");
                });
    }

    @GetMapping("/me")
    public Mono<Map<String, Object>> me(@AuthenticationPrincipal Jwt jwt) {
        return Mono.just(userOf(jwt));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> userOf(Jwt jwt) {
        Map<String, Object> realm = jwt.getClaimAsMap("realm_access");
        List<String> roles = realm != null && realm.get("roles") instanceof List<?> l
                ? l.stream().map(String::valueOf).toList() : List.of();
        return Map.of(
                "subject", jwt.getSubject(),
                "email", jwt.getClaimAsString("email") != null ? jwt.getClaimAsString("email") : jwt.getSubject(),
                "name", jwt.getClaimAsString("name") != null ? jwt.getClaimAsString("name") : jwt.getSubject(),
                "roles", roles);
    }
}
