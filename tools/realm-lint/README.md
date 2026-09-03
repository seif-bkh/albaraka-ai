# tools/realm-lint — the realm checked against the specs that give it meaning

A Keycloak realm is configuration where a typo becomes a privilege escalation. This tool does not
check the realm against itself; it checks it against the two other specifications that define what
its values *mean*:

| Read from | What it constrains |
|---|---|
| `specs/db/schema.sql` — `CREATE TYPE audience`, `CREATE TYPE classification` | Every `audience` and `maxClassification` attribute on a role or a group must be a value the database actually knows. Retrieval scoping and the content gate compare against those enums |
| `docs/05` §3 — the governance role table | The realm's roles must be exactly the Keycloak names in the table's second column. A renamed role silently disconnects governance from identity |
| `docs/07` §2.1 — the client table | Five clients, each with the documented type, flows, PKCE method and token lifetime |
| `docs/07` §2.3 — the MFA mandate | Which roles must carry `mfaRequired: "true"` |

Parsing the enums and the role table out of the source files — rather than restating them in the
linter — is the point. Restating them would let the two drift.

```bash
cd tools/realm-lint
npm run verify      # lint the realm, then prove the linter can fail (47 mutations)
```

No dependencies: Node's standard library only.

## What it checks

**Realm hygiene** — name and enabled state; registration, password reset and "remember me" closed;
brute-force protection on with permanent lockout after exactly 10 failures; refresh-token rotation
with reuse detection (`refreshTokenMaxReuse ≤ 1`); 300 s access tokens; `sslRequired: external`;
`fr`/`ar`/`en` locales; CSP with a pinned `frame-ancestors` and `object-src 'none'`; admin events and
login events recorded, `TOKEN_EXCHANGE` among the audited event types.

**Clients** — the five documented clients exist and no undocumented one appears; each matches its
documented `publicClient` / `bearerOnly` / `standardFlowEnabled` / `serviceAccountsEnabled`;
implicit flow and the password grant disabled everywhere; **no literal client secret is committed**
(secrets are provisioned from Vault at deploy time); PKCE `S256` on every browser client; per-client
token lifetimes 300 / 300 / 600 / 900 s; every non-resource-server client carries an audience mapper
pinning `albaraka-assistant-api` (without it Spring's `audiences` check rejects every token); the
embedded widget gets neither a wildcard origin nor a wildcard redirect URI; `fullScopeAllowed` is
refused on any client except the backoffice.

**MFA is structural, not advisory** — the backoffice client binds a browser flow; that flow contains
a `REQUIRED` subflow; the subflow offers TOTP or WebAuthn; nothing inside it is `DISABLED` and
nothing is `CONDITIONAL` (a conditional execution is an escape hatch around mandatory MFA); every
flow `id` is a valid UUID, because Keycloak rejects the import otherwise.

**Roles** — exactly the nine governance roles, no more, no fewer; each carries `audience`,
`maxClassification` and `mfaRequired` (as a *string*, which is what Keycloak stores); both enum
values validated against `schema.sql`; **scope containment** — an `AGENT` or `INTERNAL` audience
requires `maxClassification ≥ INTERNAL`, otherwise the role is scoped to serve content it is not
allowed to read; MFA present for every role docs/07 mandates.

A role that requires MFA *beyond* the mandate is an error unless its justification is recorded in
`MFA_HARDENED_BEYOND_MANDATE`. Today one entry exists:

> `analyst` — reads conversation-derived analytics; a compromised analyst account is a personal-data
> exposure even though the role cannot write.

Recording the deviation in code turns a CI warning nobody reads into a decision somebody signed.

**Groups** — the four documented groups; `path == "/" + name`; every mapped role defined; each group
maps at least one role; the same enum and containment rules as roles; and a group's
`maxClassification` never *exceeds* the highest role it contains. Authority is `max(role, group)`
and membership already grants every mapped role, so a group at its members' ceiling widens nobody;
above it, joining the group becomes a shortcut to a clearance none of the roles earned.

**Default role** — `defaultRole.composites.realm` is exactly `["customer"]`. Anything else means
every authenticated user silently inherits it.

## The 46 mutations

Four of them reproduce defects that were genuinely present in the first draft of the realm, which is
why they are pinned rather than merely illustrative:

| Id | Defect (real, from the draft) |
|---|---|
| **M32** | `branch-agent.maxClassification = "AGENT"` — `AGENT` is a value of the `audience` enum, **not** of `classification`. The database has no such classification, so the content gate could never match |
| **M29** | A flow `id` of `9c3f1f2a-…-albarakamfa1` — not a UUID, so Keycloak rejects the import outright |
| **M37** | `ai-engineer` without MFA. The mandate bullet in docs/07 §2.3 **wraps across two lines**, so a line-based parser read four mandated roles instead of five and the omission looked correct |
| **M38** | `branch-agent` scoped to `PUBLIC` classification while serving an `AGENT` audience — a role that cannot read what it exists to serve |

One mutation is a **negative control**: `N1` raises `/conformite` to `RESTRICTED`, which must keep
passing, because membership of that group already grants `sharia-auditor` and therefore
`RESTRICTED`. Without it, a rule as blunt as "a group may never exceed any member's classification"
would look correct and would forbid the correct configuration.

The rest cover: realm hygiene regressions (M01–M09), client misconfiguration (M10–M23), MFA
bypass (M24–M29), role and enum drift (M30–M39), and group/default-role privilege creep
(M40–M46).

Every mutation is applied to a parsed copy of the committed realm and asserts that it changed
something. If an anchor drifts, the mutation reports `BROKEN` and fails the run rather than silently
testing nothing.

## Running the linter in CI

`npm run verify` in the PR gate. It is fast (no JVM, no Keycloak, no network) and it fails on
anything that would either be rejected at import or silently widen an authority.

The **drift diff** required by [ADR-004](../../docs/adr/ADR-004-iam-keycloak-oidc.md) is a separate,
runtime concern: a nightly job exports the live realm (`kcadm.sh get realms/albaraka`) and diffs it
against this file, alerting on divergence. That comparison cannot run in CI because it needs a live
realm, but this linter is what makes the diff meaningful — without it, a drift report is a wall of
JSON with no way to tell a cosmetic change from a privilege change.
