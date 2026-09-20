import { describe, expect, it } from 'vitest';
import type { DraftConfig } from '../draft/types.js';
import { decide, type CommandContext } from './decide.js';
import type { RoomEvent } from './events.js';
import { initialRoomState, reduce } from './reduce.js';
import type { RoomSettings, RoomState } from './types.js';
import { applyRoomEvent, projectEvents, projectState } from './visibility.js';

/** The house draft as a room would carry it. */
const house: DraftConfig = {
  name: 'House',
  seats: 4,
  startDirection: 'right',
  phases: [
    { type: 'pickAndPass', name: 'Tri-colour', poolCubeVersionId: 'tri', packSize: 5, packsPerPlayer: 1, rounds: 1, direction: 'alternate' },
    { type: 'pickAndPass', name: 'Main', poolCubeVersionId: 'main', packSize: 15, packsPerPlayer: 1, rounds: 3, direction: 'alternate' },
  ],
};
const settings: RoomSettings = { playerCount: 4, mode: 'ffa', startingLife: 20, commander: false, draft: house };
const pools = { tri: Array.from({ length: 20 }, (_, i) => `tri-${i}`), main: Array.from({ length: 360 }, (_, i) => `main-${i}`) };

function rng(seed = 7) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}
let ids = 0;
const random = rng();
const ctx = (actorId: string, extra: Partial<CommandContext> = {}): CommandContext => ({ actorId, actorDisplayName: actorId.toUpperCase(), now: new Date('2026-01-01'), random, newId: () => `id${ids++}`, ...extra });

/** A room whose event log we keep, so projection can be checked event by event. */
class Room {
  state: RoomState = initialRoomState('r');
  log: RoomEvent[] = [];
  run(actor: string, command: Parameters<typeof decide>[1], extra: Partial<CommandContext> = {}) {
    const d = decide(this.state, command, ctx(actor, extra));
    if (!d.ok) throw new Error(d.error);
    for (const event of d.events) {
      const seq = this.state.seq + 1;
      this.state = { ...reduce(this.state, event), seq };
      this.log.push({ seq, actorId: actor, at: 'now', event });
    }
    return this.state;
  }
}

function lobby(): Room {
  const room = new Room();
  room.state = reduce(room.state, { type: 'roomCreated', ownerId: 'a', settings });
  for (const p of ['a', 'b', 'c', 'd']) room.run(p, { type: 'join' });
  return room;
}

describe('draft rooms', () => {
  it('lets players ready up without a deck and starts the draft with fixed seats', () => {
    const room = lobby();
    for (const p of ['a', 'b', 'c', 'd']) room.run(p, { type: 'setReady', ready: true });
    expect(decide(room.state, { type: 'start' }, ctx('a'))).toEqual({ ok: false, error: 'Draft pools unavailable' });
    expect(decide(room.state, { type: 'draftPick', cardId: 'x' }, ctx('a'))).toEqual({ ok: false, error: 'No draft running' });
    room.run('a', { type: 'start' }, { draftPools: pools });
    expect(room.state.phase).toBe('drafting');
    expect(room.state.draft?.seats).toEqual(['a', 'b', 'c', 'd']);
    expect(room.state.draft?.direction).toBe('right');
    expect(Object.keys(room.state.draft!.packs)).toHaveLength(16);
    expect(decide(room.state, { type: 'leave' }, ctx('b'))).toEqual({ ok: false, error: 'Cannot leave a running game' });
  });

  it('rejects a draft that does not match the seat count and a short pool', () => {
    const room = lobby();
    expect(decide(room.state, { type: 'updateSettings', settings: { ...settings, playerCount: 4, draft: { ...house, seats: 2 } } }, ctx('a'))).toEqual({ ok: false, error: 'The draft is for a different number of players' });
    for (const p of ['a', 'b', 'c', 'd']) room.run(p, { type: 'setReady', ready: true });
    expect(decide(room.state, { type: 'start' }, ctx('a', { draftPools: { tri: pools.tri, main: pools.main.slice(0, 100) } }))).toEqual({ ok: false, error: 'Phase 2 (Main) needs 180 cards but the pool has 100' });
  });

  it('runs to deckbuilding, and every viewer\'s client state always equals their projection', () => {
    const room = lobby();
    for (const p of ['a', 'b', 'c', 'd']) room.run(p, { type: 'setReady', ready: true });
    room.run('a', { type: 'start' }, { draftPools: pools });

    // Client-side replicas built from projected events, one per viewer (plus a spectator).
    const viewers = ['a', 'b', 'c', 'd', 'zed'];
    const clients = Object.fromEntries(viewers.map((v) => [v, projectState({ ...initialRoomState('r'), ownerId: 'a', settings }, v)]));
    let applied = 0;
    const sync = () => {
      const fresh = room.log.slice(applied);
      const base = room.log.slice(0, applied).reduce((s, e) => ({ ...reduce(s, e.event), seq: e.seq }), initialRoomState('r'));
      for (const v of viewers) {
        for (const e of projectEvents(fresh, v, base)) clients[v] = applyRoomEvent(clients[v]!, e);
        expect(clients[v]).toEqual(projectState(room.state, v));
      }
      applied = room.log.length;
    };
    sync();

    let picks = 0;
    while (room.state.phase === 'drafting') {
      for (const p of ['a', 'b', 'c', 'd']) {
        const me = room.state.draft!.players[p]!;
        const pack = room.state.draft!.packs[me.queue[0]!]!;
        room.run(p, { type: 'draftPick', cardId: pack.cards[pack.cards.length - 1]!.id, faceUp: picks % 7 === 0 });
        picks++;
        if (picks % 9 === 0) sync();
      }
    }
    sync();
    expect(room.state.phase).toBe('deckbuilding');
    expect(room.state.draft?.status).toBe('finished');
    expect(picks).toBe(200);
    expect(Object.values(room.state.draft!.players).map((p) => p.pool.length)).toEqual([50, 50, 50, 50]);
    expect(decide(room.state, { type: 'draftPick', cardId: 'x' }, ctx('a'))).toEqual({ ok: false, error: 'No draft running' });

    // Spectators never learn a single identity; a drafter sees their own pool and all face-up picks.
    const zed = projectState(room.state, 'zed').draft!;
    expect(Object.values(zed.players).flatMap((p) => p.pool).filter((c) => c.printingId !== '').length).toBe(Object.values(zed.players).flatMap((p) => p.faceUp).length);
    const a = projectState(room.state, 'a').draft!;
    expect(a.players.a!.pool.every((c) => c.printingId !== '')).toBe(true);
    expect(a.picks).toHaveLength(200);
    expect(a.picks.filter((p) => p.playerId === 'a').every((p) => p.packContents.every((c) => c !== ''))).toBe(true);
  });

  it('carries draftRevealed when a pack arrives and draftHidden when it leaves', () => {
    const room = lobby();
    for (const p of ['a', 'b', 'c', 'd']) room.run(p, { type: 'setReady', ready: true });
    const beforeStart = room.state;
    room.run('a', { type: 'start' }, { draftPools: pools });
    const [started] = projectEvents(room.log.slice(-1), 'b', beforeStart);
    expect(started?.draftRevealed).toHaveLength(5);
    expect(started?.event.type === 'draftStarted' && started.event.packs.every((p) => p.cards.every((c) => c.printingId === null))).toBe(true);

    const before = room.state;
    const packOfA = room.state.draft!.players.a!.queue[0]!;
    room.run('a', { type: 'draftPick', cardId: room.state.draft!.packs[packOfA]!.cards[0]!.id });
    const [forA] = projectEvents(room.log.slice(-1), 'a', before);
    expect(forA?.draftHidden).toHaveLength(4); // the rest of the pack went to seat 3
    expect(forA?.draftRevealed).toBeUndefined();
    const [forD] = projectEvents(room.log.slice(-1), 'd', before);
    expect(forD?.draftRevealed).toBeUndefined(); // queued behind d's own pack: not readable yet
    expect(forD?.event.type === 'draftPicked' && forD.event.printingId).toBeNull();
  });
});
