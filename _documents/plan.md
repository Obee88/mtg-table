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
| Draft config | Saved, user-owned recipe: ordered phases; each phase has a type (pick-and-pass, Winston, Grid, Winchester, Rotisserie), a pool (a cube version), and type-specific settings. House rules = one preset. Shareable with other players. Its seat count is only a default: the room's player count re-seats the format (`withRoomSeats`, applied by the reducer). |
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

- Phase types share one `DraftState` (packs, pools, pick log) with a per-type slot: pick-and-pass uses `packs` + per-seat queues; Winston keeps its stack in a pack and its piles in `winston`. `openRound`/`advance` in the reducer dispatch on `phase.type`; Grid, Winchester and Rotisserie follow the same pattern.
- **Draft ability hooks** (Cogwork Librarian): pool cards get a `DraftAbility` by card name when the pools are loaded (`draftAbilityFor`). `librarian`: always drafted face up; `usableLibrarians(state, player)` offers "take two from the pack at hand, put the Librarian in" (`draftPick.librarian`), emitted as two held picks plus `draftCardReturned`, which passes the pack. Uneven pack sizes are supported by design: packs are arrays, not fixed-size slots.
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
- `cubes(id, owner_id, name)` · `cube_versions(id, cube_id, number, note, created_by, created_at)` · `cube_version_cards(version_id, card_id, quantity)` — every save is a full snapshot (migration 0005)
- `draft_configs(id, owner_id, name, config)` — saved recipes; a room copies the config into its settings at creation (migration 0007) · `draft_config_members(config_id, user_id)` (0011)
- `cube_members(cube_id, user_id)` — players a cube is shared with (0010)
- `decks(id, owner_id, name, json)` — main / sideboard / commander as printing ids
- `rooms(id, owner_id, name, settings_json, phase, created_at)` — a draft room is a room whose settings carry a `draft` config; phase runs lobby → drafting → deckbuilding → playing → ended · `room_players(room_id, user_id, seat)`
- `room_events(room_id, seq, actor_id, type, payload, created_at)` · `room_snapshots(room_id, seq, state)`
- `draft_picks(room_id, overall_pick, player_id, card_id, cube_version_id, phase, round, pack_id, pick_in_pack, pack_contents, double_pick)` — denormalized from `draftPicked` events for stats (migrations 0006, 0009)
- `game_results(room_id, game_number, reported_by, winners, mode, player_count, commander, draft_name, players[seat, team, deck], note)` — one row per reported game, replaced on re-report; decks captured as they sat at the table (migration 0008)

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
- [x] Web deck pages: paste/upload, validation errors, printing picker, deck list

**M2 — 1v1 table (first playable)**
- [x] Room model: event log + snapshots in Postgres, shared reducer skeleton, per-room command queue
- [x] WebSocket transport: cookie auth, subscribe, command/event protocol, reconnect with `lastSeq`
- [x] Lobby: create/join room, seats, deck selection, ready, start (shuffle, draw 7, roll for first)
- [x] Minimal table UI: own and opponent zones, hand, drag between zones, click to tap — cards on screen
- [x] Visibility projection per player (state and events), with tests proving hidden cards never leak
- [x] Core card actions: move between zones, tap/untap, untap all, draw, shuffle, mulligan
- [x] Card state: transform, flip, face-down, counters, attachments, notes, tokens
- [x] Player state: life, poison, custom counters; server dice/coins; game log events
- [x] Reveal/look/search actions and reveal durations
- [x] Undo of own last action (compensating event)
- [x] Optimistic updates with reconciliation on the client
- [x] Table UI polish: context menu, hover preview, keyboard shortcuts, multi-select
- [x] Log panel, change highlights, move/tap/reveal animations
- [x] Playtest round with the group; fix list (2026-09-19: design session + fixes shipped live)

**M3 — 4 players**
- [x] 4-player FFA rooms, quadrant layout, focus mode (1–4, Esc), own board as strip when zoomed
- [x] 2v2 shared life, teammate hand visibility, diagonal seating
- [x] Commander zone, tax, commander damage; format presets (20 / 30 / 40 / custom)
- [x] Battlefield rows (lands / creatures / other) and grouping of identical tokens

**M4 — Cubes**
- [x] Cube model with versions; create/edit as printings; paste-list import
- [x] Cube Cobra import
- [x] Printing picker per cube card
- [x] Version history: diff any two versions, restore

**M5 — Draft**
- [x] Draft engine core (a): pure model in shared — config, pick-and-pass phase, dealing, pass-direction rule, pick log with pack context, projection
- [x] Draft engine core (b): server integration — draft rooms over the event stream, pools from cube versions, draft_picks table, routes, socket, tests
- [x] Draft config editor and the house-rules preset (phase 1 tri-color pool + phase 2 main cube)
- [x] Draft ability hooks with Cogwork Librarian
- [x] Draft UI: packs, pass direction / pick counter, face-up picks per seat, sortable pool
- [x] Deckbuilding step (main / sideboard / free basics) and handoff to the table with fixed seats

**M6 — Stats**
- [x] Report-result step and `game_results`
- [x] Cubes and draft formats can be shared with other players (cube_members, draft_config_members): members use them for drafts and formats, read-only; `GET /users` lists the group
- [x] Sideboarding step before every game (swap by printing from the server-side deck list, everyone finishes, changed decks redraw), draft decks need 40 cards with basics
- [x] End game / new game from the toolbar: anyone proposes who won (or "nobody won — don't track"), every seat confirms, then the room ends or new hands are dealt
- [x] Card stats per cube/version (avg pick, pick-rate-when-seen, first-pick rate, most-passed)
- [x] Player stats (W/L per format, head-to-head, draft tendencies, deck history)

**M7 — Later**
- [x] Winston phase type (stack + piles, take or pass, blind take from the stack)
- [x] Grid phase type (face-up square grids, take a row or column, first pick rotates)
- [x] Winchester phase type (face-up piles, take one, every pile grows from the stack)
- [x] Rotisserie phase type (whole pool face up, snake order, one card per pick)
- [x] Moxfield / Archidekt import
- ~~Passkeys / YubiKey~~ — dropped (email + password is enough for the group)
- [x] Tablet (a): touch input on the table — long-press opens context menus, cards drag and drop by touch, hover-only controls stay visible on touch screens
- [x] Tablet (b): tablet-sized layout — log column as an overlay on narrow screens, larger touch targets, safe areas
- [x] Tablet (c): draft and deckbuilding screens on touch
- [x] Card win-rate stats

**M8 — Draft sessions and deckbuilding comfort** (requested 2026-09-21)
- [x] Seats out of the draft config: a format’s seat count becomes its *default*; the player count is chosen when creating the room, on the same screen as the format
- [x] Named drafts: starting a draft asks for a name, defaulting to "<format> · <n> players · <date> · <player names>"; stored on the room
- [x] Draft history: a page listing past drafts (name, date, format, players) where a player can open their drafted pool / deck and save it to their deck list
- [x] Card image size slider in the deck builder (drafted pool / main / sideboard); reuse the control on the draft pack view and the table if it proves useful — done for the pools and the pack view; the table keeps sizing cards to fit the area
- [x] Taplands: a group-wide list of lands that always enter tapped (by card name, with rules-text suggestions on the deck pages); the table taps them on arrival (2026-09-22)
- [x] Turn one: in a duel the first player starts at the first main phase; in multiplayer at the draw step (2026-09-22)
- [x] "Auto basics" in the deck builder: fills the remaining slots up to 40 with basic lands in the ratio of coloured mana symbols in the main deck's mana costs (colourless-only deck → Wastes if the database has them, else an even split)

**M9 — UX redesign** (analysis in `_documents/ux-redesign.md`, written 2026-09-21)
- [x] Analysis sign-off: walk the user stories and target flows in `ux-redesign.md` with the group; resolve its open questions; update the document (signed off 2026-09-22; decisions recorded at the end of the document)
- [x] App shell (Play · Decks · Cubes · Stats) and the Play home: rooms I am in with state and Rejoin, open lobbies with Join, New game / New draft; old routes redirect
- [x] New game / New draft wizard replacing the room-creation form: what → cube → format (house rules default, cube's saved formats, custom) → players → name → create
- [x] Reserved seats: the wizard's last step offers open (anyone in the group) or reserved (named players); the lobby only lets those sit; Play shows the reservation
- [x] Cube as the drafting hub: Draft this cube, Formats tab (formats belong to a cube); Draft formats page folds into it
- [x] Tri-colour pool helper: generate the house-rules pool cube from the cube's multicolour cards (from the cube page and the wizard's House rules step)
- [ ] Lobby rework: single column, blocking reasons on Start, inline deck pick with import dialog, invite link, reserved seats
- [ ] Attention cues: tab title, optional sound, opt-in browser notifications for your pick / your turn / everyone ready / result to confirm
- [ ] End-of-game card with Play again and Stats links instead of the closed-room page
- [ ] Visual pass: consistent chips, buttons, dialogs, empty states, first-run hints for a new account

---

## Still open

- ~~Production domains~~ — decided: `mtg.codes.hr` (web, DNS already set) + `api.mtg.codes.hr` (API, DNS to be added).
- Pick timer in drafts? (Assumed no for a private group; easy to add as a phase setting.)
- ~~Default printing rule for decklist imports~~ — decided 2026-09-19: oldest English paper non-promo printing.
