# mtg-table

Online Magic: The Gathering table (no rules engine) with cube drafting. Product notes in
`_documents/idea.md`, architecture and milestones in `_documents/plan.md`, hosting in
`_documents/deployment.md`. Read `plan.md` before starting a milestone.

## Layout

- `apps/api` — Fastify + WebSockets, Drizzle/Postgres. Deployed as VPS project `mtg-table-api`.
- `apps/web` — React + Vite SPA served by nginx. Deployed as `mtg-table-web`.
- `packages/shared` — zod schemas, wire types, pure game/draft logic shared by both.

## Commands

- `pnpm db:up` — local Postgres (Docker). Copy `apps/api/.env.example` to `apps/api/.env`.
- `pnpm dev` — API on :3000, web on :5173 (run `pnpm --filter @mtg/shared build` once first).
- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` — what CI runs.
- `pnpm --filter @mtg/api db:generate` — new migration after editing `apps/api/src/db/schema.ts`.

## Conventions

- Migrations are committed in `apps/api/drizzle/` and run automatically at API start.
- API tests use PGlite (in-memory Postgres) via `apps/api/src/test/`; no database needed.
- The web app calls the API by absolute URL from `window.__APP_CONFIG__.apiUrl` (`public/config.js`
  in dev, rendered from `API_URL` by the nginx entrypoint in prod). No Vite proxy.
- Push to `main` deploys; `deploy-api.yml` / `deploy-web.yml` are path-filtered.
