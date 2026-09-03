# RUNBOOK — kill-switch

| | |
|---|---|
| **Scenario** | Proven poisoning, harmful output, responsible disclosure, or a Sharia/Compliance stop order |
| **RTO / RPO** | ≤ 1 h to contain per docs/12 §8; the switch itself is seconds |
| **Source of truth** | docs/05 (sharia governance), docs/12 §8, specs/db/schema.sql `assistant_config` (kill-switch mode), docs/12 §10 |

## The switch

`assistant_config` row `key = 'kill-switch.mode'` (documented comment: "feature flags, kb_epoch,
kill-switch mode"). Modes, in escalation order:

| mode | effect |
|---|---|
| `READ_ONLY` | no generation; answers are refused up front (REF-05-style) but ingestion/UI/admin still work |
| `NO_GENERATION` | server refuses `POST /api/v1/chat/stream` with `422`/`503`; cached answers still served |
| `FULL_STOP` | chat endpoints return a maintenance response; admin remains reachable for the *reason* logging |

## Steps

1. **Flip the switch** — admin action with `reason_code` (break-glass codes are separate from
   `reason`); the action is recorded in `audit_event` (`action`, `reason_code`). In dev:
   ```bash
   docker compose exec postgres psql -U albaraka -d albaraka_ai \
     -c "UPDATE assistant_config SET value='\"FULL_STOP\"', updated_by=current_user, version=version+1
         WHERE key='kill-switch.mode';"
   ```
   Production: via the backoffice kill-switch panel (Phase 3) or the break-glass SQL path with the
   recorded justification — never by editing `assistant_config` directly without an audit row.
2. **Contain the source** (the actual incident): withdraw the content/document (`content-withdrawal.md`)
   or retire the prompt (`prompt_version` state) behind the same `reason_code`.
3. **Open the incident**: `incident` row with `severity_level` (S1 if data poisoning or PII, S2 if
   wrong-but-not-harmful answers), owner, and the evidence pack export trigger.
4. **Communicate** per the incident policy — for a Sharia stop this is a committee decision, not an
   engineering decision (`sharia-incident.md`).

## Lifting

1. Root cause fixed; offending rows retired/withdrawn; golden-set gate green
   (`docs/11 §4` release thresholds) on the affected bundles.
2. Committee/Compliance sign-off recorded.
3. Mode steps down `FULL_STOP → NO_GENERATION → READ_ONLY → NORMAL`, with the semantic cache
   flushed between steps (`cache-flush.md`) so a poisoned answer is not re-served from cache.

## Verification

* While `FULL_STOP`: chat returns the maintenance response; `/actuator/health` shows the kill
  switch component `DOWN` (green if the mechanism is wired — see docs/12 §1).
* `audit_event` shows one row per state change, actor and `reason_code`; the hash chain verifies.
* After lift: golden set green, `kill-switch.mode` = `NORMAL`.

## Notes

* The switch is a *control*, not a fix. Data poisoning is contained by withdrawal + restore from
  the last good `kb_epoch` (docs/12 §8) — the kill switch only buys the time to do it.
* The drill (semi-annual, docs/12 §9) must prove that the backoffice path fails **closed**: if the
  DB or Keycloak is down, the switch must still be flippable via the break-glass SQL + audit path.
