# RUNBOOK — README (index + drill matrix)

This directory is the **runbook set mandated by docs/12 §8** ("Runbooks — each a markdown file in
`deploy/runbooks/`, tested at least once before go-live"). Each file is a checkbox the go-live
review (docs/13 Phase 5 "production readiness review", docs/12 §9 security operations) validates.

## Files

| Runbook | Scenario row in docs/12 §8 | Drill |
|---|---|---|
| [`provider-outage.md`](provider-outage.md) | Groq outage / rate limit; Google embeddings outage | monthly alert test |
| [`budget-exhausted.md`](budget-exhausted.md) | budget guard at 80 % / 100 % | monthly threshold test |
| [`db-failover.md`](db-failover.md) | Postgres primary failure | quarterly with restore drill |
| [`cache-flush.md`](cache-flush.md) | Redis failure / cache reset | semi-annual with kill-switch drill |
| [`kill-switch.md`](kill-switch.md) | data corruption / poisoning containment | **semi-annual** (docs/12 §9) |
| [`content-withdrawal.md`](content-withdrawal.md) | KB poisoning follow-up | quarterly on a sample document |
| [`reindex-embedding-model-change.md`](reindex-embedding-model-change.md) | planned model/embedding change | on every variant change |
| [`keycloak-realm-restore.md`](keycloak-realm-restore.md) | Identity failure / realm re-import | quarterly |
| [`pii-incident.md`](pii-incident.md) | PII leak path | annual pen-test + red-team follows |
| [`sharia-incident.md`](sharia-incident.md) | Sharia governance failure | annually with committee |
| [`secret-rotation.md`](secret-rotation.md) | credential exposure / scheduled rotation | 180-day schedule or on suspicion |
| [`restore-from-backup.md`](restore-from-backup.md) | full-site failure | **quarterly** (docs/12 §9) |
| [`audit-chain-repair.md`](audit-chain-repair.md) | audit trail integrity finding | quarterly with restore drill |

## Rules every runbook follows

1. **Ground, don't invent.** Every command references a real object of this repo (compose
   service, `${VAR}`, `audit_event` table, `assistant_config` key, `model_config` column). If a
   runbook references a not-yet-existing Phase 1/3 component, it says so explicitly and names the
   Phase that builds it.
2. **The failure mode is the point.** Each runbook states the *silent* failure it prevents
   (SQL_ASCII FTS, missing `shared_preload_libraries`, placeholder not reaching the container,
   hash-chain tampering, rotation order) — the same class of defect `tools/compose-lint` guards.
3. **Audit everything.** Any operator action is an `audit_event` with `reason_code`; break-glass
   is a `reason_code`, not a chat message.
4. **Drills are part of the artifact.** A runbook is "tested" when its checkbox row in docs/12 §9
   has a timestamp + evidence-pack hash in the incident evidence.

## Related

* [`../docker-compose.yml`](../docker-compose.yml) — the local topology these runbooks operate on
* [`../README.md`](../README.md) — Phase 0 scope of `deploy/`
* [`../../tools/compose-lint`](../../tools/compose-lint) — validates the compose file the
  runbooks reference
