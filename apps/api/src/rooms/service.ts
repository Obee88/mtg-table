import {
  decide,
  initialRoomState,
  reduce,
  reduceAll,
  type CommandContext,
  type GameCommand,
  type GameEvent,
  type RoomEvent,
  type RoomSettings,
  type RoomState,
} from '@mtg/shared';
import { and, asc, eq, gt } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { HttpError } from '../errors.js';

const SNAPSHOT_EVERY = 50;
const IDLE_EVICT_MS = 30 * 60 * 1000;

export type RoomListener = (events: RoomEvent[], state: RoomState) => void;

interface CachedRoom {
  state: RoomState;
  queue: Promise<unknown>;
  listeners: Set<RoomListener>;
  lastUsed: number;
}

export interface Actor {
  id: string;
  displayName: string;
}

export type DispatchResult = { ok: true; events: RoomEvent[]; state: RoomState } | { ok: false; error: string };

/**
 * Owns live room state. One instance per process; commands for a room are
 * serialised through a per-room promise queue, persisted as events (with a
 * snapshot every SNAPSHOT_EVERY events), then fanned out to listeners.
 */
export class RoomService {
  private readonly cache = new Map<string, CachedRoom>();

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
  ) {}

  async create(owner: Actor, settings: RoomSettings): Promise<RoomState> {
    const [row] = await this.db.insert(schema.rooms).values({ ownerId: owner.id, settings }).returning({ id: schema.rooms.id });
    if (!row) throw new Error('room insert returned no row');
    const cached: CachedRoom = { state: initialRoomState(row.id), queue: Promise.resolve(), listeners: new Set(), lastUsed: Date.now() };
    this.cache.set(row.id, cached);
    await this.append(cached, owner.id, [{ type: 'roomCreated', ownerId: owner.id, settings }]);
    const joined = await this.dispatch(row.id, owner, { type: 'join' });
    if (!joined.ok) throw new Error(joined.error);
    return joined.state;
  }

  /** Current state, loading from snapshot + tail if not cached. */
  async get(roomId: string): Promise<RoomState> {
    return (await this.room(roomId)).state;
  }

  /** Events after `afterSeq`, for reconnects. */
  async eventsSince(roomId: string, afterSeq: number): Promise<RoomEvent[]> {
    const rows = await this.db
      .select()
      .from(schema.roomEvents)
      .where(and(eq(schema.roomEvents.roomId, roomId), gt(schema.roomEvents.seq, afterSeq)))
      .orderBy(asc(schema.roomEvents.seq));
    return rows.map((r) => ({ seq: r.seq, actorId: r.actorId, at: r.createdAt.toISOString(), event: r.payload }));
  }

  /** Validates and applies a command. Serialised per room. */
  async dispatch(roomId: string, actor: Actor, command: GameCommand): Promise<DispatchResult> {
    const room = await this.room(roomId);
    const run = async (): Promise<DispatchResult> => {
      const ctx: CommandContext = { actorId: actor.id, actorDisplayName: actor.displayName, now: new Date() };
      const decision = decide(room.state, command, ctx);
      if (!decision.ok) return decision;
      if (decision.events.length === 0) return { ok: true, events: [], state: room.state };
      const events = await this.append(room, actor.id, decision.events);
      return { ok: true, events, state: room.state };
    };
    // Chain onto the queue; a failure must not poison later commands.
    const result = room.queue.then(run, run);
    room.queue = result.catch(() => undefined);
    return result;
  }

  subscribe(roomId: string, listener: RoomListener): () => void {
    void this.room(roomId).then((room) => room.listeners.add(listener));
    return () => {
      const room = this.cache.get(roomId);
      room?.listeners.delete(listener);
    };
  }

  /** Drops idle rooms from memory; they reload from the database on next use. */
  evictIdle(now = Date.now()): number {
    let n = 0;
    for (const [id, room] of this.cache) {
      if (room.listeners.size === 0 && now - room.lastUsed > IDLE_EVICT_MS) {
        this.cache.delete(id);
        n++;
      }
    }
    return n;
  }

  private async room(roomId: string): Promise<CachedRoom> {
    const cached = this.cache.get(roomId);
    if (cached) {
      cached.lastUsed = Date.now();
      return cached;
    }
    const state = await this.load(roomId);
    const fresh: CachedRoom = { state, queue: Promise.resolve(), listeners: new Set(), lastUsed: Date.now() };
    // Another caller may have loaded it meanwhile; keep the first.
    const race = this.cache.get(roomId);
    if (race) return race;
    this.cache.set(roomId, fresh);
    return fresh;
  }

  private async load(roomId: string): Promise<RoomState> {
    const [exists] = await this.db.select({ id: schema.rooms.id }).from(schema.rooms).where(eq(schema.rooms.id, roomId));
    if (!exists) throw new HttpError(404, 'not_found', 'Room not found');
    const [snap] = await this.db.select().from(schema.roomSnapshots).where(eq(schema.roomSnapshots.roomId, roomId));
    const base = snap ? snap.state : initialRoomState(roomId);
    const tail = await this.eventsSince(roomId, base.seq);
    const state = tail.reduce((s, e) => ({ ...reduce(s, e.event), seq: e.seq }), base);
    this.log.debug({ roomId, snapshotSeq: snap?.seq ?? 0, replayed: tail.length }, 'room loaded');
    return state;
  }

  /** Persists events atomically, applies them, and notifies listeners. */
  private async append(room: CachedRoom, actorId: string | null, events: GameEvent[]): Promise<RoomEvent[]> {
    const before = room.state;
    const after = { ...reduceAll(before, events), seq: before.seq + events.length };
    const now = new Date();
    const stored: RoomEvent[] = events.map((event, i) => ({ seq: before.seq + i + 1, actorId, at: now.toISOString(), event }));

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.roomEvents).values(stored.map((e) => ({ roomId: room.state.id, seq: e.seq, actorId, type: e.event.type, payload: e.event, createdAt: now })));
      await tx.update(schema.rooms).set({ phase: after.phase, settings: after.settings, updatedAt: now }).where(eq(schema.rooms.id, room.state.id));
      for (const e of events) {
        if (e.type === 'playerJoined') {
          await tx.insert(schema.roomPlayers).values({ roomId: room.state.id, userId: e.playerId, seat: e.seat }).onConflictDoNothing();
        } else if (e.type === 'playerLeft') {
          await tx.delete(schema.roomPlayers).where(and(eq(schema.roomPlayers.roomId, room.state.id), eq(schema.roomPlayers.userId, e.playerId)));
        }
      }
      if (Math.floor(after.seq / SNAPSHOT_EVERY) > Math.floor(before.seq / SNAPSHOT_EVERY)) {
        await tx
          .insert(schema.roomSnapshots)
          .values({ roomId: room.state.id, seq: after.seq, state: after, createdAt: now })
          .onConflictDoUpdate({ target: schema.roomSnapshots.roomId, set: { seq: after.seq, state: after, createdAt: now } });
      }
    });

    room.state = after;
    room.lastUsed = Date.now();
    for (const listener of room.listeners) {
      try {
        listener(stored, after);
      } catch (err) {
        this.log.warn({ err, roomId: room.state.id }, 'room listener threw');
      }
    }
    return stored;
  }
}
