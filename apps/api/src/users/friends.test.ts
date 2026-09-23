import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '../db/index.js';
import { sessionCookie, TEST_ORIGIN, testApp } from '../test/app.js';

let ctx: Awaited<ReturnType<typeof testApp>>;
let alice: string;
let bob: string;
const me = async (cookie: string) => (await ctx.app.inject({ url: '/me', headers: { cookie } })).json().id as string;
const call = (method: 'GET' | 'POST' | 'DELETE', url: string, cookie: string, payload?: object): Promise<LightMyRequestResponse> => {
  const opts: InjectOptions = { method, url, headers: { origin: TEST_ORIGIN, cookie } };
  if (payload !== undefined) opts.payload = payload;
  return ctx.app.inject(opts);
};

beforeAll(async () => {
  ctx = await testApp();
  const a = await ctx.app.inject({ method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN }, payload: { email: 'a@x.io', password: 'secret1', displayName: 'Alice' } });
  alice = sessionCookie(a);
  const invite = (await call('POST', '/invites', alice, {})).json().code;
  const b = await ctx.app.inject({ method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN }, payload: { email: 'b@x.io', password: 'secret1', displayName: 'Bob', inviteCode: invite } });
  bob = sessionCookie(b);
  await ctx.app.db.insert(schema.cards).values({
    id: '99999999-9999-4999-8999-999999999901', name: 'Card', lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
    collectorNumber: '1', releasedAt: '1993-08-05', rarity: 'common', colorIdentity: [], faces: [], oracleId: null,
  });
});
afterAll(() => ctx.close());

describe('friends', () => {
  it('asks, answers, unfriends, and gates sharing', async () => {
    const [aliceId, bobId] = [await me(alice), await me(bob)];
    const cubeId = (await call('POST', '/cubes', alice, { name: 'Mine', cards: [{ printingId: '99999999-9999-4999-8999-999999999901', quantity: 1 }] })).json().cube.id as string;
    // Not friends yet: no sharing.
    expect((await call('POST', `/cubes/${cubeId}/members`, alice, { userId: bobId })).statusCode).toBe(400);

    expect((await call('POST', '/friends', alice, { userId: aliceId })).statusCode).toBe(400);
    expect((await call('POST', '/friends', alice, { name: 'nobody@x.io' })).statusCode).toBe(404);
    const asked = await call('POST', '/friends', alice, { name: 'B@X.IO' }); // by email, any case
    expect(asked.statusCode).toBe(201);
    expect(asked.json()).toEqual({ friends: [], incoming: [], outgoing: [{ id: bobId, displayName: 'Bob' }] });
    expect((await call('GET', '/friends', bob)).json()).toEqual({ friends: [], incoming: [{ id: aliceId, displayName: 'Alice' }], outgoing: [] });
    expect((await call('POST', `/cubes/${cubeId}/members`, alice, { userId: bobId })).statusCode).toBe(400); // still pending

    const answered = await call('POST', `/friends/${aliceId}/respond`, bob, { accept: true });
    expect(answered.json()).toEqual({ friends: [{ id: aliceId, displayName: 'Alice' }], incoming: [], outgoing: [] });
    expect((await call('GET', '/friends', alice)).json().friends).toEqual([{ id: bobId, displayName: 'Bob' }]);
    expect((await call('POST', `/cubes/${cubeId}/members`, alice, { userId: bobId })).statusCode).toBe(201);

    expect((await call('DELETE', `/friends/${bobId}`, alice)).json()).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect((await call('GET', '/friends', bob)).json().friends).toEqual([]);
    // Asking back after being asked counts as accepting.
    await call('POST', '/friends', bob, { name: 'alice' }); // by display name
    expect((await call('POST', '/friends', alice, { userId: bobId })).json().friends).toEqual([{ id: bobId, displayName: 'Bob' }]);
    // Rejecting drops the request.
    await call('DELETE', `/friends/${bobId}`, alice);
    await call('POST', '/friends', alice, { userId: bobId });
    expect((await call('POST', `/friends/${aliceId}/respond`, bob, { accept: false })).json()).toEqual({ friends: [], incoming: [], outgoing: [] });
    expect((await call('POST', `/friends/${aliceId}/respond`, bob, { accept: true })).statusCode).toBe(404);
    expect((await ctx.app.inject({ url: '/friends' })).statusCode).toBe(401);
  });
});
