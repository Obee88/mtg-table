import type { CardPrinting } from '@mtg/shared';
import { describe, expect, it } from 'vitest';
import { groupPool, type PoolEntry } from './pool';

const printing = (name: string, colors: string[] | null, cmc: number, typeLine: string): CardPrinting =>
  ({ id: name, oracleId: null, name, lang: 'en', layout: 'normal', setCode: 'x', setName: 'X', collectorNumber: '1', releasedAt: '2020-01-01', rarity: 'c', typeLine, manaCost: null, cmc, colors, colorIdentity: [], oracleText: null, imageUris: null, faces: [], isToken: false, isDigital: false, isPromo: false }) as CardPrinting;

const entries: PoolEntry[] = [
  { n: 1, card: { id: '1', printingId: 'Bolt' }, printing: printing('Lightning Bolt', ['R'], 1, 'Instant') },
  { n: 2, card: { id: '2', printingId: 'Bear' }, printing: printing('Grizzly Bears', ['G'], 2, 'Creature — Bear') },
  { n: 3, card: { id: '3', printingId: 'Forest' }, printing: printing('Forest', null, 0, 'Basic Land — Forest') },
  { n: 4, card: { id: '4', printingId: 'Sol' }, printing: printing('Sol Ring', [], 1, 'Artifact') },
  { n: 5, card: { id: '5', printingId: 'Gold' }, printing: printing('Lightning Helix', ['R', 'W'], 2, 'Instant') },
  { n: 6, card: { id: '6', printingId: 'Angel' }, printing: printing('Serra Angel', ['W'], 5, 'Creature — Angel') },
  { n: 7, card: { id: '7', printingId: 'Big' }, printing: printing('Ulamog', [], 10, 'Legendary Creature — Eldrazi') },
  { n: 8, card: { id: '8', printingId: '?' }, printing: undefined },
];

describe('groupPool', () => {
  it('keeps pick order and sorts by name', () => {
    expect(groupPool(entries, 'picked')[0]!.cards.map((e) => e.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(groupPool(entries, 'name')[0]!.cards.map((e) => e.printing?.name ?? '?')).toEqual(['?', 'Forest', 'Grizzly Bears', 'Lightning Bolt', 'Lightning Helix', 'Serra Angel', 'Sol Ring', 'Ulamog']);
  });

  it('buckets by colour in WUBRG order, then multi, colourless, lands', () => {
    const groups = groupPool(entries, 'colour');
    expect(groups.map((g) => [g.label, g.cards.map((e) => e.printing?.name ?? '?')])).toEqual([
      ['White', ['Serra Angel']],
      ['Red', ['Lightning Bolt']],
      ['Green', ['Grizzly Bears']],
      ['Multicolour', ['Lightning Helix']],
      ['Colourless', ['Sol Ring', 'Ulamog']],
      ['Lands', ['Forest']],
      ['Unknown', ['?']],
    ]);
  });

  it('buckets by mana value with a 7+ bucket and lands apart, and by type', () => {
    expect(groupPool(entries, 'cmc').map((g) => g.label)).toEqual(['1', '2', '5', '7+', 'Lands', 'Unknown']);
    expect(groupPool(entries, 'type').map((g) => [g.label, g.cards.length])).toEqual([['Creatures', 3], ['Instants', 2], ['Artifacts', 1], ['Lands', 1], ['Unknown', 1]]);
    expect(groupPool([], 'picked')).toEqual([]);
  });
});
