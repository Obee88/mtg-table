import {
  decide,
  decksFromGame,
  initialRoomState,
  reduce,
  reduceAll,
  type CommandContext,
  type DeckContents,
  type Decision,
  type GameCommand,
  type GameEvent,
  type RoomEvent,
  type RoomSettings,
  type RoomState,
} from '@mtg/shared';
import { randomInt, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { schema, type Db } from '../db/index.js';
import { HttpError } from '../errors.js';

const SNAPSHOT_EVERY = 50;
const IDLE_EVICT_MS = 30 * 60 * 1000;
/** Lobby and bookkeeping events are never undone. */
const NOT_UNDOABLE = new Set(['roomCreated', 'settingsChanged', 'playerJoined', 'playerLeft', 'seatChanged', 'deckSelected', 'readyChanged', 'roomClosed', 'gameStarted', 'actionUndone', 'mulliganTaken', 'handKept', 'draftStarted', 'draftPicked', 'draftCardReturned', 'draftDeckSubmitted', 'winstonTaken', 'winstonPassed', 'gridTaken', 'resultReported']);

export type RoomListener = (events: RoomEvent[], state: RoomState, before: RoomState) => void;

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

export type DispatchResult = { ok: true; events: RoomEvent[]; state: RoomState; before: RoomState } | { ok: false; error: string };

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
    return rows.map((r) => ({ seq: r.seq, actorId: r.actorId, at: r.createdAt.toISOString(), event: r.payload, ...(r.batchId ? { batchId: r.batchId } : {}) }));
  }

  /** Full state as of `seq` (rebuilt from the log); used to project a reconnect gap. */
  async stateAt(roomId: string, seq: number): Promise<RoomState> {
    const [snap] = await this.db.select().from(schema.roomSnapshots).where(eq(schema.roomSnapshots.roomId, roomId));
    const base = snap && snap.seq <= seq ? snap.state : initialRoomState(roomId);
    const events = await this.eventsSince(roomId, base.seq);
    return events.filter((e) => e.seq <= seq).reduce((s, e) => ({ ...reduce(s, e.event), seq: e.seq }), base);
  }

  /**
   * Undo = restore the state from before the actor's most recent batch, allowed
   * only when that batch is the latest in the room, is a game action, and is
   * not itself an undo.
   */
  private async undoDecision(room: CachedRoom, actor: Actor): Promise<Decision> {
    const [last] = await this.db
      .select()
      .from(schema.roomEvents)
      .where(eq(schema.roomEvents.roomId, room.state.id))
      .orderBy(desc(schema.roomEvents.seq))
      .limit(1);
    if (!last?.batchId) return { ok: false, error: 'Nothing to undo' };
    if (last.actorId !== actor.id) return { ok: false, error: 'Someone else acted since your last action' };
    const batch = await this.db
      .select()
      .from(schema.roomEvents)
      .where(and(eq(schema.roomEvents.roomId, room.state.id), eq(schema.roomEvents.batchId, last.batchId)))
      .orderBy(asc(schema.roomEvents.seq));
    if (batch.some((e) => NOT_UNDOABLE.has(e.type))) return { ok: false, error: 'That action cannot be undone' };
    const fromSeq = batch[0]!.seq;
    const toSeq = batch[batch.length - 1]!.seq;
    const state = await this.stateAt(room.state.id, fromSeq - 1);
    return { ok: true, events: [{ type: 'actionUndone', fromSeq, toSeq, state }] };
  }

  /** Validates and applies a command. Serialised per room. */
  async dispatch(roomId: string, actor: Actor, command: GameCommand): Promise<DispatchResult> {
    const room = await this.room(roomId);
    const run = async (): Promise<DispatchResult> => {
      const ctx: CommandContext = {
        actorId: actor.id,
        actorDisplayName: actor.displayName,
        now: new Date(),
        random: () => randomInt(0, 2 ** 32) / 2 ** 32,
        newId: () => randomUUID(),
      };
      if (command.type === 'start' || command.type === 'restart') ctx.decks = await this.loadDecks(room.state);
      if (command.type === 'submitDraftDeck') {
        const bad = await this.nonBasicPrintings(command.basics.map((b) => b.printingId));
        if (bad.length > 0) return { ok: false, error: 'Only basic lands can be added for free' };
      }
      if (command.type === 'start' && room.state.settings.draft) {
        const pools = await this.loadDraftPools(room.state.settings.draft.phases.map((p) => p.poolCubeVersionId));
        if (!pools.ok) return pools;
        ctx.draftPools = pools.pools;
      }
      const decision = command.type === 'undo' ? await this.undoDecision(room, actor) : decide(room.state, command, ctx);
      if (!decision.ok) return decision;
      if (decision.events.length === 0) return { ok: true, events: [], state: room.state, before: room.state };
      const before = room.state;
      const events = await this.append(room, actor.id, decision.events);
      return { ok: true, events, state: room.state, before };
    };
    // Chain onto the queue; a failure must not poison later commands.
    const result = room.queue.then(run, run);
    room.queue = result.catch(() => undefined);
    return result;
  }

  /** Each seated player's chosen deck, only if it belongs to them. */
  private async loadDecks(state: RoomState): Promise<Record<string, DeckContents>> {
    const wanted = Object.values(state.players).filter((p) => p.deckId).map((p) => ({ playerId: p.id, deckId: p.deckId! }));
    if (wanted.length === 0) return {};
    const rows = await this.db.select().from(schema.decks).where(inArray(schema.decks.id, wanted.map((w) => w.deckId)));
    const decks: Record<string, DeckContents> = {};
    for (const w of wanted) {
      const row = rows.find((r) => r.id === w.deckId && r.ownerId === w.playerId);
      if (row) decks[w.playerId] = row.contents;
    }
    return decks;
  }

  /** Ids among `printingIds` that are not basic lands (or do not exist). */
  private async nonBasicPrintings(printingIds: string[]): Promise<string[]> {
    const ids = [...new Set(printingIds)];
    if (ids.length === 0) return [];
    const rows = await this.db.select({ id: schema.cards.id, typeLine: schema.cards.typeLine }).from(schema.cards).where(inArray(schema.cards.id, ids));
    return ids.filter((id) => !rows.some((r) => r.id === id && r.typeLine?.startsWith('Basic Land')));
  }

  /** Printing ids (one per copy) of each cube version a draft deals from. */
  private async loadDraftPools(versionIds: string[]): Promise<{ ok: true; pools: Record<string, { printingId: string; name: string }[]> } | { ok: false; error: string }> {
    const ids = [...new Set(versionIds)];
    const versions = await this.db.select({ id: schema.cubeVersions.id }).from(schema.cubeVersions).where(inArray(schema.cubeVersions.id, ids));
    const missing = ids.filter((id) => !versions.some((v) => v.id === id));
    if (missing.length > 0) return { ok: false, error: 'A cube version this draft uses no longer exists' };
    // Names identify draft-matters cards (Cogwork Librarian) whatever the printing.
    const rows = await this.db
      .select({ versionId: schema.cubeVersionCards.versionId, cardId: schema.cubeVersionCards.cardId, quantity: schema.cubeVersionCards.quantity, name: schema.cards.name })
      .from(schema.cubeVersionCards)
      .innerJoin(schema.cards, eq(schema.cards.id, schema.cubeVersionCards.cardId))
      .where(inArray(schema.cubeVersionCards.versionId, ids));
    const pools: Record<string, { printingId: string; name: string }[]> = Object.fromEntries(ids.map((id) => [id, []]));
    for (const r of rows) for (let i = 0; i < r.quantity; i++) pools[r.versionId]!.push({ printingId: r.cardId, name: r.name });
    return { ok: true, pools };
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
    const batchId = randomUUID();
    const stored: RoomEvent[] = events.map((event, i) => ({ seq: before.seq + i + 1, actorId, at: now.toISOString(), event, batchId }));

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.roomEvents).values(stored.map((e) => ({ roomId: room.state.id, seq: e.seq, actorId, batchId, type: e.event.type, payload: e.event, createdAt: now })));
      await tx.update(schema.rooms).set({ phase: after.phase, settings: after.settings, updatedAt: now }).where(eq(schema.rooms.id, room.state.id));
      for (const e of events) {
        if (e.type === 'playerJoined') {
          await tx.insert(schema.roomPlayers).values({ roomId: room.state.id, userId: e.playerId, seat: e.seat }).onConflictDoNothing();
        } else if (e.type === 'playerLeft') {
          await tx.delete(schema.roomPlayers).where(and(eq(schema.roomPlayers.roomId, room.state.id), eq(schema.roomPlayers.userId, e.playerId)));
        } else if (e.type === 'seatChanged') {
          await tx.update(schema.roomPlayers).set({ seat: e.seat }).where(and(eq(schema.roomPlayers.roomId, room.state.id), eq(schema.roomPlayers.userId, e.playerId)));
        }
      }
      // Results are denormalised for statistics with the decks as they sit at the table.
      for (const e of events) {
        if (e.type !== 'resultReported') continue;
        const decks = decksFromGame(after);
        const row = {
          roomId: room.state.id, gameNumber: e.gameNumber, reportedBy: e.reportedBy, winners: e.winners, mode: after.settings.mode, playerCount: after.settings.playerCount,
          commander: after.settings.commander, draftName: after.settings.draft?.name ?? null, note: e.note, reportedAt: now,
          players: Object.values(after.players).sort((a, b) => a.seat - b.seat).map((p) => ({ playerId: p.id, seat: p.seat, team: p.team, deck: decks[p.id] ?? null })),
        };
        await tx.insert(schema.gameResults).values(row).onConflictDoUpdate({ target: [schema.gameResults.roomId, schema.gameResults.gameNumber], set: row });
      }
      // Picks are denormalised for statistics; the draft reducer already computed their context.
      const picked = after.draft ? after.draft.picks.slice(before.draft?.picks.length ?? 0) : [];
      if (picked.length > 0) {
        await tx.insert(schema.draftPicks).values(picked.map((p) => ({
          roomId: room.state.id, overallPick: p.n, playerId: p.playerId, cardId: p.card.printingId, phase: p.phase, round: p.round,
          packId: p.packId, pickInPack: p.pickInPack, packContents: p.packContents, doublePick: p.double, createdAt: now,
          cubeVersionId: after.draft!.config.phases[p.phase]?.poolCubeVersionId ?? null,
        })));
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
        listener(stored, after, before);
      } catch (err) {
        this.log.warn({ err, roomId: room.state.id }, 'room listener threw');
      }
    }
    return stored;
  }
}
