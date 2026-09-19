import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookie, TEST_ORIGIN, testApp } from '../test/app.js';

let ctx: Awaited<ReturnType<typeof testApp>>;
let alice: string;
let bob: string;

const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object): Promise<LightMyRequestResponse> => {
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
});
afterAll(() => ctx.close());

describe('room routes', () => {
  const settings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
  let roomId: string;

  it('creates a room, lists it, joins and dispatches commands', async () => {
    const created = await call('POST', '/rooms', alice, { settings });
    expect(created.statusCode).toBe(201);
    roomId = created.json().id;

    const listForBob = await call('GET', '/rooms', bob);
    expect(listForBob.json()).toEqual([expect.objectContaining({ id: roomId, phase: 'lobby', playerCount: 1 })]);

    const join = await call('POST', `/rooms/${roomId}/commands`, bob, { type: 'join' });
    expect(join.statusCode).toBe(200);
    expect(join.json().events.map((e: { seq: number }) => e.seq)).toEqual([3]);

    const state = await call('GET', `/rooms/${roomId}`, bob);
    expect(Object.keys(state.json().players)).toHaveLength(2);

    const events = await call('GET', `/rooms/${roomId}/events?after=2`, bob);
    expect(events.json().map((e: { event: { type: string } }) => e.event.type)).toEqual(['playerJoined']);
  });

  it('turns rejected commands into 400s and validates input', async () => {
    const full = await call('POST', `/rooms/${roomId}/commands`, alice, { type: 'join' });
    expect(full.statusCode).toBe(400);
    expect(full.json().message).toBe('Already in the room');
    expect((await call('POST', `/rooms/${roomId}/commands`, alice, { type: 'nonsense' })).statusCode).toBe(400);
    expect((await call('POST', '/rooms', alice, { settings: { ...settings, mode: '2v2' } })).statusCode).toBe(201); // creation trusts settings shape; decide guards changes
    expect((await call('GET', '/rooms/00000000-0000-4000-8000-000000000000', alice)).statusCode).toBe(404);
    expect((await ctx.app.inject({ url: `/rooms/${roomId}` })).statusCode).toBe(401);
  });
});

describe('room list after closing', () => {
  it('drops closed rooms from the list and lets the owner close from any phase', async () => {
    const created = await call('POST', '/rooms', alice, { settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false } });
    const id = created.json().id as string;
    expect((await call('GET', '/rooms', alice)).json().some((r: { id: string }) => r.id === id)).toBe(true);
    expect((await call('POST', `/rooms/${id}/commands`, bob, { type: 'closeRoom' })).statusCode).toBe(400);
    expect((await call('POST', `/rooms/${id}/commands`, alice, { type: 'closeRoom' })).statusCode).toBe(200);
    expect((await call('GET', '/rooms', alice)).json().some((r: { id: string }) => r.id === id)).toBe(false);
    expect((await call('GET', `/rooms/${id}`, alice)).json().phase).toBe('ended');
  });
});
