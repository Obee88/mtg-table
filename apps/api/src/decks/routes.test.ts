import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookie, TEST_ORIGIN, testApp } from '../test/app.js';
import { fakeSource, rawCard } from '../test/cards.js';

const BOLT = '11111111-1111-4111-8111-111111111111';
const COUNTER = '44444444-4444-4444-8444-444444444444';

let ctx: Awaited<ReturnType<typeof testApp>>;
let alice: string;
let bob: string;

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: object): Promise<LightMyRequestResponse> => {
  const opts: InjectOptions = { method, url, headers: { origin: TEST_ORIGIN, cookie } };
  if (payload !== undefined) opts.payload = payload;
  return ctx.app.inject(opts);
};

beforeAll(async () => {
  ctx = await testApp({ cardSource: fakeSource([rawCard(), rawCard({ id: COUNTER, oracle_id: '55555555-5555-4555-8555-555555555555', name: 'Counterspell' })]) });
  await ctx.app.cardIngest.start();
  await ctx.app.cardIngest.wait();
  const a = await ctx.app.inject({ method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN }, payload: { email: 'a@x.io', password: 'a-long-enough-password', displayName: 'Alice' } });
  alice = sessionCookie(a);
  const invite = (await call('POST', '/invites', alice, {})).json().code;
  const b = await ctx.app.inject({ method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN }, payload: { email: 'b@x.io', password: 'a-long-enough-password', displayName: 'Bob', inviteCode: invite } });
  bob = sessionCookie(b);
});
afterAll(() => ctx.close());

describe('deck routes', () => {
  let deckId: string;

  it('require a session', async () => {
    expect((await ctx.app.inject({ url: '/decks' })).statusCode).toBe(401);
  });

  it('imports a decklist', async () => {
    const res = await call('POST', '/decks/import', alice, { text: '4 Lightning Bolt\n2 Counterspell\n1 Nope' });
    expect(res.statusCode).toBe(200);
    expect(res.json().resolved.main.map((c: { printing: { id: string } }) => c.printing.id)).toEqual([BOLT, COUNTER]);
    expect(res.json().unknown).toEqual([{ line: 3, quantity: 1, name: 'Nope' }]);
  });

  it('creates, lists, reads, updates and deletes a deck', async () => {
    const created = await call('POST', '/decks', alice, {
      name: 'Burn',
      contents: { main: [{ printingId: BOLT, quantity: 4 }, { printingId: BOLT, quantity: 4 }], sideboard: [{ printingId: COUNTER, quantity: 2 }], commander: [] },
    });
    expect(created.statusCode).toBe(201);
    deckId = created.json().deck.id;
    // duplicate printings are merged
    expect(created.json().deck.contents.main).toEqual([{ printingId: BOLT, quantity: 8 }]);
    expect(created.json().cards.map((c: { name: string }) => c.name).sort()).toEqual(['Counterspell', 'Lightning Bolt']);

    const list = await call('GET', '/decks', alice);
    expect(list.json()).toEqual([expect.objectContaining({ id: deckId, name: 'Burn', mainCount: 8, sideboardCount: 2, commanderCount: 0 })]);

    const read = await call('GET', `/decks/${deckId}`, alice);
    expect(read.json().deck.name).toBe('Burn');

    const updated = await call('PUT', `/decks/${deckId}`, alice, { name: 'Burn v2', contents: { main: [{ printingId: BOLT, quantity: 4 }], sideboard: [], commander: [] } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().deck).toMatchObject({ name: 'Burn v2', contents: { main: [{ printingId: BOLT, quantity: 4 }] } });

    expect((await call('DELETE', `/decks/${deckId}`, alice)).statusCode).toBe(204);
    expect((await call('GET', `/decks/${deckId}`, alice)).statusCode).toBe(404);
  });

  it('rejects unknown printings and invalid input', async () => {
    const bad = await call('POST', '/decks', alice, { name: 'X', contents: { main: [{ printingId: '00000000-0000-4000-8000-000000000000', quantity: 1 }], sideboard: [], commander: [] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().message).toMatch(/Unknown printing/);
    expect((await call('POST', '/decks', alice, { name: '', contents: { main: [], sideboard: [], commander: [] } })).statusCode).toBe(400);
    expect((await call('POST', '/decks', alice, { name: 'X', contents: { main: [{ printingId: BOLT, quantity: 1000 }], sideboard: [], commander: [] } })).statusCode).toBe(400);
  });

  it("does not expose other users' decks", async () => {
    const created = await call('POST', '/decks', alice, { name: 'Private', contents: { main: [{ printingId: BOLT, quantity: 1 }], sideboard: [], commander: [] } });
    const id = created.json().deck.id;
    expect((await call('GET', '/decks', bob)).json()).toEqual([]);
    expect((await call('GET', `/decks/${id}`, bob)).statusCode).toBe(404);
    expect((await call('PUT', `/decks/${id}`, bob, { name: 'Stolen', contents: { main: [], sideboard: [], commander: [] } })).statusCode).toBe(404);
    expect((await call('DELETE', `/decks/${id}`, bob)).statusCode).toBe(404);
    expect((await call('GET', `/decks/${id}`, alice)).statusCode).toBe(200);
  });
});
