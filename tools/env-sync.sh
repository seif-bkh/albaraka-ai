#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════════════════════
#  env-sync — keep `.env` in step with `.env.example` (deploy/docker-compose.yml contract)
#
#  Why this exists: `make up` used to do `cp -n .env.example .env`, which only helps the very
#  first run. When a new required variable lands in docker-compose.yml (the
#  KEYCLOAK_BRIDGE_CLIENT_SECRET regression), someone with an older `.env` is told
#  "required variable ... is missing a value" and has to discover the merge step by hand.
#
#  Behaviour (additive only — user values are NEVER overwritten):
#    * .env missing            → copy .env.example → .env (dev defaults; mock mode needs no keys)
#    * key absent from .env    → append it with the .env.example value   (added)
#    * key present but empty   → fill it with the .env.example value     (filled)
#    * key present, non-empty  → untouched (a user value wins by design)
#
#  Usage: bash tools/env-sync.sh [.env] [.env.example]
# ══════════════════════════════════════════════════════════════════════════════════════════════
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${1:-.env}"
EXAMPLE="${2:-.env.example}"

if [ ! -f "$EXAMPLE" ]; then
  echo "env-sync: $EXAMPLE not found" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$EXAMPLE" "$ENV_FILE"
  echo "env-sync: created $ENV_FILE from $EXAMPLE (dev defaults — mock mode needs no keys)"
  exit 0
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
cp "$ENV_FILE" "$tmp"

added=()
filled=()

replace_first_key() {
  # replace the FIRST "$1=" line in $tmp with $2 (plain-text replacement via awk)
  awk -v k="$1" -v l="$2" 'BEGIN { done = 0 }
    $0 ~ "^" k "=" { if (!done) { print l; done = 1 } else print; next }
    { print }' "$tmp" > "$tmp.awk" && mv "$tmp.awk" "$tmp"
}

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in '' | \#*) continue ;; esac
  key="${line%%=*}"
  # only plain KEY=value lines from the example participate
  [[ "$key" == "$line" ]] && continue
  [[ "$key" =~ [^A-Za-z0-9_] ]] && continue

  existing="$(grep -E "^${key}=" "$ENV_FILE" | head -n1 || true)"
  if [ -z "$existing" ]; then
    printf '%s\n' "$line" >> "$tmp"
    added+=("$key")
  elif [ -z "${existing#*=}" ] && [ -n "${line#*=}" ]; then
    replace_first_key "$key" "$line"
    filled+=("$key")
  fi
done < "$EXAMPLE"

if [ "${#added[@]}" -gt 0 ] || [ "${#filled[@]}" -gt 0 ]; then
  mv "$tmp" "$ENV_FILE"
  [ "${#added[@]}" -gt 0 ] && echo "env-sync: added   ${added[*]}"
  [ "${#filled[@]}" -gt 0 ] && echo "env-sync: filled  ${filled[*]}"
  echo "env-sync: $ENV_FILE updated — re-run make up"
else
  echo "env-sync: $ENV_FILE is up to date"
fi

# ── pre-flight validation ─────────────────────────────────────────────────────────────────────
# MinIO hard requirement: the root user must be ≥3 characters and the root password ≥8
# characters. With a shorter value the server refuses to start (and the container is reported
# "unhealthy" — the classic trap of a hand-written `.env` with MINIO_ROOT_PASSWORD=admin).
# Fail here, before compose, with a message that says exactly what to change.
# MINIO_ROOT_PASSWORD requires at least 8 characters (marker for compose-lint [E11])
minio_user="$(grep -E '^MINIO_ROOT_USER=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '\r')"
minio_pass="$(grep -E '^MINIO_ROOT_PASSWORD=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '\r')"
if [ "${#minio_user}" -lt 3 ]; then
  echo "env-sync: ERROR — MINIO_ROOT_USER must be at least 3 characters (got \"$minio_user\"); the MinIO server refuses to start otherwise" >&2
  exit 1
fi
if [ "${#minio_pass}" -lt 8 ]; then
  echo "env-sync: ERROR — MINIO_ROOT_PASSWORD requires at least 8 characters (got ${#minio_pass}); MinIO refuses to start with a shorter secret, so the container is reported unhealthy." >&2
  echo "           Set a value of 8+ characters in $ENV_FILE, e.g. MINIO_ROOT_PASSWORD=dev-minio-change-me" >&2
  exit 1
fi
echo "env-sync: minio credentials valid (root user ${#minio_user} chars, password ${#minio_pass} chars)"
