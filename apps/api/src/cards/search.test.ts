import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../db/index.js';
import { fakeSource, rawCard } from '../test/cards.js';
import { testDb } from '../test/db.js';
import { CardIngestService } from './ingest.js';
import { listPrintings, searchCards } from './search.js';

const BOLT = '22222222-2222-4222-8222-222222222222';
const BOLTLESS = '77777777-7777-4777-8777-777777777777';
const HOUND = '88888888-8888-4888-8888-888888888888';

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return silentLog; } } as never;

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await testDb());
  const service = new CardIngestService(
    db,
    fakeSource([
      rawCard({ id: 'a1111111-1111-4111-8111-111111111111', set: 'lea', released_at: '1993-08-05' }),
      rawCard({ id: 'a2222222-1111-4111-8111-111111111111', set: 'm11', set_name: 'Magic 2011', released_at: '2010-07-16', collector_number: '149' }),
      rawCard({ id: 'a3333333-1111-4111-8111-111111111111', set: 'plst', set_name: 'The List', released_at: '2024-01-01', promo: true }),
      rawCard({ id: 'a4444444-1111-4111-8111-111111111111', set: 'ha1', set_name: 'Alchemy', released_at: '2025-01-01', digital: true }),
      rawCard({ id: 'a5555555-1111-4111-8111-111111111111', set: 'lea', lang: 'de', name: 'Blitzschlag' }),
      rawCard({ id: 'b1111111-1111-4111-8111-111111111111', oracle_id: BOLTLESS, name: 'Boltless Wonder', released_at: '2020-01-01' }),
      rawCard({ id: 'c1111111-1111-4111-8111-111111111111', oracle_id: HOUND, name: 'Bolt Hound', released_at: '2021-01-01' }),
      rawCard({ id: 'd1111111-1111-4111-8111-111111111111', oracle_id: '99999999-9999-4999-8999-999999999999', name: 'Bolt Token', layout: 'token', set_type: 'token', set: 'tbol' }),
    ]),
    silentLog,
  );
  await service.start();
  await service.wait();
});
afterAll(() => close());

describe('searchCards', () => {
  it('returns one printing per card, prefix matches first, alphabetical within', async () => {
    const results = await searchCards(db, 'bolt', 10);
    expect(results.map((r) => r.name)).toEqual(['Bolt Hound', 'Boltless Wonder', 'Lightning Bolt']);
  });

  it('represents a card by its latest English non-promo non-digital printing', async () => {
    const [bolt] = await searchCards(db, 'lightning', 10);
    expect(bolt).toMatchObject({ oracleId: BOLT, setCode: 'm11', collectorNumber: '149' });
  });

  it('escapes LIKE wildcards and honours the limit', async () => {
    expect(await searchCards(db, '%', 10)).toEqual([]);
    expect(await searchCards(db, 'bolt', 1)).toHaveLength(1);
    expect(await searchCards(db, '   ', 10)).toEqual([]);
  });
});

describe('listPrintings', () => {
  it('returns every printing of the oracle id, newest first', async () => {
    const printings = await listPrintings(db, BOLT);
    expect(printings.map((p) => p.setCode)).toEqual(['ha1', 'plst', 'm11', 'lea', 'lea']);
  });
});

describe('token search', () => {
  it('excludes tokens by default and finds only tokens with kind=tokens', async () => {
    expect((await searchCards(db, 'bolt', 10)).map((r) => r.name)).not.toContain('Bolt Token');
    expect((await searchCards(db, 'bolt', 10, 'tokens')).map((r) => r.name)).toEqual(['Bolt Token']);
  });
});

describe('defaultPrintings', () => {
  it('returns the oldest English paper non-promo printing per oracle id', async () => {
    const { defaultPrintings } = await import('./search.js');
    const map = await defaultPrintings(db, [BOLT, HOUND, '00000000-0000-4000-8000-000000000000']);
    expect(map[BOLT]).toMatchObject({ setCode: 'lea', collectorNumber: '161' });
    expect(map[HOUND]?.name).toBe('Bolt Hound');
    expect(Object.keys(map)).toHaveLength(2);
  });
});
