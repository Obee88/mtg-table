# MTG Virtual Table — Plan

Companion to [idea.md](idea.md). This records the decisions made on 2026-09-18, the
architecture, the data model, and the milestone order. Update it when decisions change.

---

## Decisions so far

| Topic | Decision |
|---|---|
| Stack | TypeScript everywhere. Node server (Fastify + `ws`), React + Vite client, shared package for types/protocol/pure logic. pnpm monorepo. Postgres via Drizzle. |
| Deployment | One monorepo, **two VPS projects**: `mtg-table-api` (Fastify + WS, Postgres, migrations at boot) and `mtg-table-web` (nginx serving the Vite build, API URL as runtime config). Separate images, workflows, domains. Details in [deployment.md](deployment.md). |
| Users | Private, invite-only. Email + password to start (argon2, cookie sessions). Passkeys/WebAuthn later on the same account model. Real accounts only — no guest seats. |
| Persistence | Everything survives restarts. Rooms are event-sourced: append-only event log in Postgres + periodic snapshots. Reconnect replays from last seen sequence number. |
| First milestone | 1v1 pre-constructed table (paste two decklists, play). Draft engine is built on top of the working table. |
| Cube | A cube is a list of **specific printings** (Scryfall print IDs), so the artwork shown at the table is fixed by the cube. Users create/edit their own cubes; versioned. |
| Draft config | Saved, user-owned recipe: ordered phases; each phase has a type (pick-and-pass first; Rotisserie, Winston, Grid, Winchester later), a pool (a cube version), and type-specific settings. House rules = one preset. |
| Card images | Hotlinked from Scryfall CDN (no object storage on the platform). Card metadata ingested from Scryfall bulk data into Postgres. |

### House draft, corrected

- **Phase 1** — pool: separate 20-card tri-color list (its own cube). 4 packs × 5 cards, pick-and-pass until empty → 5 cards each.
- **Phase 2** — pool: the main cube (~360). Shuffle, deal **12 packs × 15**; the remaining cards stay unopened. 3 rounds, one pack per player per round → 45 cards each.
- **Pass direction** flips every round, across phases: phase 1 right → phase 2: left, right, left. Starting direction is a config setting.
- Result: 50 drafted cards + any number of basic lands for free at deckbuilding.

---

## Architecture

```
apps/
  api/           Fastify HTTP + ws, auth, rooms, draft/game engines, Scryfall ingest  → mtg-table-api
  web/           React + Vite SPA, served by nginx                                    → mtg-table-web
packages/
  shared/        Types, wire protocol (zod), pure game/draft reducers, visibility projection
```

The web app calls the API by public URL (`https://api.<domain>`); the two are different origins on the same site, so a host-only `SameSite=Lax` session cookie plus CORS for the web origin is enough. See [deployment.md](deployment.md).

### Server-authoritative, event-sourced rooms

- A **room** is the unit of state (lobby → draft → deckbuilding → game). It has an append-only stream of `events` with a per-room sequence number.
- Clients send **commands** (`tapCard`, `moveCard`, `pick`, `rollDice`, …). The server validates against current state, appends one or more events, persists them, then broadcasts.
- **State = reduce(events)**. Reducers live in `packages/shared` so the client can run the same code for optimistic prediction. Snapshots every N events keep replay fast.
- **Projection per player.** Before sending, state is projected through a visibility filter: hidden cards are sent as `{ instanceId, faceDown: true }` with no identity; libraries are sent as counts plus whatever is revealed. The projection is the only thing that leaves the server, so hidden information cannot leak by accident.
- **Optimistic UI.** The client applies the predicted event locally with a tentative seq; the server's authoritative event replaces it. On mismatch the client re-syncs from the last confirmed seq.
- **Reconnect.** Client sends `lastSeq`; server sends missing events (or a fresh snapshot if too far behind).
- **Undo.** Own last action only: the server appends a compensating event (visible in the log), never deletes history.
- **Randomness** (shuffles, dice, coin flips, pack dealing) happens server-side with a CSPRNG and is logged.

### Visibility model

Every card instance carries `visibleTo: 'owner' | 'all' | PlayerId[]`, plus an optional `revealUntil: 'dismissed' | 'zoneChange'`. Every reveal/look/search action is just an edit to this list; the projection does the rest. Team mode (2v2) adds teammates to `owner` visibility for hands.

### Card state (per instance)

`printingId`, `ownerId`, `controllerId`, `zone`, `position` (order in zone / xy on battlefield), `tapped`, `transformed`, `flipped`, `faceDown`, `counters: Record<string, number>`, `attachedTo`, `note`, `isToken`, `visibleTo`, `revealUntil`.

Player state: `life` (or team life), `poison`, `counters: Record<string, number>`, `commanderTax`, `commanderDamage: Record<PlayerId, number>`. Counters use one mechanism for cards and players.

### Draft engine

```
DraftConfig { name, ownerId, seats: 2|4, phases: Phase[] }
Phase { type, poolCubeVersionId, settings }
PickAndPassSettings { packSize, packsPerPlayer, rounds, direction: 'alternate' | 'left' | 'right', startDirection }
```

- Phase types are plugins implementing `start(pool, seats) → state`, `legalActions(state, player)`, `apply(state, action) → events`. Pick-and-pass first; Rotisserie, Winston, Grid, Winchester later.
- **Draft ability hooks** (Cogwork Librarian): a card in the pool can register hooks — `onPicked` (mark face-up, attach to seat), `extraPickOptions(state, player)` (offers "take two, put Librarian in pack"). Uneven pack sizes are supported by design: packs are arrays, not fixed-size slots.
- **Every pick is logged with context**: pack contents at that moment, pick number within pack, overall pick number, player, whether it was a double pick. Stats are derived later from this log, never computed inline.
- Seats are fixed from draft through game; 2v2 teammates sit diagonally.

### Card data

- Nightly (or manual) ingest of Scryfall `default_cards` bulk JSON into a `cards` table: `scryfall_id`, `oracle_id`, `name`, `set`, `collector_number`, `layout`, `faces[] (name, image URIs, type line, mana cost)`, `is_token`, `released_at`.
- Decklist import: parse `4 Lightning Bolt` (+ optional `(SET) 123`), resolve names → oracle ids, pick a default printing (latest non-promo) unless specified; report unknown names.
- Show Scryfall attribution and follow the Fan Content Policy / Scryfall image guidelines before going public.

### Auth & accounts

`users(id, email, password_hash, display_name, created_at)`, `invites(code, created_by, used_by, expires_at)`, `sessions`. Passkeys later: `webauthn_credentials` table, same `users` row.

---

## Data model (Postgres, initial)

- `users`, `invites`, `sessions`
- `cards` (Scryfall printings cache)
- `cubes(id, owner_id, name)` · `cube_versions(id, cube_id, number, note, created_by, created_at)` · `cube_version_cards(cube_version_id, card_id, qty)`
- `draft_configs(id, owner_id, name, json)`
- `decks(id, owner_id, name, json)` — main / sideboard / commander as printing ids
- `rooms(id, owner_id, kind, settings_json, status, created_at)` · `room_players(room_id, user_id, seat, team)`
- `room_events(room_id, seq, actor_id, type, payload, created_at)` · `room_snapshots(room_id, seq, state)`
- `draft_picks(room_id, seq, player_id, card_id, pack_contents, pick_no, overall_pick_no, double_pick)` — denormalized from events for stats
- `game_results(room_id, reported_by, winners, json)`

---

## UI approach

- React + Vite, Tailwind + a small in-repo component set (buttons, menus, dialogs, tooltips via Radix primitives). Design tokens (colors, spacing, radii) defined in one file from the start.
- Table: CSS-transform zoomable canvas. Quadrant layout for 4 players, focus mode (click / keys 1–4 / Esc), own board as a strip when zoomed on someone else. Reassess PixiJS only if DOM gets slow.
- Interactions: click = tap/untap, drag = move between zones, right-click/long-press = context menu, keyboard shortcuts shown in menus, multi-select.
- Hover preview of full card; grouped identical tokens; battlefield rows (lands / creatures / other).
- Log panel always reachable; brief highlight on the area where something changed.
- Desktop browser first.

---

## Progress

Ordered checklist. `/go-next` takes the first unchecked item. Split an item in place if it is too big for one run.

**M0 — Foundation**
- [x] Monorepo scaffold, dev setup, Dockerfiles, CI + path-filtered deploy workflows
- [x] Email/password auth, sessions, admin invites, first-account bootstrap
- [x] Both projects live on mtg.codes.hr / api.mtg.codes.hr
- [x] Build sha exposed at `/healthz` (API) and `/version.txt` (web) for deploy verification

**M1 — Cards & decks**
- [x] Scryfall bulk ingest into a `cards` table (streaming parse, admin-triggered endpoint, nightly schedule)
- [x] Card search endpoint (name autocomplete, printings per oracle id) and a web card search page with hover preview
- [x] Decklist parser in `packages/shared` (`4 Lightning Bolt`, optional `(SET) 123`, sideboard/commander sections) with tests
- [x] Deck import endpoint: resolve names → printings, report unknown names; saved decks CRUD
- [ ] Web deck pages: paste/upload, validation errors, printing picker, deck list

**M2 — 1v1 table (first playable)**
- [ ] Room model: event log + snapshots in Postgres, shared reducer skeleton, per-room command queue
- [ ] WebSocket transport: cookie auth, subscribe, command/event protocol, reconnect with `lastSeq`
- [ ] Visibility projection per player, with tests proving hidden cards never leak
- [ ] Lobby: create/join room, seats, deck selection, ready, start (shuffle, draw 7, roll for first)
- [ ] Core card actions: move between zones, tap/untap, untap all, draw, shuffle, mulligan
- [ ] Card state: transform, flip, face-down, counters, attachments, notes, tokens
- [ ] Player state: life, poison, custom counters; server dice/coins; game log events
- [ ] Reveal/look/search actions and reveal durations
- [ ] Undo of own last action (compensating event)
- [ ] Table UI: zone layout, drag & drop, click to tap, context menu, hover preview, keyboard shortcuts, multi-select
- [ ] Optimistic updates with reconciliation on the client
- [ ] Log panel, change highlights, move/tap/reveal animations
- [ ] Playtest round with the group; fix list

**M3 — 4 players**
- [ ] 4-player FFA rooms, quadrant layout, focus mode (1–4, Esc), own board as strip when zoomed
- [ ] 2v2 shared life, teammate hand visibility, diagonal seating
- [ ] Commander zone, tax, commander damage; format presets (20 / 30 / 40 / custom)
- [ ] Battlefield rows (lands / creatures / other) and grouping of identical tokens

**M4 — Cubes**
- [ ] Cube model with versions; create/edit as printings; paste-list import
- [ ] Cube Cobra import
- [ ] Printing picker per cube card
- [ ] Version history: diff any two versions, restore

**M5 — Draft**
- [ ] Draft engine core: phases, pick-and-pass type, pack dealing, pass-direction rule, pick log with pack context
- [ ] Draft config editor and the house-rules preset (phase 1 tri-color pool + phase 2 main cube)
- [ ] Draft ability hooks with Cogwork Librarian
- [ ] Draft UI: packs, pass direction / pick counter, face-up picks per seat, sortable pool
- [ ] Deckbuilding step (main / sideboard / free basics) and handoff to the table with fixed seats

**M6 — Stats**
- [ ] Report-result step and `game_results`
- [ ] Card stats per cube/version (avg pick, pick-rate-when-seen, first-pick rate, most-passed)
- [ ] Player stats (W/L per format, head-to-head, draft tendencies, deck history)

**M7 — Later**
- [ ] Rotisserie / Winston / Grid / Winchester phase types
- [ ] Moxfield / Archidekt import
- [ ] Passkeys / YubiKey
- [ ] Tablet layout
- [ ] Card win-rate stats

---

## Still open

- ~~Production domains~~ — decided: `mtg.codes.hr` (web, DNS already set) + `api.mtg.codes.hr` (API, DNS to be added).
- Pick timer in drafts? (Assumed no for a private group; easy to add as a phase setting.)
- Default printing rule for decklist imports when none is specified (assumed: latest non-promo printing).
