# RUNBOOK — cache-flush

| | |
|---|---|
| **Scenario** | Redis cache poisoned / corrupt / drifting from Postgres; deliberate flush after a KB or config change |
| **RTO / RPO** | ≤ 5 min / cache only (durable data is in Postgres) |
| **Source of truth** | docs/12 §8, docs/04 §6 (semantic cache), docs/08 §2.2 (429 RATE_LIMITED), deploy/docker-compose.yml |

## What the cache holds (and what it does NOT hold)

* semantic-cache entries keyed by normalized question (+ retrieval config version) → answer
* rate-limit counters (sliding window, per principal/IP)
* locale dictionaries, fragments of `retrieval_config`/`assistant_config` read-throughs

**It never holds the content store.** Chunks, embeddings, documents and audit events are in
Postgres (`chunk`, `chunk_embedding`, `audit_event`). Flushing Redis is therefore safe by design.

## When to flush *deliberately*

* a `kb_epoch` bump or content withdrawal — see `content-withdrawal.md`;
* an `embedding_variant`/`retrieval_config` activation — the cache key version must change anyway;
* a prompt change — prompt versions are in the cache key; a flush is a belt-and-braces measure.

## Steps

```bash
docker compose exec redis redis-cli FLUSHALL
docker compose restart redis          # optional; FLUSHALL is enough unless the process is wedged
```

For a targeted flush (dev debugging), prefix keys are `albaraka:semcache:*`,
`albaraka:ratelimit:*`, `albaraka:cfg:*` — use `SCAN`/`DEL`, never `KEYS *` on a production node.

## Verification

* `docker compose exec redis redis-cli DBSIZE` → 0 (or only expected cfg keys).
* A repeated question answers fresh with `cached: false` once, then `cached: true` again.
* Rate limiting still works: `docker compose exec redis redis-cli GET albaraka:ratelimit:*` after
  10 rapid requests falls back to the advertised `429 RATE_LIMITED`.

## Failure mode it prevents

Redis down **degrades, doesn't die**: cache-aside misses → direct calls; rate limiting falls back
to in-process buckets (docs/12 §8). The one thing you must not do is put `--appendonly yes` back
into doubt — `redisdata` is the AOF/Persistence volume and `cache-flush` is a *logical* flush, not
a volume deletion. Deleting `redisdata` is only justified when Redis itself is corrupted; it is
the same operation, but it is intentional destruction, so say so.

## Notes

* If counters are flushed mid-window, some clients may briefly pass the rate limit — acceptable,
  bounded, and exactly the class of behaviour the in-process fallback also has.
