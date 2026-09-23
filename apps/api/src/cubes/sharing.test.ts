import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '../db/index.js';
import { sessionCookie, TEST_ORIGIN, testApp } from '../test/app.js';

let ctx: Awaited<ReturnType<typeof testApp>>;
let alice: string;
let bob: string;
let carol: string;
const me = async (cookie: string) => (await ctx.app.inject({ url: '/me', headers: { cookie } })).json().id as string;

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: object): Promise<LightMyRequestResponse> => {
  const opts: InjectOptions = { method, url, headers: { origin: TEST_ORIGIN, cookie } };
  if (payload !== undefined) opts.payload = payload;
  return ctx.app.inject(opts);
};

beforeAll(async () => {
  ctx = await testApp();
  const a = await ctx.app.inject({ method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN }, payload: { email: 'a@x.io', password: 'secret1', displayName: 'Alice' } });
  alice = sessionCookie(a);
  for (const [who, mail] of [['Bob', 'b@x.io'], ['Carol', 'c@x.io']] as const) {
    const invite = (await call('POST', '/invites', alice, {})).json().code;
    const res = await ctx.app.inject({ method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN }, payload: { email: mail, password: 'secret1', displayName: who, inviteCode: invite } });
    if (who === 'Bob') bob = sessionCookie(res);
    else carol = sessionCookie(res);
  }
  await ctx.app.db.insert(schema.cards).values({
    id: '99999999-9999-4999-8999-999999999901', name: 'Card', lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
    collectorNumber: '1', releasedAt: '1993-08-05', rarity: 'common', colorIdentity: [], faces: [], oracleId: null,
  });
});
/** Sharing needs friendship: Alice befriends Bob and Carol. */
async function befriend(from: string, to: string): Promise<void> {
  await call('POST', '/friends', from, { userId: await me(to) });
  await call('POST', `/friends/${await me(from)}/respond`, to, { accept: true });
}
beforeAll(async () => {
  await befriend(alice, bob);
  await befriend(alice, carol);
});

afterAll(() => ctx.close());

describe('sharing a cube', () => {
  it('lets members see and draft with the cube but not edit it', async () => {
    const created = await call('POST', '/cubes', alice, { name: 'Shared', cards: [{ printingId: '99999999-9999-4999-8999-999999999901', quantity: 6 }] });
    const cubeId = created.json().cube.id as string;
    const versionId = created.json().version.id as string;
    const bobId = await me(bob);

    expect((await call('GET', `/cubes/${cubeId}`, bob)).statusCode).toBe(404);
    expect((await call('GET', '/cubes', bob)).json()).toEqual([]);
    expect((await call('GET', '/users', alice)).statusCode).toBe(400); // the group is not listed; names come by id
    expect((await call('GET', `/users?ids=${bobId}`, alice)).json()).toEqual([{ id: bobId, displayName: 'Bob' }]);

    expect((await call('POST', `/cubes/${cubeId}/members`, bob, { userId: bobId })).statusCode).toBe(404); // not the owner
    const added = await call('POST', `/cubes/${cubeId}/members`, alice, { userId: bobId });
    expect(added.statusCode).toBe(201);
    expect(added.json().members).toEqual([{ id: bobId, displayName: 'Bob', status: 'pending' }]);
    // An offer grants nothing until Bob accepts it.
    expect((await call('GET', `/cubes/${cubeId}`, bob)).statusCode).toBe(404);
    expect((await call('GET', '/cubes', bob)).json()).toEqual([expect.objectContaining({ id: cubeId, membership: 'invited' })]);
    expect((await call('POST', `/cubes/${cubeId}/membership`, bob, { accept: true })).statusCode).toBe(200);
    expect((await call('POST', `/cubes/${cubeId}/members`, alice, { userId: await me(alice) })).statusCode).toBe(400);

    const list = (await call('GET', '/cubes', bob)).json();
    expect(list).toEqual([expect.objectContaining({ id: cubeId, shared: true, membership: 'member', ownerName: 'Alice', cardCount: 6 })]);
    expect((await call('GET', '/cubes', alice)).json()[0]).toMatchObject({ shared: false });
    const view = await call('GET', `/cubes/${cubeId}`, bob);
    expect(view.statusCode).toBe(200);
    expect(view.json().members).toHaveLength(1);
    expect((await call('GET', `/cubes/${cubeId}/stats`, bob)).statusCode).toBe(200);
    expect((await call('PUT', `/cubes/${cubeId}`, bob, { name: 'Mine now' })).statusCode).toBe(404);
    expect((await call('DELETE', `/cubes/${cubeId}`, carol)).statusCode).toBe(404); // not shared with Carol at all
    expect((await call('GET', `/cubes/${cubeId}`, carol)).statusCode).toBe(404);

    // A shared cube may back a member's draft format.
    const config = { name: 'Bob draft', seats: 2, startDirection: 'left', phases: [{ type: 'pickAndPass', name: 'Only', poolCubeVersionId: versionId, packSize: 3, packsPerPlayer: 1, rounds: 1, direction: 'alternate' }] };
    expect((await call('POST', '/draft-configs', bob, { name: 'Bob draft', config })).statusCode).toBe(201);
    expect((await call('POST', '/draft-configs', carol, { name: 'Carol draft', config })).statusCode).toBe(400);

    const removed = await call('DELETE', `/cubes/${cubeId}/members/${bobId}`, alice);
    expect(removed.statusCode).toBe(200);
    expect(removed.json().members).toEqual([]);
    expect((await call('GET', `/cubes/${cubeId}`, bob)).statusCode).toBe(404);
  });
});

describe('sharing a draft format', () => {
  it('lets members see and use the format but not edit it', async () => {
    const created = await call('POST', '/cubes', alice, { name: 'Format cube', cards: [{ printingId: '99999999-9999-4999-8999-999999999901', quantity: 6 }] });
    const versionId = created.json().version.id as string;
    const config = { name: 'House', seats: 2, startDirection: 'left', phases: [{ type: 'pickAndPass', name: 'Only', poolCubeVersionId: versionId, packSize: 3, packsPerPlayer: 1, rounds: 1, direction: 'alternate' }] };
    const format = await call('POST', '/draft-configs', alice, { name: 'House', config });
    const id = format.json().id as string;
    const bobId = await me(bob);

    expect((await call('GET', `/draft-configs/${id}`, bob)).statusCode).toBe(404);
    expect((await call('POST', `/draft-configs/${id}/members`, alice, { userId: bobId })).statusCode).toBe(201);
    expect((await call('GET', `/draft-configs/${id}`, bob)).statusCode).toBe(404); // offered, not accepted
    expect((await call('POST', `/draft-configs/${id}/membership`, bob, { accept: true })).statusCode).toBe(200);
    expect((await call('GET', '/draft-configs', bob)).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id, shared: true, ownerName: 'Alice' })]));
    const view = await call('GET', `/draft-configs/${id}`, bob);
    expect(view.statusCode).toBe(200);
    expect(view.json().members).toEqual([{ id: bobId, displayName: 'Bob', status: 'accepted' }]);
    expect((await call('PUT', `/draft-configs/${id}`, bob, { name: 'Mine', config })).statusCode).toBe(404);
    expect((await call('DELETE', `/draft-configs/${id}`, carol)).statusCode).toBe(404); // not shared with Carol at all
    expect((await call('GET', `/draft-configs/${id}`, carol)).statusCode).toBe(404);

    // Bob can open a room with the shared format even without access to the cube itself.
    const room = await call('POST', '/rooms', bob, { settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false, draft: view.json().config } });
    expect(room.statusCode).toBe(201);
    await call('POST', `/rooms/${room.json().id}/commands`, alice, { type: 'join' });
    await call('POST', `/rooms/${room.json().id}/commands`, bob, { type: 'setReady', ready: true });
    await call('POST', `/rooms/${room.json().id}/commands`, alice, { type: 'setReady', ready: true });
    expect((await call('POST', `/rooms/${room.json().id}/commands`, bob, { type: 'start' })).statusCode).toBe(200);

    expect((await call('DELETE', `/draft-configs/${id}/members/${bobId}`, alice)).json().members).toEqual([]);
    expect((await call('GET', `/draft-configs/${id}`, bob)).statusCode).toBe(404);
  });
});

describe('deleting something shared', () => {
  const card = '99999999-9999-4999-8999-999999999901';
  const share = async (cubeId: string, cookie: string) => {
    expect((await call('POST', `/cubes/${cubeId}/members`, alice, { userId: await me(cookie) })).statusCode).toBe(201);
    expect((await call('POST', `/cubes/${cubeId}/membership`, cookie, { accept: true })).statusCode).toBe(200);
  };

  it('a member deleting a shared cube only stops sharing; rejecting an offer drops it', async () => {
    const cubeId = (await call('POST', '/cubes', alice, { name: 'Staples', cards: [{ printingId: card, quantity: 2 }] })).json().cube.id as string;
    await share(cubeId, bob);
    expect((await call('DELETE', `/cubes/${cubeId}`, bob)).statusCode).toBe(204);
    expect((await call('GET', '/cubes', bob)).json().some((c: { id: string }) => c.id === cubeId)).toBe(false);
    expect((await call('GET', `/cubes/${cubeId}`, alice)).statusCode).toBe(200); // still Alice's
    expect((await call('POST', `/cubes/${cubeId}/members`, alice, { userId: await me(carol) })).statusCode).toBe(201);
    expect((await call('POST', `/cubes/${cubeId}/membership`, carol, { accept: false })).statusCode).toBe(200);
    expect((await call('GET', '/cubes', carol)).json().some((c: { id: string }) => c.id === cubeId)).toBe(false);
    expect((await call('GET', `/cubes/${cubeId}`, alice)).json().members).toEqual([]);
  });

  it('the owner deleting a shared cube leaves it to the members, who copy it or let it go', async () => {
    const cubeId = (await call('POST', '/cubes', alice, { name: 'Legacy', cards: [{ printingId: card, quantity: 3 }] })).json().cube.id as string;
    await share(cubeId, bob);
    await share(cubeId, carol);
    expect((await call('DELETE', `/cubes/${cubeId}`, alice)).statusCode).toBe(204);
    expect((await call('GET', '/cubes', alice)).json().some((c: { id: string }) => c.id === cubeId)).toBe(false);
    expect((await call('GET', `/cubes/${cubeId}`, alice)).statusCode).toBe(404);
    expect((await call('GET', '/cubes', bob)).json().filter((c: { id: string }) => c.id === cubeId)).toEqual([expect.objectContaining({ id: cubeId, deletedByOwner: true, ownerName: 'Alice' })]);
    expect((await call('GET', `/cubes/${cubeId}`, bob)).json().cube.deletedByOwner).toBe(true);

    // Bob keeps a copy of his own; the original lets him go.
    const copy = await call('POST', `/cubes/${cubeId}/copy`, bob);
    expect(copy.statusCode).toBe(201);
    expect(copy.json().cube).toMatchObject({ name: 'Legacy (copy)', ownerId: await me(bob), deletedByOwner: false });
    expect(copy.json().version.cards).toEqual([{ printingId: card, quantity: 3 }]);
    const names = (await call('GET', '/cubes', bob)).json().map((c: { name: string }) => c.name);
    expect(names).toContain('Legacy (copy)');
    expect(names).not.toContain('Legacy');
    // Carol, the last one holding it, deletes it too: now it is gone for good.
    expect((await call('DELETE', `/cubes/${cubeId}`, carol)).statusCode).toBe(204);
    expect((await call('GET', `/cubes/${cubeId}`, carol)).statusCode).toBe(404);
    expect(await ctx.app.db.select().from(schema.cubes).where(eq(schema.cubes.id, cubeId))).toEqual([]);
  });

  it('does the same for a shared draft format', async () => {
    const created = await call('POST', '/cubes', alice, { name: 'Pool', cards: [{ printingId: card, quantity: 6 }] });
    const versionId = created.json().version.id as string;
    await share(created.json().cube.id, bob);
    const config = { name: 'Ours', seats: 2, startDirection: 'left', phases: [{ type: 'pickAndPass', name: 'Only', poolCubeVersionId: versionId, packSize: 3, packsPerPlayer: 1, rounds: 1, direction: 'alternate' }] };
    const id = (await call('POST', '/draft-configs', alice, { name: 'Ours', config })).json().id as string;
    const bobId = await me(bob);
    await call('POST', `/draft-configs/${id}/members`, alice, { userId: bobId });
    await call('POST', `/draft-configs/${id}/membership`, bob, { accept: true });

    expect((await call('DELETE', `/draft-configs/${id}`, alice)).statusCode).toBe(204);
    expect((await call('GET', `/draft-configs/${id}`, alice)).statusCode).toBe(404);
    expect((await call('GET', '/draft-configs', bob)).json()).toEqual(expect.arrayContaining([expect.objectContaining({ id, deletedByOwner: true })]));
    const copy = await call('POST', `/draft-configs/${id}/copy`, bob);
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ name: 'Ours (copy)', ownerId: bobId, deletedByOwner: false });
    expect(await ctx.app.db.select().from(schema.draftConfigs).where(eq(schema.draftConfigs.id, id))).toEqual([]);
  });
});
