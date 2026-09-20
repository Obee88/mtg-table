import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema } from '../db/index.js';
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

describe('player stats', () => {
  it('combines results, head-to-head and draft picks for a player', async () => {
    const me = async (cookie: string) => (await ctx.app.inject({ url: '/me', headers: { cookie } })).json().id as string;
    const [aliceId, bobId] = [await me(alice), await me(bob)];
    const db = ctx.app.db;
    const bolt = '88888888-8888-4888-8888-888888888801';
    await db.insert(schema.cards).values({
      id: bolt, name: 'Lightning Bolt', lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
      collectorNumber: '161', releasedAt: '1993-08-05', rarity: 'common', colorIdentity: ['R'], faces: [], oracleId: null,
    });
    const settings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false } as const;
    const [room] = await db.insert(schema.rooms).values({ ownerId: aliceId, settings, phase: 'playing' }).returning();
    const players = [{ playerId: aliceId, seat: 0, team: 0, deck: { main: [{ printingId: bolt, quantity: 4 }], sideboard: [], commander: [] } }, { playerId: bobId, seat: 1, team: 1, deck: null }];
    await db.insert(schema.gameResults).values([
      { roomId: room!.id, gameNumber: 1, reportedBy: aliceId, winners: [aliceId], mode: '1v1', playerCount: 2, commander: false, draftName: 'House', players, note: null },
      { roomId: room!.id, gameNumber: 2, reportedBy: bobId, winners: [bobId], mode: '1v1', playerCount: 2, commander: false, draftName: 'House', players, note: null },
      { roomId: room!.id, gameNumber: 3, reportedBy: bobId, winners: [], mode: '1v1', playerCount: 2, commander: false, draftName: 'House', players, note: null },
    ]);
    await db.insert(schema.draftPicks).values([
      { roomId: room!.id, overallPick: 1, playerId: aliceId, cardId: bolt, phase: 0, round: 0, packId: 'p', pickInPack: 1, packContents: [bolt], doublePick: false },
      { roomId: room!.id, overallPick: 2, playerId: bobId, cardId: bolt, phase: 0, round: 0, packId: 'q', pickInPack: 3, packContents: [bolt], doublePick: false },
    ]);

    const res = await call('GET', `/players/${aliceId}/stats`, bob);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.player).toEqual({ id: aliceId, displayName: 'Alice' });
    expect(body.stats.record).toEqual({ games: 3, wins: 1, losses: 1, draws: 1 });
    expect(body.stats.byFormat).toEqual([{ format: '1v1 draft', games: 3, wins: 1, losses: 1, draws: 1 }]);
    expect(body.stats.headToHead).toEqual([{ opponentId: bobId, games: 3, wins: 1, losses: 1, draws: 1 }]);
    expect(body.stats.deckHistory).toHaveLength(3);
    expect(body.stats.deckHistory[0].deck.main[0].quantity).toBe(4);
    expect(body.stats.draft).toMatchObject({ drafts: 1, picks: 1, mostPicked: [{ printingId: bolt, count: 1 }], timing: { earlierBy: -1, compared: 1 } });
    expect(body.stats.draft.colours.find((c: { colour: string }) => c.colour === 'R').picks).toBe(1);
    expect(body.names).toEqual({ [aliceId]: 'Alice', [bobId]: 'Bob' });
    expect(body.printings.map((p: { name: string }) => p.name)).toEqual(['Lightning Bolt']);

    expect((await call('GET', '/players/00000000-0000-4000-8000-000000000000/stats', alice)).statusCode).toBe(404);
    expect((await ctx.app.inject({ url: `/players/${aliceId}/stats` })).statusCode).toBe(401);
  });
});
