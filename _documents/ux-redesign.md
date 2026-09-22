# UX redesign — user stories, pain points, plan

Written 2026-09-21 after the first playtests. The app works end to end, but every feature was
added as its own page, so the navigation reflects the data model (rooms, decks, cubes, formats)
instead of what a player wants to do. This document walks the main user stories through the
current UI, names what gets in the way, proposes the target flows, and orders the work.
Milestone **M9** in `plan.md` tracks it.

**Signed off 2026-09-22** by the host on behalf of the group: the stories and target flows below
stand as written, with the three open questions settled under *Decisions* at the end. Pain points
that M8 and the table work of 2026-09-21/22 already removed are marked *(fixed)* in place, so the
remaining ✗ marks are the actual scope of M9.

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

Today: game panel ⋯ menu → New game / End game → outcome dialog → everyone confirms. Fine, but:

- *(fixed 2026-09-21)* ~~The toolbar is `reveal-on-hover`; players do not find New game / End game
  until told.~~ They now live in the game panel's menu, always visible; the tools row (token, dice,
  undo, help) sits in the log column.
- *(fixed 2026-09-21)* ~~After End game the room closes~~ — the room returns to the lobby with the
  result recorded; a new game can start from there. What is still missing is a proper end-of-game
  card (who won, Play again, Stats) instead of the bare lobby: ✗ stays for M9 step 7.

### 5. "Where is the deck I drafted last week?"

*(fixed 2026-09-22, M8)* Home → Past drafts lists every draft with name, date, format and players;
opening one shows the drafted deck (or pool) in the deck editor with **Save to my decks**.

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

Mostly as now, plus: attention cues (title "● Your pick", optional sound, notification) and an
end-of-game card ("Bob won game 2 · Play again · Stats") shown over the lobby the room returns to.
Already there: End game / New game in the game panel menu, the tools row in the log column, the
phase bar with jump-to-step, the image size slider and auto basics (M8), taplands, extra turns,
the UI preferences dialog (per-browser toggles; the sound and notification switches of step 6 go
in there too).

### Decks

List with import (link or paste), the Taplands panel, and drafted decks saved from Past drafts
(M8). Past drafts stays reachable from Play and from the user menu.

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

## Decisions (2026-09-22)

Resolved with the host, standing in for the group; each one binds the M9 step it names.

1. **Open lobbies are visible to everyone in the group** (as today). A lobby created with
   *reserved* seats still shows on Play for everyone, but only the named players can sit; the rest
   see "reserved" on the seats. — *Steps 2 and 5.*
2. **Sound is off by default.** "Your pick" and "your turn" get the tab-title cue always; the chime
   and browser notifications are opt-in switches in the UI preferences dialog (already in the game
   menu), remembered per browser; the draft screen carries a one-click speaker toggle for the
   same switch. — *Step 6.*
3. **Draft formats belong to their cube.** The standalone Draft formats page goes away: formats are
   edited on the cube's Formats tab and created from the wizard's *Custom…* step, pre-bound to the
   chosen cube. `/drafts` and `/drafts/:id` redirect to the owning cube's Formats tab (a format
   with pools from several cubes opens on the first pool's cube). Past drafts (`/drafts/history`)
   is unaffected. — *Steps 3 and 4.*
