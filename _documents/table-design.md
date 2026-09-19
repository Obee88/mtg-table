# Table UI design

Decisions from the design session on 2026-09-19: **dark felt, minimal chrome, equal halves,
free placement**. This is the visual spec the table components follow. Iterate on
`/design` (fixture game, no login) and record changes here.

## Principles

1. Cards are the only bright thing. Everything else is dark, low-contrast, and recedes.
2. Nothing is chrome until you need it. Status is always readable; controls appear on hover,
   right-click, or a key.
3. The whole viewport is the table. No page scroll; card size follows the screen.
4. Every state a card can be in is visible at a glance without hovering (tapped, face-down,
   token, counters, note, revealed, attached, selected).

## Surface

- Felt: radial gradient `#0e1f18 → #07110d`, 3% monochrome noise (inline SVG turbulence), soft
  vignette. One surface for the whole table; halves are separated by a 1px hairline with a faint glow.
- Zones (battlefield, hand tray, piles) are not boxes. Battlefield: no border, just the felt. Hand
  tray: a slightly lighter felt band (`white/4`). Piles: dashed outline only while empty.
- Seat colours, used for names, highlights and log: seat 1 amber `#f2c14e`, seat 2 sky `#5cc8ff`,
  seat 3 rose `#ff7a90`, seat 4 lime `#8fe388`.

## Layout (1v1)

```
┌─ opponent strip ───────────────────────────────────────────┐ ┐
│ [opponent hand (backs, fanned)]                [piles]     │ │ half
│                    opponent battlefield                     │ │
├──────────────────── hairline ──────────────────────────────┤ ┘
│                        my battlefield                       │ ┐
│ [my hand (fanned, hover lifts)]                [piles]     │ │ half
└─ my strip ─────────────────────────────────────────────────┘ ┘
                                                     [log column, collapsible]
```

- Strips sit at the far edges (mirror image across the hairline). 36px tall.
- Hand tray = card height + 12px; the hand is centred, fanned with overlap when full; piles sit at
  the right end of the tray (library, graveyard, exile, command).
- Card size = `cardSizeFor(width, halfHeight)` (see `cardSize.tsx`); both halves use the same size.

## Player strip

`● Name  ♥ 20  ☠ 3  ⚡ energy 2  cmd tax 2  ⚔ from Bob 5  │  hand 7 · library 46`

- Life is the largest number (20px semibold, tabular). Hovering it shows ± and quick −5/−3/+3/+5.
- Poison, custom counters, commander tax/damage are chips, shown only when non-zero (or when
  commander is enabled). Clicking a chip shows ±.
- A connection dot before the name; the first player gets a small "1st" tag.
- **My strip** has a trailing toolbar (Draw · Untap all · Shuffle · Token · Dice · Mulligan · Undo · ?)
  that is dimmed until my half is hovered or focused, then fully opaque. Each button shows its key.

## Cards

- 5:7, radius 4.5%, shadow `0 2px 6px rgb(0 0 0 / .5)`. Hover lifts 2px and deepens the shadow.
- Tapped: rotate 90° around the centre, 150ms. Flipped: 180°. Transformed: back face image.
- Face-down / hidden: the official card back (Scryfall-hosted); owner sees the name as a small tag.
- Token: small "T" ribbon top-right. Custom token: back with the name as a label.
- Counters: pills top-left, `value kind`. Note: accent label along the bottom edge.
- Revealed beyond owner: eye badge; a 700ms green glow when it becomes revealed.
- Selected: 2px accent ring with offset. No attach action: auras/equipment are simply piled on their
  permanent (drop on the card).
- Larger than 120px wide uses Scryfall `normal` art, else `small`.

## Piles

- Library: a three-layer stack of backs (depth), count badge bottom-centre. Top card face-up when
  revealed. Right-click opens the library menu.
- Graveyard / exile / command: top card face-up, count badge; dashed outline only when empty.

## Menus, dialogs, log

- Context menu: `bg-surface-raised/95` with backdrop blur, 13px, keyboard hints right-aligned.
- Dialogs: centred, dark, max 3xl, close on Esc/backdrop.
- Log: translucent column, collapsible to 8px handle; player names in seat colours; newest at
  bottom, auto-scroll; time in muted small text.

## Motion

- Card enters a zone: 180ms scale from .85. Battlefield move: 200ms ease-out on left/top.
- Highlight: 2px seat-coloured ring on the half an opponent's event touched, 900ms.
- Preview on hover: ~60% of viewport height, follows the pointer, flips side at the edge.

## Open

- Battlefield rows (lands / creatures / other) and token grouping: M3 item.
- Four-player quadrants and focus mode: M3 item; the strip/tray/battlefield stack per player must
  work at quarter size.

## Revision 2026-09-19 (after iteration 1 review)

- **Battlefield is two rows per player** (front row towards the middle, back row for lands), cards
  flow left→right with an 8px gap and snap into slots; no free placement. Dropping onto the middle
  of a card joins its **pile** (cards stack upward with a 22px step); dropping at a card's edge
  inserts beside it. Attachments render tucked behind their host's pile. Rows overlap cards when
  fuller than the width. Model: `position = { row, col }`, `col` is an order key (fractions allowed).
- **The stack is an overlay** at the right edge of the battlefield beside the log, centred on the
  hairline: one card wide, cards stacked vertically (top of stack on top), overlapping as it grows;
  a dashed placeholder when empty.
- Card size formula accounts for two rows + tray (`/3.35`).

## Revision 2026-09-19 (b)

- Hand is left-aligned in the tray.
- Battlefield columns are **absolute slots**: a card keeps the column it was dropped in and empty
  columns stay empty (you may skip placeholders). Gap 12px; columns compress only when the row is
  wider than the space. Piles step **down and to the right** (22% / 16% of a card) so the card
  beneath stays visible at its top and left edge.
- No floating hover image at the table: the **preview panel** sits at the top of the log column
  (now 280–400px wide) and keeps the last hovered card. Other pages keep the floating preview.

## Revision 2026-09-19 (c)

- Battlefield column gap is 40% of the card width, so two adjacent tapped cards never touch.
- The stack piles like the battlefield (down-right steps) and its panel widens with the pile;
  more padding around the cards.
- Graveyard and exile piles with more than one card show a caret pointing at the battlefield;
  it opens a **zone browser** anchored to the pile, growing towards the battlefield: all cards
  stacked with a vertical offset only, so every name line is readable; hover feeds the preview
  panel; Esc / click outside closes.

## Revision 2026-09-19 (d) — counters

- **P/T counters** (`+1/+1`, `-1/-1`, `+1/+0`, …) are netted into one badge top-right, inset 6%
  from the corner: green when non-negative, red when non-positive, neutral when mixed; reads
  `+2/+2`, never "2 +1/+1".
- **Loyalty** is the printed planeswalker shield (Mana icon font glyph `loyalty-start`, SIL OFL 1.1)
  bottom-right with the number inside; the counter-mode highlight follows the outline.
- **General counter** is a round dark badge with the count, top-left, sized to be easy to hit.
- Card counters are exactly four kinds: `+1/+1`, `-1/-1`, loyalty, and one **general counter**
  (shown as a bare number tag). Player-level counters (energy, experience…) stay named.
- **Everything else** — the general counter, notes, custom token names, the face-down
  owner hint — uses one **Tag** style: dark pill, hairline ring, size relative to the card. Notes
  use the accent tone. The token "T" mark moved to the top-left corner.
- **Counter mode:** hold `c` and hover any counter badge on your own card — it highlights; click adds
  one, right-click removes one (P/T badge: click = +1/+1, right-click = −1/−1). Without `c` badges are
  inert so a plain click still taps the card.

## Chips — labels and badges (2026-09-19)

One `Chip` component (`apps/web/src/components/Chip.tsx`) with two axes instead of two
components: `emphasis` (`soft` = label, `solid` = badge) and `shape` (`rect` | `pill`), sizes
`small` (20px, 11px/600) and `medium` (24px, 12px/600). `min-width` = height so a lone digit is a
circle; border always present but transparent by default; `ChipButton` for clickable ones
(clickable is derived from being a button, never a prop).

Palette: five six-step ramps (primary/blue, green, red, yellow, purple) and a 13-step neutral
scale as CSS custom properties; semantic tokens per type × emphasis. The app is dark-only, so
the **dark mapping** is wired: soft = deep fill + white text + saturated border; solid = white
ramp's *dark* step as fill, white text, light step as border (white-filled badges read wrong on felt). Hover:
no shadow, background shifts one step. A light mapping can be added under `[data-theme="light"]`.

Where chips are used: P/T badge (solid pill: success/error/neutral), general counter (solid
pill, circular), token mark (primary solid pill "T"), revealed eye (success solid pill), notes
(warning soft), custom token names / face-down hints (neutral soft), pile labels, the stack
header and "top" marker, selection/banner in the strip, "1st", player counters, lobby host /
team / ready, room phase and "yours", promo/digital on printings, used invites.
- The whole battlefield accepts drops (row under or nearest to the pointer), not just the row strips.
- The stack shows no "top" marker; the pile order says it.

## Revision 2026-09-19 (e) — labels aligned to the source SCSS

Dark label mapping exactly as the reference: deep fill (`*-darker`, `n800`), white text, **no border on
primary/success/error**, yellow border on warning, white border on neutral; hover lightens the fill one
step, no shadow; icons take the saturated step. Radius 3px, 20/24px tall, 11/12px at 600. The
solid/badge look is no longer used anywhere; its tokens alias the label look.

## Revision 2026-09-19 (f) — opening hands, library actions

- **Mulligan phase**: after dealing, an overlay blocks the table until everyone has kept. Mulligan
  = hand back, shuffle, draw seven; keeping after *n* mulligans requires choosing *n* cards for the
  bottom. Other players' status shows as chips. Engine-enforced (`game.mulligans`).
- **Restart** (owner, in the log header) re-deals for everyone and re-enters the mulligan phase.
- Toolbar: Untap all · Token · Dice · Undo · ?. Draw = click the library (or `d`); shuffle and the
  mid-game mulligan live in the library menu / `s`. The strip no longer repeats hand/library counts
  (the pile labels carry them).
- Library label is a button: click or right-click opens the library menu, which gains **Draw by
  name…** (search your library, pick a card to hand, shuffle afterwards by default).
- **Turns**: `game.activePlayerId` / `game.turn`, starting with the roll winner. The active player
  ends the turn (toolbar "End turn", `n`); it passes to the next seat. The active player's strip
  shows a primary "Your turn · N" / "Bob's turn · N" chip and their half has a thin accent outline.
