# `specs/keycloak/` — realm as code

`albaraka-realm.json` is the authoritative definition of the `albaraka` realm. It is imported on
environment bootstrap and manual console changes are forbidden in `uat` and `prod`
([ADR-004](../../docs/adr/ADR-004-iam-keycloak-oidc.md), decision 9).

Validate it before changing anything else:

```bash
cd tools/realm-lint && npm run verify
```

That linter checks this file against `specs/db/schema.sql` (the `audience` and `classification`
enums), `docs/05` §3 (the governance role table) and `docs/07` §2.1/§2.3 (the client table and the
MFA mandate). See [tools/realm-lint/README.md](../../tools/realm-lint/README.md).

---

## 1. Placeholders

The file contains no environment-specific value and **no secret**. Five `${…}` placeholders are
resolved by the bootstrap job before import:

| Placeholder | Meaning | Example (dev) |
|---|---|---|
| `${FRONTOFFICE_URL}` | Root URL of the customer chat app | `https://assistant.dev.albaraka.internal` |
| `${BACKOFFICE_URL}` | Root URL of the administration console | `https://admin.dev.albaraka.internal` |
| `${BANK_PUBLIC_URL}` | The bank's public site that embeds the widget | `https://www.albaraka.com.tn` |
| `${WIDGET_REDIRECT_URI}` | Single exact redirect URI for the widget | `https://www.albaraka.com.tn/assistant/callback` |
| `${KEYCLOAK_FRONTEND_URL}` | Public issuer URL, set on the container, not in this file | `https://sso.dev.albaraka.internal` |

```bash
envsubst < specs/keycloak/albaraka-realm.json > /tmp/realm-resolved.json
kcadm.sh create partialImport -r albaraka -s realm.json=/tmp/realm-resolved.json -o ifResourceExists=OVERWRITE_EXISTING
```

Keycloak resolves `${…}` from its own config for *some* attributes but **not** for `redirectUris`,
`webOrigins` or `rootUrl`. Hence `envsubst`. The client secret of
`albaraka-assistant-service` is deliberately absent: Keycloak generates one at import, and the real
value is read from Vault by the worker at runtime
(`secret/data/albaraka/keycloak#assistant-service`). Committing a secret here would be a finding.

---

## 2. Clients

| Client | Type | Flows | Token life | Notes |
|---|---|---|---|---|
| `albaraka-assistant-web` | public | Authorization Code + PKCE S256 | 300 s | Frontoffice chat. Refresh rotating, reuse detection on, idle 30 min. `locale` claim mapped from the user attribute |
| `albaraka-assistant-widget` | public | Authorization Code + PKCE S256, **or anonymous** | 300 s | Anonymous mode never creates a Keycloak session: the widget runs on an ephemeral `device_id` and the backend issues its own short-lived token. Login is optional, to keep history across visits |
| `albaraka-backoffice-web` | public | Authorization Code + PKCE S256 + PAR, **MFA required** | 600 s | Bound to the `backoffice browser — MFA required` flow. `fullScopeAllowed` so every governance role reaches the token |
| `albaraka-assistant-service` | confidential | Client credentials only | 900 s | Background workers. Three scoped client roles: `ingestion-worker`, `eval-runner`, `analytics-reader` |
| `albaraka-assistant-api` | resource server | none (`bearerOnly`) | — | Exists so `aud` can be pinned. Issues nothing |

Every client except the resource server carries an **audience mapper** adding
`albaraka-assistant-api` to `aud`. Without it, Spring's
`spring.security.oauth2.resourceserver.jwt.audiences` check rejects every token — the single most
common Keycloak/Spring integration failure, and invisible until the first authenticated call.

Disabled everywhere: implicit flow, direct access grants (password grant), registration,
self-service password reset, standard token exchange, `adminPermissionsEnabled`.

---

## 3. Roles

Nine realm roles, 1:1 with the governance roles of [docs/05](../../docs/05-sharia-governance.md) §3.
Each carries three attributes that the backend turns into authorities:

| Role | `audience` | `maxClassification` | `mfaRequired` | Grants |
|---|---|---|---|---|
| `customer` | `PUBLIC` | `PUBLIC` | false | Chat, feedback, request a ruling. Default for every authenticated user |
| `branch-agent` | `AGENT` | `INTERNAL` | false | Agent-desk sessions, `INTERNAL` content, escalation and handoff |
| `kb-editor` | `INTERNAL` | `INTERNAL` | false | Draft and submit knowledge, microcopy and non-sensitive glossary. Cannot approve |
| `sharia-officer` | `INTERNAL` | `RESTRICTED` | **true** | The only role that can set `sharia_approved`. Required in every T3 quorum |
| `sharia-auditor` | `INTERNAL` | `RESTRICTED` | **true** | Read-only everywhere including committee deliberations; evidence-pack export; red-team runs |
| `compliance` | `INTERNAL` | `INTERNAL` | **true** | Approves guardrail policies, PII rules, retention and rate limits; second approver for the kill switch |
| `ai-engineer` | `INTERNAL` | `INTERNAL` | **true** | Prompts, retrieval parameters, model routing, evaluations. Cannot approve Sharia-sensitive content |
| `analyst` | `INTERNAL` | `INTERNAL` | **true**¹ | Analytics, feedback triage, golden-set curation |
| `platform-admin` | `INTERNAL` | `INTERNAL` | **true** | Releases, feature flags, configuration promotion, kill switch |

¹ `analyst` is hardened beyond the docs/07 §2.3 mandate. The justification is recorded in
`MFA_HARDENED_BEYOND_MANDATE` in the linter: the role reads conversation-derived analytics, so a
compromised analyst account is a personal-data exposure even though it cannot write.

Two invariants the linter enforces, because both are silent when broken:

* **Enum membership.** `audience` values come from `CREATE TYPE audience`
  (`PUBLIC|AGENT|INTERNAL`); `maxClassification` values come from `CREATE TYPE classification`
  (`PUBLIC|INTERNAL|CONFIDENTIAL|RESTRICTED`). There is **no `AGENT` classification** — the first
  draft of this file used one, and the database would simply never have matched it.
* **Scope containment.** An `AGENT` or `INTERNAL` audience requires `maxClassification ≥ INTERNAL`.
  A role scoped to serve agent-facing content while allowed to read only `PUBLIC` content cannot do
  its job, and fails in a way that looks like a retrieval bug.

Segregation of duties is *not* enforced here. Keycloak expresses identity; the two-eyes rule is a
database trigger (`GOVERNANCE.SELF_APPROVAL`, guarantee **G3a** in
[schema_test.sql](../db/tests/schema_test.sql)), so it holds even for a `platform-admin` who grants
themselves every role.

---

## 4. Groups

Groups mirror the organisation and carry the same attributes, which is how a branch agent gets
`AGENT`-audience content with no per-user configuration.

| Path | `audience` | `maxClassification` | Realm roles |
|---|---|---|---|
| `/direction-digitale` | `INTERNAL` | `INTERNAL` | `kb-editor`, `ai-engineer`, `analyst`, `platform-admin` |
| `/conformite` | `INTERNAL` | `INTERNAL` | `compliance`, `sharia-auditor` |
| `/comite-charia` | `INTERNAL` | `RESTRICTED` | `sharia-officer` (`quorumT3: true`) |
| `/reseau-agences` | `AGENT` | `INTERNAL` | `branch-agent` |

A group's `maxClassification` must never be *above* that of the highest role it contains. Authority
is `max(role, group)` and membership already grants every role the group maps, so a group attribute
at or below its members' ceiling widens nobody — above it, membership becomes a shortcut to a
clearance none of the roles earned. `/conformite` therefore sits at `INTERNAL` even though it
contains `sharia-auditor`: the auditor's `RESTRICTED` comes from the role, not the group.
`/comite-charia` carries `quorumT3`, which the governance service reads when assembling a T3 review
panel.

`defaultRole` composes exactly `["customer"]`. Every authenticated user is a customer; every higher
authority comes from group membership, which is what makes the quarterly access review meaningful.

---

## 5. Token → authorities

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: ${KEYCLOAK_URL}/realms/albaraka
          audiences: albaraka-assistant-api
```

`JwtAuthorityConverter` maps, for every request:

| Source | Authority | Example |
|---|---|---|
| `realm_access.roles[]` | `ROLE_<UPPER_KEBAB>` | `sharia-officer` → `ROLE_SHARIA_OFFICER` |
| role/group attribute `audience` | `AUD_<VALUE>` (highest wins) | `AUD_AGENT` |
| role/group attribute `maxClassification` | `CLS_<VALUE>` (highest wins) | `CLS_RESTRICTED` |
| `acr` | `LOA_<VALUE>` | backoffice logins must present a second factor |

`AUD_*` drives retrieval scoping, `CLS_*` drives the content gate. Both are derived, never asserted
by the caller: an anonymous widget session carries no `AUD_` authority at all and is treated as
`PUBLIC`.

Anonymous widget traffic never reaches Keycloak. The backend issues its own 15-minute token bound to
the `device_id`, marked `audience = PUBLIC`, `maxClassification = PUBLIC`. The consequence is that a
Keycloak outage degrades staff access but does **not** take down the customer widget.

---

## 6. Authentication hardening in this file

| Control | Setting |
|---|---|
| Brute force | `bruteForceProtected: true`, `permanentLockout: true`, `failureFactor: 10`, `maxFailureWaitSeconds: 900`, `maxDeltaTimeSeconds: 43200` |
| Refresh tokens | `revokeRefreshToken: true`, `refreshTokenMaxReuse: 1` — rotation with reuse detection |
| Sessions | realm idle 30 min / max 8 h; backoffice `client.session.idle.timeout` 30 min |
| Signing | `defaultSignatureAlgorithm: RS256` — matches docs/07 §5 (RS256/EdDSA) and the Spring resource server's default JWT algorithm set (PS256 is rejected with `BadJwtException: Unsupported algorithm`) |
| MFA | A bound browser flow with a `REQUIRED` subflow offering `auth-otp-form` or `webauthn-authenticator`. No `CONDITIONAL` and no `DISABLED` execution inside it, so there is no path through login that skips the second factor |
| WebAuthn | `userVerificationRequirement: required`, `avoidSameAuthenticatorRegister: true`, ES256/RS256 |
| OTP | TOTP, HmacSHA256, 6 digits, 30 s, non-reusable codes |
| Headers | CSP with `frame-ancestors` pinned to the bank's origin, `object-src 'none'`, HSTS one year including subdomains |
| Audit | Login, token, consent, client-CRUD and `TOKEN_EXCHANGE` events recorded, 90-day retention, admin events with details |

Standard token exchange is not disabled by a flag — Keycloak has no such flag. It is disabled by
**never granting the scope**: no client lists it, no role implies it, and the
`token-exchange-denied` client policy exists so an attempt to introduce it fails closed. Attempts are
still audited, which is why `TOKEN_EXCHANGE` appears in `enabledEventTypes`.

---

## 7. Minimum version

Keycloak **26.6.3** or newer (June 2026 security release; 16 CVEs fixed including a token-exchange
privilege escalation and an OIDC SSRF). Pinned in `deploy/docker-compose.yml` and enforced by the
dependency gate, which blocks promotion on any CRITICAL advisory.

---

## 8. Drift detection

A nightly job exports the live realm and diffs it against this file:

```bash
kcadm.sh get realms/albaraka --fields realm,clients,roles,groups,authenticationFlows \
  > /tmp/live-realm.json
node tools/realm-lint/lint.mjs REALM=/tmp/live-realm.json   # does the LIVE realm satisfy the rules?
jq -S 'del(.clients[].secret, .components, .eventsListeners)' /tmp/live-realm.json > /tmp/a.json
jq -S 'del(.clients[].secret)' specs/keycloak/albaraka-realm.json > /tmp/b.json
diff -u /tmp/b.json /tmp/a.json || alert "keycloak-realm-drift"
```

Running the linter against the *live* export is the more valuable half: it answers "is the running
realm still safe?" rather than "is my file well-formed?". Normalising away `secret` and
`components` removes the fields Keycloak regenerates on every export.

Runbook: `keycloak-realm-restore` ([docs/12](../../docs/12-deployment-observability.md)).
