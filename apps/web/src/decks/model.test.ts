import type { CardPrinting, DeckImportResponse, DeckResponse } from '@mtg/shared';
import { describe, expect, it } from 'vitest';
import { fromDeckResponse, fromImport, moveCard, replacePrinting, setQuantity, toDeckInput, toText } from './model';

const printing = (id: string, name: string, setCode = 'm11', collectorNumber = '1'): CardPrinting => ({
  id, oracleId: `o-${name}`, name, lang: 'en', layout: 'normal', setCode, setName: setCode, collectorNumber, releasedAt: '2010-01-01',
  rarity: 'common', typeLine: 'Instant', manaCost: '{R}', cmc: 1, colors: ['R'], colorIdentity: ['R'], oracleText: null,
  imageUris: null, faces: [], isToken: false, isDigital: false, isPromo: false,
});
const bolt = printing('bolt', 'Lightning Bolt');
const boltLea = printing('bolt-lea', 'Lightning Bolt', 'lea', '161');
const counter = printing('counter', 'Counterspell');

describe('deck model', () => {
  it('builds from an import response, merging duplicate printings', () => {
    const res: DeckImportResponse = {
      resolved: {
        main: [{ line: 1, quantity: 2, requested: { name: 'x' }, printing: bolt }, { line: 2, quantity: 2, requested: { name: 'x' }, printing: bolt }],
        sideboard: [{ line: 3, quantity: 1, requested: { name: 'y' }, printing: counter }],
        commander: [],
      },
      unknown: [], warnings: [], errors: [],
    };
    const deck = fromImport('Burn', res);
    expect(deck.sections.main).toEqual([{ printing: bolt, quantity: 4 }]);
    expect(toDeckInput(deck)).toEqual({ name: 'Burn', contents: { main: [{ printingId: 'bolt', quantity: 4 }], sideboard: [{ printingId: 'counter', quantity: 1 }], commander: [] } });
  });

  it('builds from a deck response and drops printings the server did not return', () => {
    const res: DeckResponse = {
      deck: { id: 'd', name: 'D', createdAt: '', updatedAt: '', contents: { main: [{ printingId: 'bolt', quantity: 4 }, { printingId: 'ghost', quantity: 1 }], sideboard: [], commander: [] } },
      cards: [bolt],
    };
    expect(fromDeckResponse(res).sections.main).toEqual([{ printing: bolt, quantity: 4 }]);
  });

  it('edits immutably: quantity, printing swap with merge, move between sections', () => {
    let deck = fromDeckResponse({ deck: { id: 'd', name: 'D', createdAt: '', updatedAt: '', contents: { main: [{ printingId: 'bolt', quantity: 4 }, { printingId: 'bolt-lea', quantity: 1 }], sideboard: [], commander: [] } }, cards: [bolt, boltLea] });
    const before = deck;
    deck = setQuantity(deck, 'main', 'bolt', 3);
    expect(before.sections.main[0]?.quantity).toBe(4);
    expect(deck.sections.main[0]?.quantity).toBe(3);
    deck = setQuantity(deck, 'main', 'bolt-lea', 0);
    expect(deck.sections.main).toHaveLength(1);
    deck = replacePrinting(deck, 'main', 'bolt', boltLea);
    expect(deck.sections.main).toEqual([{ printing: boltLea, quantity: 3 }]);
    deck = moveCard(deck, 'main', 'sideboard', 'bolt-lea');
    expect(deck.sections.main).toEqual([]);
    expect(deck.sections.sideboard).toEqual([{ printing: boltLea, quantity: 3 }]);
  });

  it('exports Arena-style text', () => {
    const deck = fromImport('x', { resolved: { main: [{ line: 1, quantity: 4, requested: { name: 'x' }, printing: boltLea }], sideboard: [{ line: 2, quantity: 1, requested: { name: 'y' }, printing: counter }], commander: [] }, unknown: [], warnings: [], errors: [] });
    expect(toText(deck)).toBe('Deck\n4 Lightning Bolt (LEA) 161\n\nSideboard\n1 Counterspell (M11) 1\n');
  });
});
