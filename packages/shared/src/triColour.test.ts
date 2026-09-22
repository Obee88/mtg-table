import { describe, expect, it } from 'vitest';
import type { CardPrinting } from './cards.js';
import { triColourPool } from './cubes.js';

const printing = (id: string, colorIdentity: string[]): CardPrinting => ({ id, colorIdentity } as CardPrinting);

describe('triColourPool', () => {
  it('keeps the cards with exactly three colours, quantities intact, skipping unknown printings', () => {
    const printings = [printing('shard', ['W', 'U', 'B']), printing('gold', ['R', 'G']), printing('mono', ['G']), printing('land', ['B', 'R', 'G']), printing('none', [])];
    const cards = [{ printingId: 'shard', quantity: 1 }, { printingId: 'gold', quantity: 1 }, { printingId: 'mono', quantity: 2 }, { printingId: 'land', quantity: 3 }, { printingId: 'none', quantity: 1 }, { printingId: 'missing', quantity: 1 }];
    expect(triColourPool(cards, printings)).toEqual([{ printingId: 'shard', quantity: 1 }, { printingId: 'land', quantity: 3 }]);
    expect(triColourPool(cards, new Map(printings.map((p) => [p.id, p])), 2)).toEqual([{ printingId: 'gold', quantity: 1 }]);
  });
});
