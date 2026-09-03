package tn.albaraka.ai.api;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import tn.albaraka.ai.shared.error.ApiException;

import java.util.Map;

/** Wire error envelope: specs/openapi.yaml `error` object. */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, Object>> handle(ApiException e) {
        return ResponseEntity.status(e.status()).body(Map.of(
                "error", Map.of("code", e.code(), "message", e.getMessage() == null ? e.code() : e.getMessage())));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, Object>> handleOther(Exception e) {
        return ResponseEntity.status(500).body(Map.of(
                "error", Map.of("code", "INTERNAL", "message", e.getMessage() == null ? "internal error" : e.getMessage())));
    }
}
