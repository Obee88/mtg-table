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
- Selected: 2px accent ring with offset. Attachments: tucked behind their host, offset 18% of card
  width per attachment.
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
