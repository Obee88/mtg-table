# UX redesign — user stories, pain points, plan

Written 2026-09-21 after the first playtests. The app works end to end, but every feature was
added as its own page, so the navigation reflects the data model (rooms, decks, cubes, formats)
instead of what a player wants to do. This document walks the main user stories through the
current UI, names what gets in the way, proposes the target flows, and orders the work.
Milestone **M9** in `plan.md` tracks it.

## Who we design for

Four friends who meet online a few evenings a month. One of them (the *host*) owns the cube and
sets things up; the others want to click as little as possible: sit down, draft, build, play.
Everyone is on a desktop browser; voice is on Discord. Nobody reads documentation.

## User stories, as they are today

Legend: **steps** = pages or dialogs a user goes through, **✗** = pain point.

### 1. "I want to play a constructed game with a friend tonight"

Today: Home → Rooms → pick a preset → Create room → (friend: Home → Rooms → finds the lobby → Open)
→ both choose a deck → Ready → host: Start game → sideboarding → mulligan → play. ~8 steps.

- ✗ "Rooms" is the only entry point and it doubles as the room *creation* form; a new user does
  not know that "Rooms" means "play".
- ✗ Room settings (players, mode, life, commander, draft format) are all shown at once, before the
  user has said what they want to do.
- ✗ No way to invite: the friend has to know to look in Rooms for an open lobby; nothing tells them
  a room is waiting.
- ✗ No deck? The lobby links to "Import a deck first", which leaves the room.

### 2. "I have a cube on Cube Cobra and want to draft it with the group"

Today: Home → Cubes → New cube → paste Cube Cobra URL → Fetch → Save cube → (share with players,
cube page) → Home → Draft formats → New format → House rules preset → pick cube + version per
phase → Create → Home → Rooms → Draft: pick the format → Create room → wait for players → Ready ×4
→ Start draft → draft → deck builder → Submit ×4 → Start game. ~15 steps across 6 pages.

- ✗ The user must *know* that a draft needs a "format", that formats are a separate section, and
  that the house rules need two cubes (tri-colour pool + main). The house preset with one cube
  silently uses the same cube twice.
- ✗ Nothing on the cube page says "draft this".
- ✗ Sharing is a card on the cube page; it is not obvious it is needed before others can use the
  cube in their own formats (they do not need it just to sit in the host's draft — but the UI does
  not say so).
- ✗ The tri-colour pool of the house rules is a second cube the host has to create by hand.

### 3. "It's my pick" / "Whose turn is it?"

Today: the draft screen shows the pack when it arrives and "Waiting for a pack from X" otherwise.
The table shows "Your turn" in the strip.

- ✗ No sound, no tab-title change, no browser notification. Players alt-tab to Discord and miss
  their pick; the whole table waits.
- ✗ In the lobby and during deckbuilding the same happens: nothing tells the host everyone is
  ready / has submitted.

### 4. "We finished; let's play another / let's stop"

Today: toolbar → New game / End game → outcome dialog → everyone confirms. Fine, but:

- ✗ The toolbar is `reveal-on-hover`; players do not find New game / End game until told.
- ✗ After End game the room closes and the user lands on a "closed" page with no next step
  (rematch, see stats, back to the table list).

### 5. "Where is the deck I drafted last week?"

Today: nowhere (planned in M8 — draft history and save-to-decks).

### 6. "I'm new here"

Today: register with an invite code → Home shows six links and the admin's invite panel.

- ✗ No first-run guidance: the useful first step is "import a deck" or "join a room", not "browse
  cards".

## Principles for the redesign

1. **Navigation by intent, not by table.** Top-level: **Play**, **Decks**, **Cubes**, **Stats**.
   "Rooms" and "Draft formats" stop being destinations; they live inside Play and Cubes.
2. **One primary action per screen**, visible without hovering. Secondary actions can hide.
3. **Wizards for setup, not forms.** Creating a game/draft asks one question per step, in the
   order a host thinks: *what* → *with which cube/format* → *how many players* → *invite*.
4. **The cube is the hub for drafting.** Formats belong to a cube; "Draft this cube" is a button on
   the cube page and the default format is the house rules.
5. **Tell people when it is their move.** Title flash, optional sound, browser notification (opt-in).
6. **Nothing is lost silently** (already: import drafts survive; extend to lobby/deckbuilding
   state on reconnect, which the event stream gives us for free — make it visible).

## Target flows

### App shell

Persistent top bar: logo · **Play** · **Decks** · **Cubes** · **Stats** · (admin: Invites) ·
user menu. The game and draft screens keep their full-viewport layout (no shell) with a "Leave"
in the log column, as now.

### Play (home)

- **Now**: rooms I am seated in, with state ("drafting · your pick", "lobby · 2/4", "playing ·
  game 2") and a **Rejoin** button. Open lobbies of the group with **Join**.
- **Start something**: two big buttons, **New game** and **New draft**, opening the wizard.
- Recent results (last few games) as a small list; link to Stats.

### New game / New draft wizard (one dialog, 3–4 steps)

1. *Game* → players (2 / 4), mode (1v1, FFA, 2v2), life, commander — presets as chips.
   *Draft* → cube (own + shared; "add a cube" inline) → format: **House rules** (default; asks for
   the tri-colour pool cube, or offers to generate it from the cube's multicolour cards), one of the
   cube's saved formats, or *Custom…* (opens the format editor pre-bound to this cube) → players.
2. Name (defaulted as M8 specifies) and seats: **open** (anyone in the group can sit) or
   **reserved** (pick players; they get a notification and see it under "Now").
3. Create → lobby.

### Lobby

One column: seats with avatars/names and readiness; the host's **Start** button is the only
primary action and explains what blocks it ("Waiting for Bob to choose a deck"). Deck choice for
constructed games is inline (recent decks + "import…" in a dialog, not a page change). Copyable
invite link.

### Cube page

Header: name, owner, **Draft this cube** (primary), share. Tabs: **List** (editor as now),
**Versions**, **Formats** (the cube's saved formats; "House rules" always present), **Stats**.
"New cube" keeps the two paths (Cube Cobra link, paste), reachable from Cubes and from the wizard.

### Draft, deckbuilding, table

Mostly as now, plus: attention cues (title "● Your pick", optional sound, notification), a visible
**End game / New game** in the strip (not hover-only), image size slider (M8), auto basics (M8),
and an end-of-game card ("Bob won game 2 · Play again · Stats") instead of the closed-room page.

### Decks

List with import (link or paste) and, from M8, drafted decks saved from draft history.

## Plan of work (M9)

Ordered so each step is shippable and useful on its own; each is one `/go-next` run unless split.

1. **Analysis sign-off** — this document; walk through it with the group, adjust the target flows.
   Deliverable: this file updated, open questions resolved.
2. **App shell and Play home** — top bar, Play page with "Now" and "Start something"; Rooms list
   folded into it; old routes redirect.
3. **New game / New draft wizard** — replaces the room-creation form; formats picked per cube;
   house rules default; player count chosen here (M8 item 1 lands with it).
4. **Cube as hub** — "Draft this cube", Formats tab, tri-colour pool helper; the Draft formats page
   becomes the cube's Formats tab (direct links keep working).
5. **Lobby rework** — single column, blocking reasons, inline deck pick with import dialog, invite
   link, reserved seats.
6. **Attention cues** — tab title, sound (off by default), browser notifications (opt-in), for:
   your pick, your turn, everyone ready / submitted, result to confirm.
7. **End-of-game card** and Play-again; Stats entry points from results.
8. **Visual pass** — consistent chips/buttons/dialogs, empty states, first-run hints on Play and
   Decks for a new account.

Out of scope here: mobile/tablet layouts (M7 item), the table's card interactions (settled in
`table-design.md`).

## Open questions for the group

- Should open lobbies be visible to everyone in the group by default (today: yes), or only to
  reserved players?
- Sound on by default for "your pick"? (Proposal: off, one-click enable in the draft screen.)
- Keep "Draft formats" reachable as its own page for people who like to tune formats, or only via
  the cube's Formats tab? (Proposal: via the cube only, plus a link from Play → New draft → Custom.)
