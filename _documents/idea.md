# MTG Virtual Table — Project Notes

## Vision

An online platform where 2 or 4 players meet at a shared Magic: The Gathering table. There is **no rules engine**: the app tracks cards, zones, and player state, and players enforce the rules themselves, exactly like at a physical table. Voice communication happens in a third-party app (Discord etc.), so audio is out of scope.

A major focus is **cube drafting**, including our specific house draft rules, plus a pre-constructed mode.

**The UI is the product.** If it's fast, clear, and pleasant, people will use it. If not, they'll quit.

---

## Core Architecture

- **Server-authoritative state.** The server holds the true game and draft state and sends each player only what they're allowed to see. Hidden information (hands, libraries, face-down cards, other players' draft picks, unopened packs) must never reach a client that can't see it.
- **Real-time sync** via WebSockets.
- **Optimistic UI updates:** the client updates instantly, the server confirms in the background.
- **Card data and images** from the Scryfall API. Check Wizards' Fan Content Policy before going public.
- **Auth:** email + password to start; passkeys / WebAuthn (YubiKey 5C NFC) later on the same account model. Private, invite-only; real accounts only.
- **Prior art to study:** Cockatrice, Untap.gg, SpellTable, Cube Cobra.

---

## Game Room & Setup

A room is configured with:

- **Player count:** 2 or 4.
- **Game mode:**
  - 1v1
  - 4-player free-for-all
  - 2v2 with shared life total (Two-Headed Giant style: team shares life, teammates can see each other's hands)
- **Deck source:** house draft, other draft presets (future), or pre-constructed.
- **Format preset** that sets starting values at once (20 standard, 30 Two-Headed Giant, 40 Commander, or custom).
- **Commander zone:** optional toggle. When on, also enables commander tax and commander damage tracking.

The table itself doesn't care where decks came from; all modes share the same game screen.

### Seating

- Seats are fixed for the whole session, both during the draft and at the table.
- In 2v2, **teammates always sit diagonally** (across from each other), so both neighbors are opponents.
- The table layout places players in the same positions they had while drafting.

---

## Zones

Per player:

- Library
- Hand
- Battlefield
- Graveyard
- Exile (supports face-down cards)
- Command zone (optional, per room setting)

---

## Card State

Every card instance has its own state, separate from printed card data:

- **Tapped / untapped** (rotated 90°)
- **Transformed** (double-faced cards, showing back face)
- **Flipped** (Kamigawa-style flip cards, rotated 180°)
- **Face-down** (morph, manifest, etc.; only owner can see the identity)
- **Counters** of any type, multiple types per card
- **Attachments** (auras and equipment stacked visually on their host)
- **Notes** (free-text label, e.g. "copy of X")

Tokens use the same model but disappear when they leave the battlefield.

---

## Player State

Tracked per player (or per team in shared-life mode), visible to all:

- Life total (quick +/− control, history in log)
- Poison counters (loss at 10 per player, 15 per team in 2HG)
- Library size (automatic)
- Hand size (count only)
- Commander tax and commander damage per opponent (when commander is enabled)
- Custom named counters (energy, experience, anything else)

### Counters: one shared mechanism

Counters work identically on cards and players. No special-casing per counter type. Every change goes to the game log.

---

## Game Actions

- Draw, shuffle, move cards between zones
- Tap/untap, untap all
- Transform, flip, turn face-down/up
- Add/remove counters
- Create tokens
- Attach/detach
- Adjust life and player counters

### Reveal & Visibility

Each card carries a **visibility list** (owner only, specific players, or everyone). Every reveal action just edits that list, and the server only sends card identities to players on it.

Actions:

- Reveal whole hand to one player or everyone
- Reveal a specific card from hand
- Reveal top N cards of library
- Look at top N privately (scry/surveil), then reorder or send to top/bottom/graveyard
- Keep top card of library permanently revealed
- Search library for a card, optionally reveal it
- Let an opponent view your hand and choose a card from it

Reveal duration: momentary (until dismissed) or until the card changes zones.

### Dice & Coins

- One-click d6, d20, coin flip; custom dN and multiple dice (e.g. 3d6)
- Rolls happen on the server so results can't be faked
- Every roll is logged and visible to all
- "Roll for first player" option at game start

### Game Log

Every action, reveal, counter change, life change, and roll is logged and scrollable.

---

## Drafting

### Draft Engine (configurable)

Build drafts from configurable phases rather than hard-coding formats:

- Phase type (pick-and-pass first; Rotisserie, Winston, Grid, Winchester later)
- Pool source: a cube (version) per phase
- Pack size, packs per player, number of rounds
- Pass direction rule (alternate every round, or fixed)
- Seating rules
- **Draft ability hooks** for draft-matters cards

A draft configuration is saved per user and reusable when creating a game. Our house rules become one saved preset; other formats become others.

Every pick is recorded with full context (pack contents at that moment, pick number, player) so new statistics can be added later.

### House Draft Rules (4 players)

**Phase 1: three-colored cards**

- A pool of 20 three-colored cards is split into 4 packs of 5.
- Each player picks one card and passes, until all cards are taken.
- Each player ends with 5 cards, which join their pool for the main draft.

**Phase 2: main cube draft**

- The ~360-card cube is shuffled and **12 packs of 15** are dealt; the rest stays unopened.
- 3 rounds of pick-one-and-pass, **one pack per player per round**.
- Each player ends with 45 cards from phase 2 + 5 from phase 1 = 50 drafted cards.

**Pass direction** flips every round, across phases: phase 1 right → phase 2 round 1 left → round 2 right → round 3 left. The starting direction is a setting.

### Cogwork Librarian (draft ability)

- Drafted **face up**: everyone sees who has it.
- On any later pick, the holder may take two cards from the current pack and put Cogwork Librarian into that pack. The pack keeps passing, so another player can pick it and use it again.
- Engine requirements:
  - Face-up picks shown next to each player's seat in the draft UI
  - "Use Librarian" option on the pick screen, only for the current holder
  - Handle uneven pack sizes (packs no longer shrink in lockstep)
  - Log each use (who, which pack, which two cards); double picks shouldn't distort pick-position stats
- Implement as a general draft ability hook so other draft-matters cards can be added later.

### Future Draft Types

- More 4-player formats
- Rotisserie, Winston, Grid, Winchester

### Deckbuilding Step

After drafting: split pool into main deck and sideboard, add basic lands freely, and the finished deck loads into the library at the table.

---

## Pre-constructed Mode

For 1v1 and 2v2. The room works as a lobby: each player submits a decklist, and the game starts when everyone is ready.

- Paste text or upload a text file in standard format (`4 Lightning Bolt`), with sideboard and commander sections
- Validate names against Scryfall; clear errors for unknown cards; choose printings where it matters
- Later: import from Moxfield / Archidekt links
- Save decks to the account for reuse

---

## Cube Management

- Multiple cubes saved per account; anyone can create new ones
- A cube is a list of **specific printings** (Scryfall print IDs): the cube fixes which artwork/version of each card is shown at the table
- Edit in the app; import from Cube Cobra or pasted list
- **Version history** (like git commits): each save creates a new version with added/removed cards, author, date, and optional note
- Browse history, diff any two versions, restore an older version
- Every draft records which cube version it used

---

## Statistics

### Card Statistics (per cube)

- Average pick position
- Pick rate when seen (fairer than raw pick order)
- First-pick rate
- Most-passed cards (candidates to cut)
- Optional: win rate of decks containing the card
- Filterable by cube version and date range

### Player Statistics

- Wins/losses overall and per format (1v1, FFA, 2v2, Commander)
- Head-to-head records
- Draft tendencies: favorite colors, most-picked cards, pick timing vs group average
- Deck history with performance

A single "report result" step at the end of each game feeds both card and player stats.

---

## UI / UX Principles

### Speed of common actions

- Click a card to tap/untap; drag to move between zones
- Right-click / long-press context menu for everything else
- Keyboard shortcuts for frequent actions (draw, untap all, shuffle, roll), shown as hints in menus
- Multi-select for tapping or moving several cards at once

### Feels instant

Optimistic updates. Laggy card movement loses players.

### Forgiving

Undo for your own last action (visible in the log to keep it honest).

### Clarity at a glance

- Clear difference between hidden and revealed cards
- Life, poison, hand size, and library size readable from any view
- Subtle animations for moves, taps, and reveals
- Highlight a player's area briefly when something changes there

### 4-player table & zoom

- Each player gets roughly a quarter of the screen by default
- **Focus mode:** click a quadrant to zoom it to most of the screen; click again or Esc to return. Shortcuts 1–4 to jump between players
- While zoomed on an opponent, keep your own board as a thin strip or mini-map
- Hover any card for a full-size preview
- Group identical cards ("5× Soldier token"); arrange battlefield in rows (lands, creatures, other)
- Smooth zoomable canvas (CSS transforms, or PixiJS if boards get heavy)

### Draft UI

- Large, readable pack cards with hover preview
- Clear pass direction and pick number indicators
- Face-up picks visible per seat
- Current pool visible and sortable by color and type

### Polish

Good card images, clean table background, smooth transitions, consistent style. Set up a small design system early (colors, spacing, components).

### Process

- Prototype table and draft screens before building the backend
- Playtest with the group early and often

### Scope

Desktop browser first. Tablet support later.

---

## Open Questions

Resolved on 2026-09-18 (see [plan.md](plan.md)):

- Phase 2: one 15-card pack per player per round, 12 packs dealt from the shuffled cube, remainder unused.
- Pass direction: flips every round, including across the phase 1 → phase 2 boundary.
- Phase 1 pool: a separate 20-card list, not part of the main cube.
- "Three-colored" confirmed.
- Domains: web `mtg.codes.hr`, API `api.mtg.codes.hr`.

Still open:

- Draft pick timer (assumed none).

---

## Dev Setup Notes

- macOS, tools installed via Homebrew
- VS Code: create `launch.json` for debugging the backend
- Frontend: include a `pnpm run start` script in `package.json`
- Git for version control
- Passkey / YubiKey 5C NFC authentication (later)
