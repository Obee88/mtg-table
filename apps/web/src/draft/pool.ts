import type { CardPrinting, DraftCard } from '@mtg/shared';

export type PoolSort = 'picked' | 'colour' | 'cmc' | 'type' | 'name';
export const POOL_SORTS: { key: PoolSort; label: string }[] = [
  { key: 'picked', label: 'pick order' },
  { key: 'colour', label: 'colour' },
  { key: 'cmc', label: 'mana value' },
  { key: 'type', label: 'type' },
  { key: 'name', label: 'name' },
];

export interface PoolEntry {
  card: DraftCard;
  printing: CardPrinting | undefined;
  /** 1-based position in the pool (pick order). */
  n: number;
}

const COLOURS = ['W', 'U', 'B', 'R', 'G'];
const COLOUR_LABEL: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
const TYPES = ['Creature', 'Planeswalker', 'Battle', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land'];

/** Colour bucket: single colours in WUBRG order, then multicolour, colourless, lands. */
export function colourGroup(p: CardPrinting | undefined): { order: number; label: string } {
  if (!p) return { order: 99, label: 'Unknown' };
  if (p.typeLine?.includes('Land')) return { order: 7, label: 'Lands' };
  const colours = p.colors ?? [];
  if (colours.length === 0) return { order: 6, label: 'Colourless' };
  if (colours.length > 1) return { order: 5, label: 'Multicolour' };
  const i = COLOURS.indexOf(colours[0]!);
  return { order: i < 0 ? 6 : i, label: COLOUR_LABEL[colours[0]!] ?? colours[0]! };
}

export function typeGroup(p: CardPrinting | undefined): { order: number; label: string } {
  if (!p) return { order: 99, label: 'Unknown' };
  const i = TYPES.findIndex((t) => p.typeLine?.includes(t));
  return i < 0 ? { order: TYPES.length, label: 'Other' } : { order: i, label: `${TYPES[i]}s` };
}

function cmcGroup(p: CardPrinting | undefined): { order: number; label: string } {
  if (!p) return { order: 99, label: 'Unknown' };
  if (p.typeLine?.includes('Land')) return { order: 50, label: 'Lands' };
  const v = Math.round(p.cmc ?? 0);
  return { order: Math.min(v, 7), label: v >= 7 ? '7+' : String(v) };
}

const byName = (a: PoolEntry, b: PoolEntry) => (a.printing?.name ?? '').localeCompare(b.printing?.name ?? '') || a.n - b.n;
const byCmcName = (a: PoolEntry, b: PoolEntry) => (a.printing?.cmc ?? 0) - (b.printing?.cmc ?? 0) || byName(a, b);

/** The pool as columns: one group per bucket of the chosen sort, cards ordered within. */
export function groupPool(entries: PoolEntry[], sort: PoolSort): { label: string; cards: PoolEntry[] }[] {
  const grouped = (key: (p: CardPrinting | undefined) => { order: number; label: string }, within: (a: PoolEntry, b: PoolEntry) => number) => {
    const map = new Map<number, { label: string; cards: PoolEntry[] }>();
    for (const e of entries) {
      const g = key(e.printing);
      const bucket = map.get(g.order) ?? { label: g.label, cards: [] };
      bucket.cards.push(e);
      map.set(g.order, bucket);
    }
    return [...map.entries()].sort(([a], [b]) => a - b).map(([, g]) => ({ ...g, cards: [...g.cards].sort(within) }));
  };
  switch (sort) {
    case 'picked':
      return entries.length ? [{ label: 'Pick order', cards: [...entries].sort((a, b) => a.n - b.n) }] : [];
    case 'name':
      return entries.length ? [{ label: 'A–Z', cards: [...entries].sort(byName) }] : [];
    case 'colour':
      return grouped(colourGroup, byCmcName);
    case 'cmc':
      return grouped(cmcGroup, byName);
    case 'type':
      return grouped(typeGroup, byCmcName);
  }
}
