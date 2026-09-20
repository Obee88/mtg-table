import type { CardPrinting } from '@mtg/shared';
import { describe, expect, it } from 'vitest';
import { defaultPrinting, orderPrintings } from './printings';

const p = (id: string, releasedAt: string, extra: Partial<CardPrinting> = {}): CardPrinting => ({
  id, oracleId: 'o', name: 'Bolt', lang: 'en', layout: 'normal', setCode: id, setName: id, collectorNumber: '1', releasedAt, rarity: 'common',
  typeLine: 'Instant', manaCost: null, cmc: 1, colors: ['R'], colorIdentity: ['R'], oracleText: null, imageUris: null, faces: [], isToken: false, isDigital: false, isPromo: false, ...extra,
});

describe('printing picker ordering', () => {
  it('lists oldest first and defaults to the oldest English paper non-promo printing', () => {
    const list = [p('m11', '2010-07-16'), p('plst', '2024-01-01', { isPromo: true }), p('lea', '1993-08-05'), p('de', '1994-01-01', { lang: 'de' }), p('ha1', '2022-01-01', { isDigital: true })];
    expect(orderPrintings(list).map((x) => x.id)).toEqual(['lea', 'de', 'm11', 'ha1', 'plst']);
    expect(defaultPrinting(list)?.id).toBe('lea');
    expect(defaultPrinting([p('x', '2000-01-01', { isPromo: true })])?.id).toBe('x'); // nothing better: oldest anyway
    expect(defaultPrinting([])).toBeUndefined();
  });
});
