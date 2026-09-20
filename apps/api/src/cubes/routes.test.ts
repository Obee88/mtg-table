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
  const a = await ctx.app.inject({ method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN }, payload: { email: 'a@x.io', password: 'secret1', displayName: 'Alice' } });
  alice = sessionCookie(a);
  const invite = (await call('POST', '/invites', alice, {})).json().code;
  const b = await ctx.app.inject({ method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN }, payload: { email: 'b@x.io', password: 'secret1', displayName: 'Bob', inviteCode: invite } });
  bob = sessionCookie(b);
});
afterAll(() => ctx.close());

describe('cube routes', () => {
  let cubeId: string;

  it('creates a cube with version 1, merging duplicates', async () => {
    const res = await call('POST', '/cubes', alice, { name: 'House cube', cards: [{ printingId: BOLT, quantity: 1 }, { printingId: BOLT, quantity: 1 }, { printingId: COUNTER, quantity: 1 }] });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    cubeId = body.cube.id;
    expect(body.version).toMatchObject({ number: 1, note: 'Initial list', cardCount: 3, createdByName: 'Alice' });
    expect(body.version.cards).toEqual([{ printingId: BOLT, quantity: 2 }, { printingId: COUNTER, quantity: 1 }]);
    expect(body.printings.map((p: { name: string }) => p.name).sort()).toEqual(['Counterspell', 'Lightning Bolt']);
    expect((await call('GET', '/cubes', alice)).json()).toEqual([expect.objectContaining({ id: cubeId, name: 'House cube', latestVersion: 1, cardCount: 3 })]);
  });

  it('adds numbered versions and can show an older one', async () => {
    const v2 = await call('POST', `/cubes/${cubeId}/versions`, alice, { cards: [{ printingId: COUNTER, quantity: 1 }], note: 'cut Bolt' });
    expect(v2.statusCode).toBe(201);
    expect(v2.json().version).toMatchObject({ number: 2, note: 'cut Bolt', cardCount: 1 });
    expect(v2.json().versions.map((v: { number: number }) => v.number)).toEqual([2, 1]);
    const old = await call('GET', `/cubes/${cubeId}?version=1`, alice);
    expect(old.json().version.cardCount).toBe(3);
    expect((await call('GET', `/cubes/${cubeId}?version=9`, alice)).statusCode).toBe(404);
    const renamed = await call('PUT', `/cubes/${cubeId}`, alice, { name: 'House cube v2' });
    expect(renamed.json().cube.name).toBe('House cube v2');
  });

  it('rejects unknown printings and other users', async () => {
    expect((await call('POST', '/cubes', alice, { name: 'x', cards: [{ printingId: '00000000-0000-4000-8000-000000000000', quantity: 1 }] })).statusCode).toBe(400);
    expect((await call('GET', `/cubes/${cubeId}`, bob)).statusCode).toBe(404);
    expect((await call('POST', `/cubes/${cubeId}/versions`, bob, { cards: [] })).statusCode).toBe(404);
    expect((await call('GET', '/cubes', bob)).json()).toEqual([]);
    expect((await ctx.app.inject({ url: '/cubes' })).statusCode).toBe(401);
  });

  it('deletes with its versions', async () => {
    expect((await call('DELETE', `/cubes/${cubeId}`, alice)).statusCode).toBe(204);
    expect((await call('GET', `/cubes/${cubeId}`, alice)).statusCode).toBe(404);
    expect((await call('GET', '/cubes', alice)).json()).toEqual([]);
  });
});
