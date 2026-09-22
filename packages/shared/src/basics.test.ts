import { describe, expect, it } from 'vitest';
import { autoBasics, colourPips, deckPips } from './basics.js';

const basics = [
  { printingId: 'plains', name: 'Plains' },
  { printingId: 'island', name: 'Island' },
  { printingId: 'swamp', name: 'Swamp' },
  { printingId: 'mountain', name: 'Mountain' },
  { printingId: 'forest', name: 'Forest' },
];
const spell = (manaCost: string) => ({ manaCost, typeLine: 'Instant' });

describe('colourPips', () => {
  it('counts coloured symbols, splits hybrids, ignores generic and colourless', () => {
    expect(colourPips('{1}{R}{R}')).toEqual({ W: 0, U: 0, B: 0, R: 2, G: 0 });
    expect(colourPips('{W/U}{W/U}')).toEqual({ W: 1, U: 1, B: 0, R: 0, G: 0 });
    expect(colourPips('{2/W}{G/P}{C}{X}')).toEqual({ W: 1, U: 0, B: 0, R: 0, G: 1 });
    expect(colourPips(null)).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0 });
  });

  it('sums a deck, skipping lands and reading both faces of a double-faced card', () => {
    const cards = [spell('{R}'), spell('{1}{G}{G}'), { manaCost: null, typeLine: 'Land' }, { manaCost: null, typeLine: 'Creature // Sorcery', faces: [{ manaCost: '{U}' }, { manaCost: '{2}{U}' }] }];
    expect(deckPips(cards)).toEqual({ W: 0, U: 2, B: 0, R: 1, G: 2 });
  });
});

describe('autoBasics', () => {
  it('fills the deck to 40 in the ratio of the pips, rounding by largest remainder', () => {
    // 23 cards in, 17 lands to add; pips R:2, G:1 → 11.33 / 5.67 → 11 + 6.
    const out = autoBasics([spell('{R}{R}'), spell('{G}')], 23, basics);
    expect(out).toEqual([{ printingId: 'mountain', quantity: 11 }, { printingId: 'forest', quantity: 6 }]);
    expect(out.reduce((n, b) => n + b.quantity, 0)).toBe(17);
  });

  it('adds nothing to a full deck, and only uses basics that exist', () => {
    expect(autoBasics([spell('{W}')], 40, basics)).toEqual([]);
    expect(autoBasics([spell('{W}{U}')], 30, basics.filter((b) => b.name !== 'Island'))).toEqual([{ printingId: 'plains', quantity: 10 }]);
  });

  it('gives a colourless deck Wastes when offered, else an even split', () => {
    expect(autoBasics([spell('{3}')], 35, [...basics, { printingId: 'wastes', name: 'Wastes' }])).toEqual([{ printingId: 'wastes', quantity: 5 }]);
    const even = autoBasics([spell('{3}')], 30, basics);
    expect(even.map((b) => b.quantity)).toEqual([2, 2, 2, 2, 2]);
  });
});
