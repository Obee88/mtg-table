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
