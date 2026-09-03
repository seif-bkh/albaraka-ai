package tn.albaraka.ai.api;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.convert.converter.Converter;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.security.web.server.SecurityWebFilterChain;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.reactive.CorsConfigurationSource;
import org.springframework.web.cors.reactive.UrlBasedCorsConfigurationSource;
import reactor.core.publisher.Mono;
import tn.albaraka.ai.shared.config.AlbarakaProperties;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** Keycloak resource-server security (realm roles → ROLE_* authorities). */
@Configuration
@EnableWebFluxSecurity
public class SecurityConfig {

    private static final String[] PUBLIC_GET = {
            "/api/v1/health", "/api/v1/public/**", "/actuator/health/**", "/actuator/info"
    };

    @Bean
    SecurityWebFilterChain springSecurity(ServerHttpSecurity http, AlbarakaProperties props) {
        return http
                .csrf(ServerHttpSecurity.CsrfSpec::disable)
                .cors(cors -> cors.configurationSource(corsSource(props)))
                .authorizeExchange(ex -> ex
                        .pathMatchers("/api/v1/auth/login").permitAll()
                        .pathMatchers("/api/v1/chat").permitAll()
                        .pathMatchers(HttpMethod.GET, PUBLIC_GET).permitAll()
                        .pathMatchers("/api/v1/admin/**").hasAnyRole(
                                "platform-admin", "admin", "kb-editor", "sharia-officer", "sharia-auditor",
                                "compliance", "ai-engineer", "analyst", "reviewer",
                                "ADMIN", "AI_ENGINEER", "SHARIA_OFFICER", "COMPLIANCE_OFFICER", "REVIEWER")
                        .anyExchange().authenticated())
                .oauth2ResourceServer(oauth -> oauth.jwt(jwt -> jwt.jwtAuthenticationConverter(realmRoles())))
                .build();
    }

    /** Keycloak puts realm roles in the `realm_access.roles` claim; Spring expects ROLE_-prefixed authorities. */
    private Converter<Jwt, Mono<AbstractAuthenticationToken>> realmRoles() {
        return jwt -> {
            List<SimpleGrantedAuthority> auths = new ArrayList<>();
            Object ra = jwt.getClaimAsMap("realm_access") != null
                    ? jwt.getClaimAsMap("realm_access").get("roles") : null;
            if (ra instanceof List<?> roles) {
                for (Object r : roles) auths.add(new SimpleGrantedAuthority("ROLE_" + r));
            }
            auths.add(new SimpleGrantedAuthority("ROLE_USER"));
            return Mono.just(new JwtAuthenticationToken(jwt, auths, jwt.getSubject()));
        };
    }

    private CorsConfigurationSource corsSource(AlbarakaProperties props) {
        CorsConfiguration cfg = new CorsConfiguration();
        cfg.setAllowedOrigins(props.cors().allowedOrigins() == null ? List.of() : props.cors().allowedOrigins());
        cfg.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cfg.setAllowedHeaders(List.of("*"));
        cfg.setExposedHeaders(List.of("X-Request-Id"));
        cfg.setAllowCredentials(true);
        UrlBasedCorsConfigurationSource src = new UrlBasedCorsConfigurationSource();
        src.registerCorsConfiguration("/**", cfg);
        return src;
    }
}
