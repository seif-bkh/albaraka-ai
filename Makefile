.PHONY: dev web admin eval seed verify-db spike lint-ui lint-all

# Backend dev server (Express + embedded PostgreSQL on :8080)
dev:
	cd server && npm run dev

# Front-office (public chat) :4200 — proxies /api to :8080
web:
	cd albaraka-web && npm run serve:fo

# Back-office (admin console) :4201 — proxies /api to :8080
admin:
	cd albaraka-web && npm run serve:bo

# Golden evaluation gate against the running backend
eval:
	cd server && npm run eval

# Re-initialise the embedded database (schema + seeds + demo KB)
seed:
	cd server && npm run db:init

# db-verify: schema + schema_test.sql against a throwaway PostgreSQL
verify-db:
	cd tools/db-verify && npm run verify

# provider smoke tests (mock; real keys when present in .env)
spike:
	cd tools/spike && npm test

# frontend/backend build + eval smoke
build:
	cd albaraka-web && npm run build:ui && npm run build:frontoffice && npm run build:backoffice
	cd server && node --check src/index.js && node --check src/pipeline.js

# all specification gates (CI parity)
lint-all: verify-db seed-gen-check prompt-lint eval-lint realm-lint config-lint i18n-lint asyncapi-lint compose-lint

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
