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
    expect(await service.dispatch(roomId, alice, { type: 'undo' })).toEqual({ ok: false, error: 'That action cannot be undone' }); // last batch = gameStarted
    await service.dispatch(roomId, alice, { type: 'draw', count: 1 });
    await service.dispatch(roomId, bob, { type: 'draw', count: 1 });
    expect(await service.dispatch(roomId, alice, { type: 'undo' })).toEqual({ ok: false, error: 'Someone else acted since your last action' });
    expect((await service.dispatch(roomId, bob, { type: 'undo' })).ok).toBe(true);
    expect(await service.dispatch(roomId, bob, { type: 'undo' })).toEqual({ ok: false, error: 'That action cannot be undone' });
  });
});
