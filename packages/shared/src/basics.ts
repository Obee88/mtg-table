import { MIN_DRAFT_DECK } from './draft/types.js';

export const COLOURS = ['W', 'U', 'B', 'R', 'G'] as const;
export type Colour = (typeof COLOURS)[number];

/** The basic land of each colour, and the colourless one. */
export const BASIC_OF_COLOUR: Record<Colour, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };
export const COLOURLESS_BASIC = 'Wastes';

/**
 * Coloured mana symbols in a mana cost, weighted: {W} counts 1 for white, a
 * hybrid {W/U} counts half for each, {2/W} and Phyrexian {W/P} count for
 * white, generic and colourless {C} count for nothing.
 */
export function colourPips(manaCost: string | null | undefined): Record<Colour, number> {
  const pips: Record<Colour, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  if (!manaCost) return pips;
  for (const m of manaCost.matchAll(/\{([^}]+)\}/g)) {
    const parts = m[1]!.toUpperCase().split('/').filter((p): p is Colour => (COLOURS as readonly string[]).includes(p));
    for (const p of parts) pips[p] += 1 / parts.length;
  }
  return pips;
}

export interface BasicsCard {
  manaCost: string | null;
  typeLine: string | null;
  faces?: { manaCost: string | null }[] | undefined;
}

/** Coloured pips over a main deck; lands are skipped (their colour is the point of this exercise, not an input). */
export function deckPips(cards: BasicsCard[]): Record<Colour, number> {
  const total: Record<Colour, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const c of cards) {
    if (/\bLand\b/.test(c.typeLine ?? '')) continue;
    const costs = c.faces && c.faces.length > 1 ? c.faces.map((f) => f.manaCost) : [c.manaCost];
    for (const cost of costs) for (const k of COLOURS) total[k] += colourPips(cost)[k];
  }
  return total;
}

/**
 * How many of each basic land to add so the deck reaches `deckSize`, split in
 * the ratio of the main deck's coloured pips (largest remainders settle the
 * rounding). With no coloured pips at all, the colourless basic if offered,
 * else an even split. Only basics in `available` are used.
 */
export function autoBasics(cards: BasicsCard[], mainSize: number, available: { printingId: string; name: string }[], deckSize = MIN_DRAFT_DECK): { printingId: string; quantity: number }[] {
  const need = Math.max(0, deckSize - mainSize);
  if (need === 0) return [];
  const byName = new Map(available.map((b) => [b.name, b.printingId]));
  const pips = deckPips(cards);
  let weights = COLOURS.filter((c) => byName.has(BASIC_OF_COLOUR[c])).map((c) => ({ printingId: byName.get(BASIC_OF_COLOUR[c])!, w: pips[c] }));
  const anyColour = weights.some((x) => x.w > 0);
  if (!anyColour) {
    const wastes = byName.get(COLOURLESS_BASIC);
    if (wastes) return [{ printingId: wastes, quantity: need }];
    weights = weights.map((x) => ({ ...x, w: 1 }));
  } else {
    weights = weights.filter((x) => x.w > 0);
  }
  if (weights.length === 0) return [];
  const sum = weights.reduce((n, x) => n + x.w, 0);
  const exact = weights.map((x) => ({ printingId: x.printingId, share: (need * x.w) / sum }));
  const out = exact.map((x) => ({ printingId: x.printingId, quantity: Math.floor(x.share), rest: x.share - Math.floor(x.share) }));
  let left = need - out.reduce((n, x) => n + x.quantity, 0);
  for (const x of [...out].sort((a, b) => b.rest - a.rest)) {
    if (left === 0) break;
    x.quantity += 1;
    left -= 1;
  }
  return out.filter((x) => x.quantity > 0).map(({ printingId, quantity }) => ({ printingId, quantity }));
}
