# ADR-004 — Keycloak as the identity provider (OIDC + PKCE)

**Status**: Accepted · **Date**: 2026-09-03 · **Reversibility**: soft if the replacement is
OIDC-conformant; hard if it is SAML/LDAP-only

## Context

Two facades with very different security profiles share one API:

* **Frontoffice**: mostly anonymous customers; optional sign-in to keep history; must keep working
  when the IdP is down (a customer asking about a product is not a regulated operation).
* **Backoffice**: bank staff performing governed actions (publishing knowledge, approving Sharia
  content, changing prompts, pulling the kill switch). Every action must be attributable to a named
  person with a specific role, with MFA, short sessions and full audit.

The owner chose **Keycloak**. Requirements: OIDC, MFA, role/group management, brute-force protection,
HA clustering, and a version without known critical CVEs.

## Decision

1. **Keycloak ≥ 26.6.3** as the IdP (the June 2026 security release fixing 16 CVEs, including
   token-exchange privilege escalation and an OIDC SSRF, is the floor). HA deployment with the
   `jdbc-ping` transport stack and persistent user sessions.
2. **Separate clients per facade**: `albaraka-assistant-web` and `albaraka-assistant-widget` (public,
   Authorization Code + **PKCE** S256), `albaraka-backoffice-web` (public + **MFA required**, `acr`
   ≥ `urn:keycloak:2fa`), `albaraka-assistant-service` (confidential, client credentials for jobs).
3. **The Spring Boot backend is a pure OAuth2 resource server**: it validates JWTs
   (`issuer-uri` pinned, `aud` checked) and holds no sessions of its own.
4. **Realm roles are the authorization vocabulary**, mapped 1:1 to the governance roles of
   doc 05 §3: `customer`, `branch-agent`, `kb-editor`, `sharia-officer`, `sharia-auditor`,
   `compliance`, `ai-engineer`, `analyst`, `platform-admin`.
5. **Groups carry retrieval scope**: `/comite-charia`, `/conformite`, `/reseau-agences`,
   `/direction-digitale` with an `audience` attribute (`PUBLIC`/`AGENT`/`INTERNAL`) and a
   `maxClassification` attribute. These become `AUD_*` and `CLS_*` authorities — so *data* scoping is
   derived from the token, never from a request parameter.
6. **Anonymous frontoffice** is a first-class path: an ephemeral `device_id`, no Keycloak session,
   stricter rate limits, and no persistence beyond the retention rules. Authentication is optional and
   only adds history and personalisation.
7. **MFA** (TOTP or WebAuthn/passkey) mandatory for all governance roles; brute-force protection with
   permanent lockout for admin roles after 10 failures; access-token lifetimes 5 min (front) /
   10 min (back), refresh rotating with reuse detection, idle session 30 min in the backoffice.
8. **Standard token exchange stays disabled** unless a concrete need appears (it is a recurring CVE
   surface).
9. **Realm as code**: `specs/keycloak/albaraka-realm.json` is imported on environment bootstrap;
   manual console changes are forbidden in `uat`/`prod` (drift is detected by a nightly diff).

## Alternatives considered

| Option | Why not |
|---|---|
| Self-contained Spring Security JWT (users in our DB) | Rejected by the owner; also means owning password storage, MFA, lockout and audit ourselves — the least bank-appropriate option |
| Auth0 / Okta / Azure Entra ID | Another cross-border SaaS in the critical path; Entra ID stays a valid later option via OIDC federation |
| Direct LDAP/AD integration | No MFA, no OIDC for SPAs, no consent/session management |
| Keycloak **with** its fine-grained authorization services (UMA) for all rules | Powerful but opaque to auditors and hard to test; we keep authorization decisions in application code where they are reviewable, using Keycloak only for identity + roles + attributes |

## Consequences

**Positive**: standards-based SSO with MFA and passkeys out of the box; role/group model maps directly
onto the governance model; stateless backend scales horizontally; anonymous customer access does not
depend on IdP availability; realm-as-code makes environments reproducible and auditable.

**Negative / risks and mitigations**:

| Risk | Mitigation |
|---|---|
| Keycloak becomes a single point of failure for staff | HA cluster; the frontoffice anonymous path is independent; runbook `keycloak-realm-restore` |
| Version churn and CVEs | Minimum version pinned, monthly tracking, dependency gate blocks promotion on CRITICAL |
| Role drift / over-provisioning | Quarterly access review exported to Compliance; roles are few and coarse, attributes carry scope |
| Realm JSON divergence between environments | Nightly diff between the exported realm and `specs/keycloak/albaraka-realm.json`; alerts on drift |
| Upstream breaking changes (Keycloak changes token/user representations between minors) | Pin the minor, test the upgrade in `dev` before `uat`, keep an adapter layer for claims mapping |

**Follow-ups**: confirm whether the bank already runs an IdP that should be federated instead
(doc 00 §9.4); decide MFA method(s) per role with IT security; agree the admin IP allowlist policy.
