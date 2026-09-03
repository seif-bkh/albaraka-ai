# Al-Mouchir — front & back office (Angular 22)

Angular 22 workspace serving two apps plus one shared library, styled with an
Al Baraka-inspired green / gold / cream design system:

| App | Port | Description |
| --- | --- | --- |
| `frontoffice-web` | 4200 | Public assistant chat (FR primary + AR RTL + EN), SSE streaming, citations, refusals REF-01/03/04/05, feedback |
| `backoffice-web` | 4201 | Admin console: dashboard, document library, Sharia review (two-eyes), prompts, models, audit chain, feedback |
| `shared-ui` | — | Design tokens (`brand.scss`) + i18n dictionary + markdown renderer |

## Run

```bash
npm install                    # first time
npm run build:ui               # build shared-ui (required by the apps)

# Terminal 1 — backend (Express + embedded PostgreSQL, port 8080)
cd ../server && npm run dev

# Terminal 2 — this workspace
npm run serve:fo               # http://localhost:4200
npm run serve:bo               # http://localhost:4201
```

Both dev servers proxy `/api/*` to `http://127.0.0.1:8080` (`proxy.conf.json`)
and bind `0.0.0.0` so the sandbox live preview can reach them.

## Dev users (demo auth)

`admin@albaraka.tn / Admin#123` · `sharia@albaraka.tn / Sharia#123` ·
`reviewer@albaraka.tn / Review#123` · `compliance@albaraka.tn / Compliance#123` ·
`agent@albaraka.tn / Agent#123`

## Contracts

- `frontoffice-web/src/app/api.ts` — SSE client (`event:` frames
  `accepted → status* → sources → token* → answer|refusal|error → done`).
- `backoffice-web/src/app/admin-api.ts` — `/api/v1/admin/*` client.
- Both consume the documented API: `specs/openapi.yaml` in the repository root.
