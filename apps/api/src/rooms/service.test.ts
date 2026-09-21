import type { RoomSettings } from '@mtg/shared';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { schema, type Db } from '../db/index.js';
import { testDb } from '../test/db.js';
import { RoomService } from './service.js';

const silentLog = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return silentLog; } } as never;
const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };

let db: Db;
let close: () => Promise<void>;
let alice: { id: string; displayName: string };
let bob: { id: string; displayName: string };

beforeAll(async () => {
  ({ db, close } = await testDb());
  const rows = await db
    .insert(schema.users)
    .values([
      { email: 'a@x.io', passwordHash: 'x', displayName: 'Alice' },
      { email: 'b@x.io', passwordHash: 'x', displayName: 'Bob' },
    ])
    .returning();
  alice = { id: rows[0]!.id, displayName: 'Alice' };
  bob = { id: rows[1]!.id, displayName: 'Bob' };
});
afterAll(() => close());

describe('RoomService', () => {
  it('creates a room with the owner seated and persists the events', async () => {
    const service = new RoomService(db, silentLog);
    const state = await service.create(alice, settings);
    expect(state.ownerId).toBe(alice.id);
    expect(state.players[alice.id]).toMatchObject({ seat: 0, displayName: 'Alice' });
    expect(state.seq).toBe(2);
    const events = await service.eventsSince(state.id, 0);
    expect(events.map((e) => [e.seq, e.event.type])).toEqual([[1, 'roomCreated'], [2, 'playerJoined']]);
    const members = await db.select().from(schema.roomPlayers).where(eq(schema.roomPlayers.roomId, state.id));
    expect(members).toEqual([{ roomId: state.id, userId: alice.id, seat: 0 }]);
  });

  it('rebuilds state from the log in a fresh service instance', async () => {
    const a = new RoomService(db, silentLog);
    const room = await a.create(alice, settings);
    await a.dispatch(room.id, bob, { type: 'join' });
    await a.dispatch(room.id, bob, { type: 'selectDeck', deckId: 'deck-1' });

    const b = new RoomService(db, silentLog);
    const state = await b.get(room.id);
    expect(state.seq).toBe(4);
    expect(state.players[bob.id]).toMatchObject({ seat: 1, deckId: 'deck-1' });
  });

  it('rejects invalid commands without writing anything', async () => {
    const service = new RoomService(db, silentLog);
    const room = await service.create(alice, settings);
    const result = await service.dispatch(room.id, bob, { type: 'leave' });
    expect(result).toEqual({ ok: false, error: 'Not in the room' });
    expect((await service.get(room.id)).seq).toBe(2);
  });

  it('serialises concurrent commands so seats are never double-booked', async () => {
    const service = new RoomService(db, silentLog);
    const room = await service.create(alice, { ...settings, playerCount: 4, mode: 'ffa' });
    const extra = await db
      .insert(schema.users)
      .values([1, 2, 3, 4, 5].map((n) => ({ email: `u${n}@x.io`, passwordHash: 'x', displayName: `U${n}` })))
      .returning();
    const results = await Promise.all(extra.map((u) => service.dispatch(room.id, { id: u.id, displayName: u.displayName }, { type: 'join' })));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok).map((r) => (r.ok ? '' : r.error))).toEqual(['Room is full', 'Room is full']);
    const seats = Object.values((await service.get(room.id)).players).map((p) => p.seat).sort();
    expect(seats).toEqual([0, 1, 2, 3]);
    const events = await service.eventsSince(room.id, 0);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('snapshots every 50 events and loads from snapshot + tail', async () => {
    const service = new RoomService(db, silentLog);
    const room = await service.create(alice, settings);
    await service.dispatch(room.id, bob, { type: 'join' });
    await service.dispatch(room.id, bob, { type: 'selectDeck', deckId: 'd' });
    // toggle ready 60 times → 64 events total
    for (let i = 0; i < 60; i++) await service.dispatch(room.id, bob, { type: 'setReady', ready: i % 2 === 0 });
    const [snap] = await db.select().from(schema.roomSnapshots).where(eq(schema.roomSnapshots.roomId, room.id));
    expect(snap?.seq).toBe(50);
    const [counted] = await db.select({ n: count() }).from(schema.roomEvents).where(eq(schema.roomEvents.roomId, room.id));
    expect(counted?.n).toBe(64);

    const fresh = new RoomService(db, silentLog);
    const state = await fresh.get(room.id);
    expect(state.seq).toBe(64);
    expect(state.players[bob.id]?.ready).toBe(false); // last toggle (i=59) set false
  });

  it('notifies listeners with the new events and state', async () => {
    const service = new RoomService(db, silentLog);
    const room = await service.create(alice, settings);
    const seen: number[] = [];
    const unsubscribe = service.subscribe(room.id, (events) => seen.push(...events.map((e) => e.seq)));
    await new Promise((r) => setTimeout(r, 0));
    await service.dispatch(room.id, bob, { type: 'join' });
    unsubscribe();
    await service.dispatch(room.id, bob, { type: 'leave' });
    expect(seen).toEqual([3]);
  });

  it('evicts idle rooms and reloads them transparently', async () => {
    const service = new RoomService(db, silentLog);
    const room = await service.create(alice, settings);
    expect(service.evictIdle(Date.now() + 60 * 60 * 1000)).toBe(1);
    expect((await service.get(room.id)).players[alice.id]).toBeDefined();
  });

  it('404s for unknown rooms', async () => {
    const service = new RoomService(db, silentLog);
    await expect(service.get('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 });
  });
});

describe('start', () => {
  it('loads each player\'s own deck and deals the game', async () => {
    const service = new RoomService(db, silentLog);
    const [card] = await db.insert(schema.cards).values({
      id: '11111111-1111-4111-8111-111111111111', name: 'Lightning Bolt', lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
      collectorNumber: '161', releasedAt: '1993-08-05', rarity: 'common', colorIdentity: ['R'], faces: [], oracleId: null,
    }).returning();
    const [deckA] = await db.insert(schema.decks).values({ ownerId: alice.id, name: 'A', contents: { main: [{ printingId: card!.id, quantity: 10 }], sideboard: [], commander: [] } }).returning();
    const [deckB] = await db.insert(schema.decks).values({ ownerId: bob.id, name: 'B', contents: { main: [{ printingId: card!.id, quantity: 8 }], sideboard: [], commander: [] } }).returning();

    const room = await service.create(alice, settings);
    await service.dispatch(room.id, bob, { type: 'join' });
    // Bob tries to use Alice's deck: it is not his, so start fails for him.
    await service.dispatch(room.id, alice, { type: 'selectDeck', deckId: deckA!.id });
    await service.dispatch(room.id, bob, { type: 'selectDeck', deckId: deckA!.id });
    await service.dispatch(room.id, alice, { type: 'setReady', ready: true });
    await service.dispatch(room.id, bob, { type: 'setReady', ready: true });
    expect(await service.dispatch(room.id, alice, { type: 'start' })).toEqual({ ok: false, error: 'Bob has no usable deck' });

    await service.dispatch(room.id, bob, { type: 'selectDeck', deckId: deckB!.id });
    await service.dispatch(room.id, bob, { type: 'setReady', ready: true });
    const started = await service.dispatch(room.id, alice, { type: 'start' });
    expect(started.ok).toBe(true);
    const state = await new RoomService(db, silentLog).get(room.id);
    expect(state.phase).toBe('playing');
    expect(state.game?.players[alice.id]?.zones.hand).toHaveLength(7);
    expect(state.game?.players[bob.id]?.zones.library).toHaveLength(1);
    const [row] = await db.select().from(schema.rooms).where(eq(schema.rooms.id, room.id));
    expect(row?.phase).toBe('playing');
  });
});

describe('undo', () => {
  const deckContents = (id: string) => ({ main: [{ printingId: id, quantity: 9 }], sideboard: [], commander: [] });

  async function startedRoom() {
    const service = new RoomService(db, silentLog);
    const [card] = await db.insert(schema.cards).values({
      id: '33333333-3333-4333-8333-333333333333', name: 'Forest', lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
      collectorNumber: '2', releasedAt: '1993-08-05', rarity: 'common', colorIdentity: ['G'], faces: [], oracleId: null,
    }).onConflictDoNothing().returning();
    const cardId = card?.id ?? '33333333-3333-4333-8333-333333333333';
    const [deckA] = await db.insert(schema.decks).values({ ownerId: alice.id, name: 'A', contents: deckContents(cardId) }).returning();
    const [deckB] = await db.insert(schema.decks).values({ ownerId: bob.id, name: 'B', contents: deckContents(cardId) }).returning();
    const room = await service.create(alice, settings);
    await service.dispatch(room.id, bob, { type: 'join' });
    await service.dispatch(room.id, alice, { type: 'selectDeck', deckId: deckA!.id });
    await service.dispatch(room.id, bob, { type: 'selectDeck', deckId: deckB!.id });
    await service.dispatch(room.id, alice, { type: 'setReady', ready: true });
    await service.dispatch(room.id, bob, { type: 'setReady', ready: true });
    const started = await service.dispatch(room.id, alice, { type: 'start' });
    if (!started.ok) throw new Error(started.error);
    await service.dispatch(room.id, alice, { type: 'finishSideboarding' });
    await service.dispatch(room.id, bob, { type: 'finishSideboarding' });
    await service.dispatch(room.id, alice, { type: 'keepHand', bottom: [] });
    await service.dispatch(room.id, bob, { type: 'keepHand', bottom: [] });
    return { service, roomId: room.id };
  }

  it('restores the state before the last own batch, exactly', async () => {
    const { service, roomId } = await startedRoom();
    const before = await service.get(roomId);
    const drawn = await service.dispatch(roomId, alice, { type: 'draw', count: 2 });
    expect(drawn.ok && drawn.events).toHaveLength(2);
    const undo = await service.dispatch(roomId, alice, { type: 'undo' });
    expect(undo.ok).toBe(true);
    const after = await service.get(roomId);
    expect({ ...after, seq: 0 }).toEqual({ ...before, seq: 0 });
    expect(after.seq).toBe(before.seq + 3);
    // A fresh load from the log agrees.
    expect(await new RoomService(db, silentLog).get(roomId)).toEqual(after);
  });

  it('refuses when someone else acted since, when nothing undoable, and twice in a row', async () => {
    const { service, roomId } = await startedRoom();
    expect(await service.dispatch(roomId, bob, { type: 'undo' })).toEqual({ ok: false, error: 'That action cannot be undone' }); // last batch = Bob keeping his hand
    await service.dispatch(roomId, alice, { type: 'draw', count: 1 });
    await service.dispatch(roomId, bob, { type: 'draw', count: 1 });
    expect(await service.dispatch(roomId, alice, { type: 'undo' })).toEqual({ ok: false, error: 'Someone else acted since your last action' });
    expect((await service.dispatch(roomId, bob, { type: 'undo' })).ok).toBe(true);
    expect(await service.dispatch(roomId, bob, { type: 'undo' })).toEqual({ ok: false, error: 'That action cannot be undone' });
  });
});

describe('draft rooms', () => {
  const cardIds = [0, 1, 2, 3].map((i) => `44444444-4444-4444-8444-44444444444${i}`);
  const config = (poolCubeVersionId: string) => ({
    name: 'Tiny', seats: 2 as const, startDirection: 'left' as const,
    phases: [{ type: 'pickAndPass' as const, name: 'Only', poolCubeVersionId, packSize: 2, packsPerPlayer: 1, rounds: 1, direction: 'alternate' as const }],
  });

  async function cubeVersion(): Promise<string> {
    await db.insert(schema.cards).values(cardIds.map((id, i) => ({
      id, name: i === 0 ? 'Cogwork Librarian' : `Card ${i}`, lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
      collectorNumber: String(i), releasedAt: '1993-08-05', rarity: 'common', colorIdentity: [], faces: [], oracleId: null,
    }))).onConflictDoNothing();
    const [cube] = await db.insert(schema.cubes).values({ ownerId: alice.id, name: 'Tiny cube' }).returning();
    const [version] = await db.insert(schema.cubeVersions).values({ cubeId: cube!.id, number: 1, createdBy: alice.id }).returning();
    await db.insert(schema.cubeVersionCards).values(cardIds.map((cardId) => ({ versionId: version!.id, cardId, quantity: 1 })));
    return version!.id;
  }

  it('deals from the cube version, passes packs, records every pick and ends in deckbuilding', async () => {
    const service = new RoomService(db, silentLog);
    const versionId = await cubeVersion();
    const room = await service.create(alice, { ...settings, draft: config(versionId) });
    await service.dispatch(room.id, bob, { type: 'join' });
    expect((await service.dispatch(room.id, alice, { type: 'setReady', ready: true })).ok).toBe(true); // no deck needed
    await service.dispatch(room.id, bob, { type: 'setReady', ready: true });
    const started = await service.dispatch(room.id, alice, { type: 'start' });
    expect(started.ok).toBe(true);
    let state = await service.get(room.id);
    expect(state.phase).toBe('drafting');
    expect(state.draft?.seats).toEqual([alice.id, bob.id]);
    const dealt = Object.values(state.draft!.packs).flatMap((p) => p.cards.map((c) => c.printingId)).sort();
    expect(dealt).toEqual([...cardIds].sort());
    // Draft-matters cards are recognised by name when the pools are loaded.
    const librarian = Object.values(state.draft!.packs).flatMap((p) => p.cards).find((c) => c.printingId === cardIds[0]);
    expect(librarian?.ability).toBe('librarian');

    const pickTop = async (who: typeof alice) => {
      const s = await service.get(room.id);
      const pack = s.draft!.packs[s.draft!.players[who.id]!.queue[0]!]!;
      const r = await service.dispatch(room.id, who, { type: 'draftPick', cardId: pack.cards[0]!.id });
      if (!r.ok) throw new Error(r.error);
    };
    await pickTop(alice);
    state = await service.get(room.id);
    expect(state.draft!.players[bob.id]!.queue).toHaveLength(2);
    expect(await service.dispatch(room.id, alice, { type: 'undo' })).toEqual({ ok: false, error: 'That action cannot be undone' });
    await pickTop(bob);
    await pickTop(alice);
    await pickTop(bob);
    state = await new RoomService(db, silentLog).get(room.id);
    expect(state.phase).toBe('deckbuilding');
    expect(state.draft?.status).toBe('finished');
    expect(state.draft!.players[alice.id]!.pool).toHaveLength(2);
    const [row] = await db.select().from(schema.rooms).where(eq(schema.rooms.id, room.id));
    expect(row?.phase).toBe('deckbuilding');

    const picks = await db.select().from(schema.draftPicks).where(eq(schema.draftPicks.roomId, room.id)).orderBy(schema.draftPicks.overallPick);
    expect(picks.map((p) => [p.overallPick, p.playerId === alice.id ? 'A' : 'B', p.pickInPack, p.packContents.length])).toEqual([[1, 'A', 1, 2], [2, 'B', 1, 2], [3, 'A', 2, 1], [4, 'B', 2, 1]]);
    expect(picks.every((p) => cardIds.includes(p.cardId) && p.packContents.includes(p.cardId))).toBe(true);
  });

  it('refuses to start when a cube version is gone or too small', async () => {
    const service = new RoomService(db, silentLog);
    const room = await service.create(alice, { ...settings, draft: config('00000000-0000-4000-8000-000000000000') });
    await service.dispatch(room.id, bob, { type: 'join' });
    await service.dispatch(room.id, alice, { type: 'setReady', ready: true });
    await service.dispatch(room.id, bob, { type: 'setReady', ready: true });
    expect(await service.dispatch(room.id, alice, { type: 'start' })).toEqual({ ok: false, error: 'A cube version this draft uses no longer exists' });

    const versionId = await cubeVersion();
    const big = { ...config(versionId), phases: [{ ...config(versionId).phases[0]!, packSize: 5 }] };
    await service.dispatch(room.id, alice, { type: 'updateSettings', settings: { ...settings, draft: big } });
    await service.dispatch(room.id, alice, { type: 'setReady', ready: true });
    await service.dispatch(room.id, bob, { type: 'setReady', ready: true });
    expect(await service.dispatch(room.id, alice, { type: 'start' })).toEqual({ ok: false, error: 'Phase 1 (Only) needs 10 cards but the pool has 4' });
  });
});

describe('deckbuilding over the service', () => {
  it('accepts only basic lands for free and starts the game from the submitted decks', async () => {
    const service = new RoomService(db, silentLog);
    const cardIds = [0, 1, 2, 3].map((i) => `44444444-4444-4444-8444-44444444444${i}`);
    const forest = '44444444-4444-4444-8444-444444444499';
    await db.insert(schema.cards).values(cardIds.map((id, i) => ({
      id, name: `Card ${i}`, lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
      collectorNumber: String(i), releasedAt: '1993-08-05', rarity: 'common', colorIdentity: [], faces: [], oracleId: null,
    }))).onConflictDoNothing();
    await db.insert(schema.cards).values({
      id: forest, name: 'Forest', lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core', typeLine: 'Basic Land — Forest',
      collectorNumber: '99', releasedAt: '1993-08-05', rarity: 'common', colorIdentity: ['G'], faces: [], oracleId: null,
    }).onConflictDoNothing();
    const [cube] = await db.insert(schema.cubes).values({ ownerId: alice.id, name: 'Deck cube' }).returning();
    const [version] = await db.insert(schema.cubeVersions).values({ cubeId: cube!.id, number: 1, createdBy: alice.id }).returning();
    await db.insert(schema.cubeVersionCards).values(cardIds.map((cardId) => ({ versionId: version!.id, cardId, quantity: 1 })));
    const draft = { name: 'Tiny', seats: 2 as const, startDirection: 'left' as const, phases: [{ type: 'pickAndPass' as const, name: 'Only', poolCubeVersionId: version!.id, packSize: 2, packsPerPlayer: 1, rounds: 1, direction: 'alternate' as const }] };

    const room = await service.create(alice, { ...settings, draft });
    await service.dispatch(room.id, bob, { type: 'join' });
    await service.dispatch(room.id, alice, { type: 'setReady', ready: true });
    await service.dispatch(room.id, bob, { type: 'setReady', ready: true });
    expect((await service.dispatch(room.id, alice, { type: 'start' })).ok).toBe(true);
    for (const who of [alice, bob, alice, bob]) {
      const s = await service.get(room.id);
      const pack = s.draft!.packs[s.draft!.players[who.id]!.queue[0]!]!;
      expect((await service.dispatch(room.id, who, { type: 'draftPick', cardId: pack.cards[0]!.id })).ok).toBe(true);
    }
    let state = await service.get(room.id);
    expect(state.phase).toBe('deckbuilding');

    const mine = state.draft!.players[alice.id]!.pool.map((c) => c.id);
    expect(await service.dispatch(room.id, alice, { type: 'submitDraftDeck', main: mine, basics: [{ printingId: cardIds[0]!, quantity: 1 }] })).toEqual({ ok: false, error: 'Only basic lands can be added for free' });
    expect((await service.dispatch(room.id, alice, { type: 'submitDraftDeck', main: mine, basics: [{ printingId: forest, quantity: 38 }] })).ok).toBe(true);
    expect(await service.dispatch(room.id, alice, { type: 'undo' })).toEqual({ ok: false, error: 'That action cannot be undone' });
    const theirs = state.draft!.players[bob.id]!.pool.map((c) => c.id);
    expect((await service.dispatch(room.id, bob, { type: 'submitDraftDeck', main: theirs.slice(0, 1), basics: [{ printingId: forest, quantity: 39 }] })).ok).toBe(true);
    expect((await service.dispatch(room.id, alice, { type: 'start' })).ok).toBe(true);
    state = await new RoomService(db, silentLog).get(room.id);
    expect(state.phase).toBe('playing');
    const a = state.game!.players[alice.id]!.zones;
    expect(a.library.length + a.hand.length).toBe(2 + 38);
    expect(state.game!.players[bob.id]!.zones.sideboard).toHaveLength(1);
  });
});

describe('game results', () => {
  it('stores one denormalised row per game number, replaced on re-report', async () => {
    const { service, roomId } = await (async () => {
      const service = new RoomService(db, silentLog);
      const cardId = '33333333-3333-4333-8333-333333333333';
      await db.insert(schema.cards).values({
        id: cardId, name: 'Forest', lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
        collectorNumber: '2', releasedAt: '1993-08-05', rarity: 'common', colorIdentity: ['G'], faces: [], oracleId: null,
      }).onConflictDoNothing();
      const contents = { main: [{ printingId: cardId, quantity: 9 }], sideboard: [{ printingId: cardId, quantity: 1 }], commander: [] };
      const [deckA] = await db.insert(schema.decks).values({ ownerId: alice.id, name: 'A', contents }).returning();
      const [deckB] = await db.insert(schema.decks).values({ ownerId: bob.id, name: 'B', contents }).returning();
      const room = await service.create(alice, settings);
      await service.dispatch(room.id, bob, { type: 'join' });
      await service.dispatch(room.id, alice, { type: 'selectDeck', deckId: deckA!.id });
      await service.dispatch(room.id, bob, { type: 'selectDeck', deckId: deckB!.id });
      await service.dispatch(room.id, alice, { type: 'setReady', ready: true });
      await service.dispatch(room.id, bob, { type: 'setReady', ready: true });
      const started = await service.dispatch(room.id, alice, { type: 'start' });
      if (!started.ok) throw new Error(started.error);
      return { service, roomId: room.id };
    })();

    expect((await service.dispatch(roomId, bob, { type: 'reportResult', winners: [alice.id], note: 'gg' })).ok).toBe(true);
    expect(await service.dispatch(roomId, bob, { type: 'undo' })).toEqual({ ok: false, error: 'That action cannot be undone' });
    let rows = await db.select().from(schema.gameResults).where(eq(schema.gameResults.roomId, roomId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gameNumber: 1, reportedBy: bob.id, winners: [alice.id], mode: '1v1', playerCount: 2, commander: false, draftName: null, note: 'gg' });
    expect(rows[0]!.players.map((p) => [p.seat, p.deck?.main[0]?.quantity, p.deck?.sideboard[0]?.quantity])).toEqual([[0, 9, 1], [1, 9, 1]]);

    expect((await service.dispatch(roomId, alice, { type: 'reportResult', winners: [] })).ok).toBe(true);
    rows = await db.select().from(schema.gameResults).where(eq(schema.gameResults.roomId, roomId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reportedBy: alice.id, winners: [], note: null });
    expect((await service.get(roomId)).results).toHaveLength(1);
  });
});
