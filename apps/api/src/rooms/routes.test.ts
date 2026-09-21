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

describe('draft rooms over HTTP', () => {
  const cardIds = [0, 1, 2, 3].map((i) => `55555555-5555-4555-8555-55555555555${i}`);

  it('projects packs per viewer, streams reveals, and serves the pick log once finished', async () => {
    const db = ctx.app.db;
    const { schema } = await import('../db/index.js');
    await db.insert(schema.cards).values(cardIds.map((id, i) => ({
      id, name: `Card ${i}`, lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
      collectorNumber: String(i), releasedAt: '1993-08-05', rarity: 'common', colorIdentity: [], faces: [], oracleId: null,
    })));
    const cube = await call('POST', '/cubes', alice, { name: 'Tiny', cards: cardIds.map((printingId) => ({ printingId, quantity: 1 })) });
    expect(cube.statusCode).toBe(201);
    const versionId = cube.json().version.id as string;
    const draft = { name: 'Tiny', seats: 2, startDirection: 'left', phases: [{ type: 'pickAndPass', name: 'Only', poolCubeVersionId: versionId, packSize: 2, packsPerPlayer: 1, rounds: 1, direction: 'alternate' }] };

    const created = await call('POST', '/rooms', alice, { settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false, draft } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    await call('POST', `/rooms/${id}/commands`, bob, { type: 'join' });
    await call('POST', `/rooms/${id}/commands`, alice, { type: 'setReady', ready: true });
    await call('POST', `/rooms/${id}/commands`, bob, { type: 'setReady', ready: true });
    const seqBefore = (await call('GET', `/rooms/${id}`, alice)).json().seq as number;
    const started = await call('POST', `/rooms/${id}/commands`, alice, { type: 'start' });
    expect(started.statusCode).toBe(200);

    expect((await call('GET', `/rooms/${id}/draft/picks`, alice)).statusCode).toBe(400);

    const forBob = (await call('GET', `/rooms/${id}`, bob)).json();
    expect(forBob.phase).toBe('drafting');
    const bobId = forBob.draft.seats[1] as string;
    const bobPack = forBob.draft.packs[forBob.draft.players[bobId].queue[0]];
    expect(bobPack.cards.every((c: { printingId: string }) => cardIds.includes(c.printingId))).toBe(true);
    const alicePack = forBob.draft.packs[forBob.draft.players[forBob.draft.seats[0]].queue[0]];
    expect(alicePack.cards.every((c: { printingId: string }) => c.printingId === '')).toBe(true);

    const events = (await call('GET', `/rooms/${id}/events?after=${seqBefore}`, bob)).json();
    expect(events).toHaveLength(1);
    expect(events[0].event.packs.every((p: { cards: { printingId: null }[] }) => p.cards.every((c) => c.printingId === null))).toBe(true);
    expect(events[0].draftRevealed).toHaveLength(2);

    const pick = async (cookie: string) => {
      const s = (await call('GET', `/rooms/${id}`, cookie)).json();
      const meId = Object.keys(s.draft.players).find((p) => s.draft.packs[s.draft.players[p].queue[0]]?.cards[0]?.printingId)!;
      const pack = s.draft.packs[s.draft.players[meId].queue[0]];
      const r = await call('POST', `/rooms/${id}/commands`, cookie, { type: 'draftPick', cardId: pack.cards[0].id });
      expect(r.statusCode).toBe(200);
      return r.json();
    };
    const first = await pick(alice);
    expect(first.events[0].draftHidden).toHaveLength(1);
    expect((await call('POST', `/rooms/${id}/commands`, alice, { type: 'draftPick', cardId: 'nope' })).json().message).toBe('No pack to pick from — waiting for the pack to be passed');
    await pick(bob);
    await pick(alice);
    await pick(bob);

    expect((await call('GET', `/rooms/${id}`, alice)).json().phase).toBe('deckbuilding');
    const log = await call('GET', `/rooms/${id}/draft/picks`, bob);
    expect(log.statusCode).toBe(200);
    expect(log.json().map((p: { n: number; pickInPack: number }) => [p.n, p.pickInPack])).toEqual([[1, 1], [2, 1], [3, 2], [4, 2]]);
    expect((await call('GET', `/rooms/${id}/draft/picks`, alice)).json()).toHaveLength(4);
  });
});

describe('cube draft statistics', () => {
  it('aggregates the picks of every draft that dealt from the cube', async () => {
    const db = ctx.app.db;
    const { schema } = await import('../db/index.js');
    const cardIds = [0, 1, 2, 3].map((i) => `77777777-7777-4777-8777-77777777777${i}`);
    await db.insert(schema.cards).values(cardIds.map((id, i) => ({
      id, name: `Stat ${i}`, lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
      collectorNumber: String(20 + i), releasedAt: '1993-08-05', rarity: 'common', colorIdentity: [], faces: [], oracleId: null,
    })));
    const cube = await call('POST', '/cubes', alice, { name: 'Stats', cards: cardIds.map((printingId) => ({ printingId, quantity: 1 })) });
    const cubeId = cube.json().cube.id as string;
    const versionId = cube.json().version.id as string;
    expect((await call('GET', `/cubes/${cubeId}/stats`, alice)).json()).toMatchObject({ drafts: 0, picks: 0, stats: [] });

    const draft = { name: 'Tiny', seats: 2, startDirection: 'left', phases: [{ type: 'pickAndPass', name: 'Only', poolCubeVersionId: versionId, packSize: 2, packsPerPlayer: 1, rounds: 1, direction: 'alternate' }] };
    const room = (await call('POST', '/rooms', alice, { settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false, draft } })).json().id as string;
    await call('POST', `/rooms/${room}/commands`, bob, { type: 'join' });
    await call('POST', `/rooms/${room}/commands`, alice, { type: 'setReady', ready: true });
    await call('POST', `/rooms/${room}/commands`, bob, { type: 'setReady', ready: true });
    expect((await call('POST', `/rooms/${room}/commands`, alice, { type: 'start' })).statusCode).toBe(200);
    for (const cookie of [alice, bob, alice, bob]) {
      const s = (await call('GET', `/rooms/${room}`, cookie)).json();
      const meId = Object.keys(s.draft.players).find((p) => s.draft.packs[s.draft.players[p].queue[0]]?.cards[0]?.printingId)!;
      const pack = s.draft.packs[s.draft.players[meId].queue[0]];
      expect((await call('POST', `/rooms/${room}/commands`, cookie, { type: 'draftPick', cardId: pack.cards[0].id })).statusCode).toBe(200);
    }

    // A reported game from that draft feeds the win rates.
    const { schema: s } = await import('../db/index.js');
    const aliceId = (await ctx.app.inject({ url: '/me', headers: { cookie: alice } })).json().id as string;
    const bobId = (await ctx.app.inject({ url: '/me', headers: { cookie: bob } })).json().id as string;
    await db.insert(s.gameResults).values({
      roomId: room, gameNumber: 1, reportedBy: aliceId, winners: [aliceId], mode: '1v1', playerCount: 2, commander: false, draftName: 'Tiny', note: null,
      players: [
        { playerId: aliceId, seat: 0, team: 0, deck: { main: [{ printingId: cardIds[0]!, quantity: 1 }], sideboard: [], commander: [] } },
        { playerId: bobId, seat: 1, team: 1, deck: { main: [{ printingId: cardIds[1]!, quantity: 1 }], sideboard: [], commander: [] } },
      ],
    });

    const res = await call('GET', `/cubes/${cubeId}/stats`, alice);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ drafts: 1, picks: 4, games: 1 });
    expect(body.records).toEqual([
      { printingId: cardIds[0], games: 1, wins: 1, winRate: null },
      { printingId: cardIds[1], games: 1, wins: 0, winRate: null },
    ]);
    expect(body.versions).toHaveLength(1);
    expect(body.stats).toHaveLength(4);
    expect(body.stats.reduce((n: number, s: { taken: number }) => n + s.taken, 0)).toBe(4);
    // Two first picks out of two untouched packs; two cards seen twice and passed once.
    expect(body.stats.filter((s: { firstPicks: number }) => s.firstPicks === 1)).toHaveLength(2);
    expect(body.stats.filter((s: { passed: number }) => s.passed === 1)).toHaveLength(2);
    expect(body.printings).toHaveLength(4);
    expect((await call('GET', `/cubes/${cubeId}/stats?version=1`, alice)).json().picks).toBe(4);
    expect((await call('GET', `/cubes/${cubeId}/stats?version=9`, alice)).statusCode).toBe(404);
    expect((await call('GET', `/cubes/${cubeId}/stats?to=2000-01-01`, alice)).json().picks).toBe(0);
    expect((await call('GET', `/cubes/${cubeId}/stats`, bob)).statusCode).toBe(404);
  });
});

describe('remembered tokens', () => {
  it('records the tokens a player makes and offers them again, this deck first', async () => {
    const db = ctx.app.db;
    const { schema } = await import('../db/index.js');
    const soldier = 'aaaa1111-1111-4111-8111-111111111111';
    const card = 'aaaa2222-2222-4222-8222-222222222222';
    await db.insert(schema.cards).values([
      { id: soldier, name: 'Soldier', lang: 'en', layout: 'token', setCode: 'tm21', setName: 'Tokens', setType: 'token', collectorNumber: '1', releasedAt: '2020-01-01', rarity: 'common', colorIdentity: ['W'], faces: [], oracleId: null, isToken: true },
      { id: card, name: 'Raise the Alarm', lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core', collectorNumber: '9', releasedAt: '1993-08-05', rarity: 'common', colorIdentity: ['W'], faces: [], oracleId: null },
    ]);
    const aliceId = (await ctx.app.inject({ url: '/me', headers: { cookie: alice } })).json().id as string;
    const bobId = (await ctx.app.inject({ url: '/me', headers: { cookie: bob } })).json().id as string;
    const contents = { main: [{ printingId: card, quantity: 9 }], sideboard: [], commander: [] };
    const [deckA] = await db.insert(schema.decks).values({ ownerId: aliceId, name: 'Soldiers', contents }).returning();
    const [deckB] = await db.insert(schema.decks).values({ ownerId: bobId, name: 'Theirs', contents }).returning();

    expect((await call('GET', '/cards/tokens/recent', alice)).json()).toEqual({ tokens: [] });

    const created = await call('POST', '/rooms', alice, { settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false } });
    const id = created.json().id as string;
    const cmd = (cookie: string, command: object) => call('POST', `/rooms/${id}/commands`, cookie, command);
    await cmd(bob, { type: 'join' });
    await cmd(alice, { type: 'selectDeck', deckId: deckA!.id });
    await cmd(bob, { type: 'selectDeck', deckId: deckB!.id });
    await cmd(alice, { type: 'setReady', ready: true });
    await cmd(bob, { type: 'setReady', ready: true });
    expect((await cmd(alice, { type: 'start' })).statusCode).toBe(200);
    for (const cookie of [alice, bob]) await cmd(cookie, { type: 'finishSideboarding' });
    for (const cookie of [alice, bob]) await cmd(cookie, { type: 'keepHand', bottom: [] });

    expect((await cmd(alice, { type: 'createToken', printingId: soldier, customName: null, count: 2 })).statusCode).toBe(200);
    expect((await cmd(alice, { type: 'createToken', printingId: null, customName: 'Clue', count: 1 })).statusCode).toBe(200);

    const mine = (await call('GET', `/cards/tokens/recent?deckId=${deckA!.id}`, alice)).json().tokens;
    expect(mine.map((t: { printing: { name: string } | null; customName: string | null; uses: number; thisDeck: boolean }) => [t.printing?.name ?? t.customName, t.uses, t.thisDeck]))
      .toEqual([['Soldier', 2, true], ['Clue', 1, true]]);
    // Another deck still sees them, just not marked as its own.
    expect((await call('GET', `/cards/tokens/recent?deckId=${deckB!.id}`, alice)).json().tokens.every((t: { thisDeck: boolean }) => !t.thisDeck)).toBe(true);
    // They belong to the player who made them.
    expect((await call('GET', '/cards/tokens/recent', bob)).json()).toEqual({ tokens: [] });

    // Making the same token again counts up rather than duplicating.
    await cmd(alice, { type: 'createToken', printingId: soldier, customName: null, count: 3 });
    const again = (await call('GET', `/cards/tokens/recent?deckId=${deckA!.id}`, alice)).json().tokens;
    expect(again).toHaveLength(2);
    expect(again[0]).toMatchObject({ uses: 5 });
  });
});
