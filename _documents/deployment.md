# Deployment layout — one monorepo, two VPS projects

The GitHub repo is a single pnpm monorepo. On the VPS (`vps.codes.hr`, see
`MANAGED_PROJECT_GUIDE`) it is deployed as **two independent projects**, each with its
own image, slug, domain, port, webhook and compose stack.

| VPS project | Slug | Image | Domain | Port | DB |
|---|---|---|---|---|---|
| API + WebSockets | `mtg-table-api` | `ghcr.io/obee88/mtg-table-api:<sha>` | `api.mtg.codes.hr` | 3000 | yes |
| Web (static SPA) | `mtg-table-web` | `ghcr.io/obee88/mtg-table-web:<sha>` | `mtg.codes.hr` | 8080 | no |

The existing `mtg-table` dashboard project and `deploy.yml` get replaced by these two.

Platform facts this design depends on:

- Projects **cannot** reach each other by container name. The web app talks to the API only
  through its public HTTPS URL. Deploy the API first so its domain resolves.
- One image per project, `HEALTHCHECK` per Dockerfile, `DATABASE_URL` auto-injected only
  where the DB flag is on.
- Single host, 2 vCPU / 4 GB: one API replica; nginx for the web is negligible.

---

## Repository layout

```
mtg-table/
  package.json               pnpm workspace root; scripts: dev, build, lint, test, start
  pnpm-workspace.yaml
  .dockerignore
  apps/
    api/
      Dockerfile             context = repo root (needs packages/shared)
      src/
      drizzle/               migrations (committed)
    web/
      Dockerfile             context = repo root
      nginx.conf
      docker-entrypoint.sh   writes /usr/share/nginx/html/config.js from env
      src/
  packages/
    shared/                  types, zod protocol, pure reducers; built by both images
  compose.dev.yml            local Postgres only (never used in prod)
  .github/workflows/
    deploy-api.yml
    deploy-web.yml
  _documents/
```

`packages/shared` is never published; each image builds it from source.

---

## API project (`apps/api`)

- Fastify + `ws` on port 3000, bound to `0.0.0.0`.
- `GET /healthz` → 200 as soon as the process is listening (no DB check, so a DB hiccup
  does not fail a deploy). `GET /readyz` additionally pings Postgres, for humans/logs.
- Runs Drizzle migrations on startup, before listening. Migrations are committed in
  `apps/api/drizzle/`; the platform does not run them for us.
- Room state is in-process + event log in Postgres; one replica is the deliberate choice.
- **No Redis.** With a single API process there is nothing to share across replicas: WebSocket
  fan-out, the live room cache, per-room command serialization, rate limiting and the Scryfall
  ingest schedule all live in memory; sessions live in Postgres. A redeploy is survived by the
  event log, not by an external cache. Redis would only enter the picture with a second API
  replica, which the CPX22 host does not justify.
- Scryfall bulk ingest runs inside the API process: nightly cron, on boot when the `cards` table is
  empty, and via `POST /admin/cards/ingest[?force=true]` (status at `GET /admin/cards/ingest`). It streams
  the gzipped JSONL bulk file (~80 MB compressed) line by line and upserts in batches, so memory stays flat.

Dockerfile shape:

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @mtg/shared build && pnpm --filter @mtg/api build
RUN pnpm --filter @mtg/api deploy --prod /out   # pruned node_modules + dist

FROM node:22-alpine AS runner
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app:app /out ./
USER app
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=30s \
  CMD wget -qO- http://localhost:3000/healthz || exit 1
CMD ["node", "dist/main.js"]
```

Env vars (set in the dashboard):

| Var | Purpose |
|---|---|
| `DATABASE_URL` | auto-managed by the platform |
| `WEB_ORIGIN` | `https://mtg.codes.hr` — allowed CORS origin and WS `Origin` check |
| `PORT` | 3000 (default in image) |
| `SCRYFALL_INGEST_CRON` | UTC cron for the Scryfall card refresh; default `0 4 * * *`, empty string disables |

---

## Web project (`apps/web`)

- Vite build → static files served by **nginx** on port 8080 (unprivileged, non-root image
  `nginxinc/nginx-unprivileged:alpine`).
- nginx does **not** proxy to the API. The SPA calls `https://api.mtg.codes.hr` directly.
  This sidesteps the `host not found in upstream` crash-loop entirely and saves a hop
  through Caddy.
- The API URL is **runtime config, not a build arg**: `docker-entrypoint.sh` renders
  `config.js` (`window.__APP_CONFIG__ = { apiUrl: "$API_URL" }`) from the `API_URL` env var
  before nginx starts. Same image works for any domain; changing the domain is a dashboard
  env edit + restart, not a rebuild.
- `location = /healthz { return 200; }` for the `HEALTHCHECK`; SPA fallback `try_files … /index.html`;
  long cache headers on hashed assets, `no-cache` on `index.html` and `config.js`.

Env vars: `API_URL=https://api.mtg.codes.hr`.

---

## Auth across two origins

Web origin `https://mtg.codes.hr`, API origin `https://api.mtg.codes.hr`. These are
different *origins* but the same *site* (same registrable domain), which is what makes the
simple cookie setup work:

- Session cookie is set by the API, host-only (no `Domain` attribute), `Secure; HttpOnly; SameSite=Lax`.
- Browser sends it on `fetch(..., { credentials: 'include' })` and on the `wss://` handshake
  because the request is same-site.
- API enables CORS for exactly `WEB_ORIGIN` with `Access-Control-Allow-Credentials: true`.
- CSRF: `SameSite=Lax` plus an `Origin` header check on every mutating request and on the
  WebSocket upgrade.

Both domains share the parent `codes.hr`, so this holds for `mtg.codes.hr` + `api.mtg.codes.hr`.

Local dev mirrors this: Vite on `http://localhost:5173`, API on `http://localhost:3000`,
`WEB_ORIGIN=http://localhost:5173`, `API_URL=http://localhost:3000`. Same code path, no Vite proxy.

---

## CI: two workflows, path-filtered

`deploy-api.yml` runs on pushes to `main` that touch:

```
apps/api/**  packages/**  pnpm-lock.yaml  pnpm-workspace.yaml  package.json  .github/workflows/deploy-api.yml
```

`deploy-web.yml` is the same with `apps/web/**`. A change to `packages/shared` deploys both.
Both also accept `workflow_dispatch` for a forced redeploy.

Each workflow:

1. `meta` step: lowercase owner, 12-char sha, full image name as one output reused for
   `tags:` and the webhook body (guide pitfalls 1 and 4).
2. `docker/build-push-action@v6` with `context: .`, `file: apps/<app>/Dockerfile`,
   `cache-from/to: type=gha`.
3. Notify the dashboard with that project's `API_WEBHOOK_URL`/`API_WEBHOOK_SECRET` or
   `WEB_WEBHOOK_URL`/`WEB_WEBHOOK_SECRET` (four repo secrets total), whitespace-stripped.
4. `concurrency: deploy-<app>` so deploys of one project serialize.

Before the deploy workflows run, a `ci.yml` on pull requests and `main` runs typecheck,
lint, unit tests for all packages.

---

## Dashboard setup checklist

1. Register `mtg-table-api`: image prefix `ghcr.io/obee88/mtg-table-api`, port 3000, health
   path `/healthz`, **DB on**, domain `api.mtg.codes.hr`. Set `WEB_ORIGIN`.
2. DNS for the API domain; push → confirm healthy.
3. Register `mtg-table-web`: image prefix `ghcr.io/obee88/mtg-table-web`, port 8080, health
   path `/healthz`, DB off, domain `mtg.codes.hr`. Set `API_URL`.
4. DNS for the web domain; push → confirm the SPA loads and `/config.js` shows the API URL.
5. Add the four webhook secrets to the GitHub repo.
6. Retire the old `mtg-table` project and `deploy.yml`.

---

## Why not one container?

It would be simpler (no CORS, one workflow), and the platform supports it. Separate
projects win because: the API redeploys (and drops WebSocket connections) only when the API
changes; static assets are served by nginx with proper caching instead of Node; and the API
can later be moved or scaled independently. If the two-origin cookie setup ever becomes a
problem, the fallback is the guide's nginx `proxy_pass https://api…` pattern, which makes
the app single-origin again without changing the API.

## Outbound calls

- Scryfall bulk data (card ingest) and image CDN (hotlinked from the browser).
- Cube Cobra `https://cubecobra.com/cube/api/cubeJSON/<id>` for cube import (server-side fetch,
  ~1.5 MB per cube, on demand); its `cardID` is the Scryfall id, so printings match exactly.
