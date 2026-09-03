# `tools/spike`

Dependency smoke tests — no build required. This is the **Phase 0 acceptance mechanism** for the
two provider keys (docs/13 Phase 0: "the two provider keys validated by `tools/spike`") and the
local data plane.

```bash
node spike.mjs                 # providers only (keys from the repo-root .env)
node spike.mjs --local         # + postgres :5432, redis :6379, minio health, keycloak OIDC
node spike.mjs --mock          # MOCK profile: providers deliberately NOT called, local checks only
```

Node ≥ 20, zero dependencies (`fetch` is built in). No key is printed, logged or stored — the
script only reports pass/fail and HTTP status.

## What it checks, against what

| Check | Contact point | Authority |
|---|---|---|
| Groq key + reachability | `GET {base}/openai/v1/models` with the key | specs/config/application.yaml (`api.groq.com/openai/v1`) |
| Groq chat completion | `POST /chat/completions`, `llama-3.3-70b-versatile` (fallback `llama-3.1-8b-instant`), `max_tokens: 1`, a single Arabic token | docs/04 §6 (primary model) |
| Groq prompt guard | `meta-llama/llama-prompt-guard-2-86m`, `max_tokens: 2` | docs/04 §5 (guard bean, ~80 ms path) |
| Google key + embeddings | `POST /v1beta/models/gemini-embedding-001:embedContent` with a trilingual (ar/fr/en) sample — the exact pipeline call, dimensions reported | docs/02 §3 (starter), docs/04 §4 (`gemini-embedding-001`), `retrieval_config.embedding_variant` |
| postgres / redis / minio / keycloak | `--local`: the compose-published ports and endpoints | deploy/docker-compose.yml |

## When to run it

* before every Phase 0/1 acceptance walkthrough (docs/13);
* after rotating either key (`deploy/runbooks/secret-rotation.md`) — the runbook's verification
  step *is* this script;
* when a provider outage was declared and declared recovered
  (`deploy/runbooks/provider-outage.md`).

## Why `--mock` exists

docs/02 §6: with no keys, the `local-mock` profile boots the backend against deterministic stub
adapters so UI/workflow work never depends on a paid API (this is also what CI uses). MOCK mode
must **not** hit either provider — that is the point of the flag, and it is also why a real-key
run that fails leaves a clear "run with `--mock`" hint rather than pretending.

## Notes

* The script never calls `curl`, never shells out, never writes a key to disk — providers are
  contacted over the exact SDK endpoints the Spring adapters use, so a spike pass is a real signal
  for `assistant-infra` wiring, not a mock.
* The `redis :5432`/`:6379` probes are informational when `fetch` can't speak the raw protocol —
  `docker compose ps` is the fallback; `--local` never fails the run on an undecidable TCP probe
  (it reports SKIP-equivalent rows).
