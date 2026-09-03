-- Keycloak runs against its own database instance, not the application schema.
-- The postgres container creates albaraka_ai (POSTGRES_DB) and this script runs on
-- first initialisation only, before the server starts. Idempotent by nature:
-- the docker-entrypoint-initdb.d directory runs once per empty data directory.
CREATE DATABASE keycloak OWNER albaraka;
