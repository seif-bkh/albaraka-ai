# ══════════════════════════════════════════════════════════════════════════════════════════════
#  Al-Mouchir — run the whole application from your host (docs/12 §2.2, ADR-009)
# ══════════════════════════════════════════════════════════════════════════════════════════════
COMPOSE = docker compose --env-file .env -f deploy/docker-compose.yml --profile app

.PHONY: up down clean logs ps diag dev web admin eval rag-test verify-db spike build lint-all seed-gen-check

# ── your host: the deliverable ────────────────────────────────────────────────────────────────
up:            ## build + start the full application (mock providers by default)
	bash tools/env-sync.sh
	@$(COMPOSE) up -d --build || { \
	  echo; echo "── make up failed — container state ──"; \
	  $(COMPOSE) ps -a; \
	  echo; echo "── last 60 lines per service (logs) ──"; \
	$(COMPOSE) logs --tail=60 2>&1 | tail -300; \
	  echo; echo "── full logs:  make logs   ·   paste this output when reporting the failure ──"; \
	  exit 1; }
	@echo
	@echo "  frontoffice  http://localhost:9000"
	@echo "  backoffice   http://localhost:9000/admin"
	@echo "  API health   http://localhost:9002/actuator/health/liveness"
	@echo "  RAG health   http://localhost:9003/v1/rag/health"
	@echo "  Keycloak     http://localhost:9001  (remember .env KC_BOOTSTRAP_ADMIN_*)"
	@echo "  logs: make logs · state+logs: make diag"

down:          ## stop the application (volumes kept)
	$(COMPOSE) down

clean:         ## stop + remove all named volumes (fresh state — next `make up` re-seeds)
	$(COMPOSE) down -v

logs:          ## tail all service logs
	$(COMPOSE) logs -f --tail=100

ps:            ## service status
	$(COMPOSE) ps

diag:          ## container state + last 120 lines of every service (paste this when reporting a failure)
	$(COMPOSE) ps -a
	$(COMPOSE) logs --tail=120

# ── checks (CI parity) ────────────────────────────────────────────────────────────────────────
rag-test:      ## Python golden gate (mock mode — no keys, no Docker)
	cd rag-assistant && python3 -m pytest -q

eval:          ## alias of rag-test (the 8-case golden gate lives in rag-assistant/tests)
	$(MAKE) rag-test

verify-db:     ## schema.sql + schema_test.sql against a throwaway PostgreSQL
	cd tools/db-verify && npm run verify

spike:         ## provider smoke tests (mock; real keys when present in .env)
	cd tools/spike && npm test

build:         ## build the 3 Docker images without starting
	$(COMPOSE) build

lint-all: verify-db seed-gen-check prompt-lint eval-lint realm-lint config-lint i18n-lint asyncapi-lint compose-lint
	@echo "lint-all: all specification gates green"

seed-gen-check:
	node tools/seed-gen/generate.mjs --check

prompt-lint:
	node tools/prompt-lint/lint.mjs

eval-lint:
	node tools/eval-lint/lint.mjs

realm-lint:
	node tools/realm-lint/lint.mjs

config-lint:
	node tools/config-lint/lint.mjs

i18n-lint:
	node tools/i18n-lint/lint.mjs

asyncapi-lint:
	cd tools/asyncapi-lint && npm run verify

compose-lint:
	cd tools/compose-lint && npm run verify
