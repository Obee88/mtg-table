import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linesToDecklist, parseDeckUrl, type DeckSiteFetch } from './external.js';
import { sessionCookie, TEST_ORIGIN, testApp } from '../test/app.js';
import { fakeSource, rawCard } from '../test/cards.js';

const BOLT = '11111111-1111-4111-8111-111111111111';
const COUNTER = '44444444-4444-4444-8444-444444444444';

const moxfieldDeck = {
  name: 'Izzet Tempo',
  mainboard: { 'Lightning Bolt': { quantity: 4, card: { name: 'Lightning Bolt', set: 'lea', cn: '161' } }, 'Counterspell': { quantity: 2, card: { name: 'Counterspell' } } },
  sideboard: { 'Lightning Bolt': { quantity: 1, card: { name: 'Lightning Bolt' } } },
  commanders: {},
};
const archidektDeck = {
  name: 'Bolt Commander',
  cards: [
    { quantity: 3, categories: ['Instant'], card: { oracleCard: { name: 'Lightning Bolt' }, edition: { editioncode: 'lea' }, collectorNumber: 161 } },
    { quantity: 1, categories: ['Commander'], card: { oracleCard: { name: 'Counterspell' }, edition: { editioncode: 'lea' } } },
    { quantity: 1, categories: ['Sideboard'], card: { oracleCard: { name: 'Counterspell' } } },
    { quantity: 1, categories: ['Maybeboard'], card: { oracleCard: { name: 'Nope' } } },
    { quantity: 1, categories: [], card: { oracleCard: { name: 'Unknown Card' } } },
  ],
};

const stub: DeckSiteFetch = async (url) => {
  if (url.includes('moxfield.com/v2/decks/all/abc')) return { status: 200, json: async () => moxfieldDeck };
  if (url.includes('moxfield.com/v2/decks/all/locked')) return { status: 403, json: async () => ({}) };
  if (url.includes('archidekt.com/api/decks/42/')) return { status: 200, json: async () => archidektDeck };
  return { status: 404, json: async () => ({}) };
};

let ctx: Awaited<ReturnType<typeof testApp>>;
let cookie: string;

beforeAll(async () => {
  ctx = await testApp({ cardSource: fakeSource([rawCard(), rawCard({ id: COUNTER, oracle_id: '55555555-5555-4555-8555-555555555555', name: 'Counterspell' })]), deckSiteFetch: stub });
  await ctx.app.cardIngest.start();
  await ctx.app.cardIngest.wait();
  const res = await ctx.app.inject({ method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN }, payload: { email: 'a@x.io', password: 'a-long-enough-password', displayName: 'Ann' } });
  cookie = sessionCookie(res);
});
afterAll(() => ctx.close());

describe('deck URLs', () => {
  it('recognises Moxfield and Archidekt links', () => {
    expect(parseDeckUrl('https://www.moxfield.com/decks/abc_DEF-1')).toMatchObject({ source: 'moxfield', id: 'abc_DEF-1' });
    expect(parseDeckUrl('https://archidekt.com/decks/42/izzet')).toMatchObject({ source: 'archidekt', id: '42', api: 'https://archidekt.com/api/decks/42/' });
    expect(parseDeckUrl('https://example.com/decks/42')).toBeNull();
    expect(linesToDecklist([{ section: 'main', quantity: 4, name: 'Bolt', set: 'lea', collectorNumber: '161' }, { section: 'commander', quantity: 1, name: 'X' }])).toBe('4 Bolt (LEA) 161\n\nCommander\n1 X\n');
  });
});

describe('POST /decks/import/url', () => {
  const call = (url: string) => ctx.app.inject({ method: 'POST', url: '/decks/import/url', headers: { origin: TEST_ORIGIN, cookie }, payload: { url } });

  it('imports a Moxfield deck with its boards', async () => {
    const res = await call('https://www.moxfield.com/decks/abc');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ name: 'Izzet Tempo', source: 'moxfield', unknown: [] });
    expect(body.resolved.main.map((c: { quantity: number; printing: { id: string } }) => [c.quantity, c.printing.id])).toEqual([[4, BOLT], [2, COUNTER]]);
    expect(body.resolved.sideboard).toHaveLength(1);
    expect(body.text).toContain('Sideboard');
  });

  it('imports an Archidekt deck, mapping categories and skipping the maybeboard', async () => {
    const res = await call('https://archidekt.com/decks/42/bolt-commander');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('Bolt Commander');
    expect(body.resolved.main.map((c: { quantity: number }) => c.quantity)).toEqual([3]);
    expect(body.resolved.commander.map((c: { printing: { id: string } }) => c.printing.id)).toEqual([COUNTER]);
    expect(body.resolved.sideboard).toHaveLength(1);
    expect(body.unknown.map((u: { name: string }) => u.name)).toEqual(['Unknown Card']);
  });

  it('reports bad links, missing decks and refusals', async () => {
    expect((await call('https://example.com/x')).statusCode).toBe(400);
    expect((await call('https://archidekt.com/decks/7')).statusCode).toBe(404);
    const refused = await call('https://moxfield.com/decks/locked');
    expect(refused.statusCode).toBe(502);
    expect(refused.json().message).toContain('paste the decklist');
    expect((await ctx.app.inject({ method: 'POST', url: '/decks/import/url', headers: { origin: TEST_ORIGIN }, payload: { url: 'x' } })).statusCode).toBe(401);
  });
});
