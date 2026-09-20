import type { CardPrinting } from '@mtg/shared';
import { describe, expect, it } from 'vitest';
import { cubeToText, fromImport, mergeCubeCards, sortForCube, toCubeCards } from './model';

const p = (id: string, name: string, colors: string[] | null, typeLine = 'Instant', cmc = 1): CardPrinting => ({
  id, oracleId: id, name, lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', collectorNumber: '1', releasedAt: '1993-08-05', rarity: 'common',
  typeLine, manaCost: null, cmc, colors, colorIdentity: colors ?? [], oracleText: null, imageUris: null, faces: [], isToken: false, isDigital: false, isPromo: false,
});

describe('cube model', () => {
  it('merges duplicates and flattens import sections', () => {
    const bolt = p('b', 'Lightning Bolt', ['R']);
    const list = fromImport({ resolved: { main: [{ line: 1, quantity: 1, requested: { name: 'x' }, printing: bolt }], sideboard: [{ line: 2, quantity: 2, requested: { name: 'x' }, printing: bolt }], commander: [] }, unknown: [], warnings: [], errors: [] });
    expect(list).toEqual([{ printing: bolt, quantity: 3 }]);
    expect(toCubeCards(mergeCubeCards([...list, ...list]))).toEqual([{ printingId: 'b', quantity: 6 }]);
  });
  it('sorts W U B R G, multi, colourless, lands, then cost and name', () => {
    const cards = [p('l', 'Forest', null, 'Basic Land — Forest', 0), p('c', 'Sol Ring', [], 'Artifact', 1), p('g', 'Elves', ['G'], 'Creature', 1), p('m', 'Fire // Ice', ['R', 'U']), p('w', 'Swords', ['W']), p('w2', 'Angel', ['W'], 'Creature', 5)].map((printing) => ({ printing, quantity: 1 }));
    expect(sortForCube(cards).map((c) => c.printing.name)).toEqual(['Swords', 'Angel', 'Elves', 'Fire // Ice', 'Sol Ring', 'Forest']);
    expect(cubeToText(cards.slice(4, 5))).toBe('1 Swords (LEA) 1\n');
  });
});
