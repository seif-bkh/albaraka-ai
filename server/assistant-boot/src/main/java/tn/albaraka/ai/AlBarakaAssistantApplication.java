package tn.albaraka.ai;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/** Phase 1 boot (docs/13 §1): Spring Boot 4.1, WebFlux, Flyway + seed, Keycloak JWT. */
@SpringBootApplication
@ConfigurationPropertiesScan
public class AlBarakaAssistantApplication {
    public static void main(String[] args) {
        SpringApplication.run(AlBarakaAssistantApplication.class, args);
    }
}
