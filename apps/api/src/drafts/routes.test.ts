import { houseRulesPreset } from '@mtg/shared';
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '../db/index.js';
import { sessionCookie, TEST_ORIGIN, testApp } from '../test/app.js';

let ctx: Awaited<ReturnType<typeof testApp>>;
let alice: string;
let bob: string;

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: object): Promise<LightMyRequestResponse> => {
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

/** A cube with `n` distinct single-copy cards, owned by the caller; returns the version id. */
async function cube(cookie: string, name: string, n: number, prefix: string): Promise<string> {
  const ids = Array.from({ length: n }, (_, i) => `${prefix}-0000-4000-8000-${String(i).padStart(12, '0')}`);
  await ctx.app.db.insert(schema.cards).values(ids.map((id, i) => ({
    id, name: `${name} ${i}`, lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
    collectorNumber: String(i), releasedAt: '1993-08-05', rarity: 'common', colorIdentity: [], faces: [], oracleId: null,
  }))).onConflictDoNothing();
  const res = await call('POST', '/cubes', cookie, { name, cards: ids.map((printingId) => ({ printingId, quantity: 1 })) });
  expect(res.statusCode).toBe(201);
  return res.json().version.id as string;
}

describe('draft configs', () => {
  it('saves the house-rules preset with resolved pools, lists, updates and deletes it', async () => {
    const tri = await cube(alice, 'Tri', 20, '77777777');
    const main = await cube(alice, 'Main', 30, '88888888');
    const config = houseRulesPreset({ triColour: tri, main });
    const created = await call('POST', '/draft-configs', alice, { name: 'Our house', config });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.json().config.name).toBe('Our house');
    expect(created.json().pools).toEqual(expect.arrayContaining([
      expect.objectContaining({ versionId: tri, cubeName: 'Tri', versionNumber: 1, cardCount: 20 }),
      expect.objectContaining({ versionId: main, cubeName: 'Main', versionNumber: 1, cardCount: 30 }),
    ]));

    expect((await call('GET', '/draft-configs', alice)).json()).toEqual([expect.objectContaining({ id, name: 'Our house', seats: 4, phaseCount: 2 })]);
    expect((await call('GET', '/draft-configs', bob)).json()).toEqual([]);
    expect((await call('GET', `/draft-configs/${id}`, bob)).statusCode).toBe(404);

    const updated = await call('PUT', `/draft-configs/${id}`, alice, { name: 'Two seats', config: { ...config, seats: 2 } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().config.seats).toBe(2);
    expect((await call('GET', `/draft-configs/${id}`, alice)).json().name).toBe('Two seats');

    expect((await call('DELETE', `/draft-configs/${id}`, bob)).statusCode).toBe(404);
    expect((await call('DELETE', `/draft-configs/${id}`, alice)).statusCode).toBe(204);
    expect((await call('GET', '/draft-configs', alice)).json()).toEqual([]);
  });

  it('rejects pools that are not versions of the caller\'s cubes, and malformed configs', async () => {
    const theirs = await cube(bob, 'Bobs', 5, '99999999');
    const config = houseRulesPreset({ triColour: theirs, main: theirs });
    const res = await call('POST', '/draft-configs', alice, { name: 'Nope', config });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Every phase must draw from a version of one of your cubes, or a cube shared with you');
    expect((await call('POST', '/draft-configs', alice, { name: 'Nope', config: { ...config, phases: [] } })).statusCode).toBe(400);
    expect((await call('POST', '/draft-configs', alice, { name: 'Nope', config: { ...config, seats: 3 } })).statusCode).toBe(400);
    expect((await ctx.app.inject({ url: '/draft-configs' })).statusCode).toBe(401);
  });
});
