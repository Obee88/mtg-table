import type { CardPrinting } from './cards.js';
import { diffCubeVersions } from './cubes.js';
import { describe, expect, it } from 'vitest';

const p = (id: string, name: string, oracleId: string): CardPrinting => ({
  id, oracleId, name, lang: 'en', layout: 'normal', setCode: id, setName: id, collectorNumber: '1', releasedAt: '2000-01-01', rarity: 'common',
  typeLine: null, manaCost: null, cmc: null, colors: null, colorIdentity: [], oracleText: null, imageUris: null, faces: [], isToken: false, isDigital: false, isPromo: false,
});
const printings = new Map([
  ['bolt-lea', p('bolt-lea', 'Lightning Bolt', 'o-bolt')],
  ['bolt-m11', p('bolt-m11', 'Lightning Bolt', 'o-bolt')],
  ['counter', p('counter', 'Counterspell', 'o-counter')],
  ['elves', p('elves', 'Llanowar Elves', 'o-elves')],
]);

describe('diffCubeVersions', () => {
  it('reports added, removed, quantity changes and printing swaps', () => {
    const from = [{ printingId: 'bolt-lea', quantity: 1 }, { printingId: 'counter', quantity: 2 }, { printingId: 'elves', quantity: 1 }];
    const to = [{ printingId: 'bolt-m11', quantity: 1 }, { printingId: 'counter', quantity: 1 }];
    const d = diffCubeVersions(from, to, printings);
    expect(d.swapped).toEqual([{ oracleId: 'o-bolt', from: printings.get('bolt-lea'), to: printings.get('bolt-m11'), quantity: 1 }]);
    expect(d.removed.map((r) => r.printing.name)).toEqual(['Llanowar Elves']);
    expect(d.added).toEqual([]);
    expect(d.quantity).toEqual([{ printing: printings.get('counter'), from: 2, to: 1 }]);
  });
  it('is empty for identical versions and symmetric for reversed input', () => {
    const v = [{ printingId: 'counter', quantity: 1 }];
    expect(diffCubeVersions(v, v, printings)).toEqual({ added: [], removed: [], swapped: [], quantity: [] });
    const d = diffCubeVersions([], v, printings);
    expect(d.added.map((a) => a.printing.id)).toEqual(['counter']);
    expect(diffCubeVersions(v, [], printings).removed.map((r) => r.printing.id)).toEqual(['counter']);
  });
});
