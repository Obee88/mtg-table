import { describe, expect, it } from 'vitest';
import type { DraftConfig } from '../draft/types.js';
import { decide, type CommandContext } from './decide.js';
import type { RoomEvent } from './events.js';
import { usableLibrarians } from '../draft/types.js';
import { initialRoomState, reduce } from './reduce.js';
import { decksFromGame, type RoomSettings, type RoomState } from './types.js';
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
const pools = {
  tri: Array.from({ length: 20 }, (_, i) => ({ printingId: `tri-${i}`, name: `Tri ${i}` })),
  // Four Librarians in the main cube exercise the double-pick hook under projection.
  main: Array.from({ length: 360 }, (_, i) => ({ printingId: `main-${i}`, name: i % 90 === 0 ? 'Cogwork Librarian' : `Main ${i}` })),
};

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
    let librarianUses = 0;
    while (room.state.phase === 'drafting') {
      for (const p of ['a', 'b', 'c', 'd']) {
        const me = room.state.draft!.players[p]!;
        const pack = room.state.draft!.packs[me.queue[0]!]!;
        const librarian = usableLibrarians(room.state.draft!, p)[0];
        const cardId = pack.cards[pack.cards.length - 1]!.id;
        if (librarian) {
          room.run(p, { type: 'draftPick', cardId, librarian: { cardId: librarian.id, secondCardId: pack.cards[0]!.id } });
          picks += 2;
          librarianUses++;
        } else {
          room.run(p, { type: 'draftPick', cardId, faceUp: picks % 7 === 0 });
          picks++;
        }
        if (picks % 9 === 0) sync();
      }
    }
    sync();
    expect(room.state.phase).toBe('deckbuilding');
    expect(room.state.draft?.status).toBe('finished');
    // A spent Librarian is drafted twice, so each use adds a pick; the cards themselves are conserved.
    expect(librarianUses).toBeGreaterThan(0);
    expect(picks).toBe(200 + librarianUses);
    expect(room.state.draft!.picks.filter((p) => p.double)).toHaveLength(librarianUses);
    expect(Object.values(room.state.draft!.players).reduce((n, p) => n + p.pool.length, 0)).toBe(200);
    expect(decide(room.state, { type: 'draftPick', cardId: 'x' }, ctx('a'))).toEqual({ ok: false, error: 'No draft running' });

    // Spectators never learn a single identity; a drafter sees their own pool and all face-up picks.
    const zed = projectState(room.state, 'zed').draft!;
    expect(Object.values(zed.players).flatMap((p) => p.pool).filter((c) => c.printingId !== '').length).toBe(Object.values(zed.players).flatMap((p) => p.faceUp).length);
    const a = projectState(room.state, 'a').draft!;
    expect(a.players.a!.pool.every((c) => c.printingId !== '')).toBe(true);
    expect(a.picks).toHaveLength(picks);
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

describe('deckbuilding and the handoff to the table', () => {
  function finished(): Room {
    const room = lobby();
    for (const p of ['a', 'b', 'c', 'd']) room.run(p, { type: 'setReady', ready: true });
    room.run('a', { type: 'start' }, { draftPools: pools });
    while (room.state.phase === 'drafting') {
      for (const p of ['a', 'b', 'c', 'd']) {
        const pack = room.state.draft!.packs[room.state.draft!.players[p]!.queue[0]!]!;
        room.run(p, { type: 'draftPick', cardId: pack.cards[0]!.id });
      }
    }
    return room;
  }

  it('takes decks from the own pool plus basics, then deals the game with the drafted seats', () => {
    const room = finished();
    expect(room.state.phase).toBe('deckbuilding');
    const poolOfA = room.state.draft!.players.a!.pool;
    expect(decide(room.state, { type: 'draftPick', cardId: 'x' }, ctx('a'))).toEqual({ ok: false, error: 'No draft running' });
    expect(decide(room.state, { type: 'submitDraftDeck', main: [], basics: [] }, ctx('a'))).toEqual({ ok: false, error: 'Put at least one card in your main deck' });
    expect(decide(room.state, { type: 'submitDraftDeck', main: [room.state.draft!.players.b!.pool[0]!.id], basics: [] }, ctx('a'))).toEqual({ ok: false, error: 'Only cards from your own pool can go in the deck' });
    expect(decide(room.state, { type: 'start' }, ctx('a'))).toEqual({ ok: false, error: 'Waiting for everyone to submit a deck' });

    const main = poolOfA.slice(0, 23).map((c) => c.id);
    room.run('a', { type: 'submitDraftDeck', main: [...main, main[0]!], basics: [{ printingId: 'forest', quantity: 17 }, { printingId: 'island', quantity: 0 }] });
    expect(room.state.draft!.decks.a).toEqual({ main, basics: [{ printingId: 'forest', quantity: 17 }] });
    // Others learn only that a deck was submitted.
    expect(projectState(room.state, 'b').draft!.decks.a).toEqual({ main: [], basics: [] });
    expect(projectState(room.state, 'a').draft!.decks.a!.main).toHaveLength(23);

    for (const p of ['b', 'c', 'd']) room.run(p, { type: 'submitDraftDeck', main: room.state.draft!.players[p]!.pool.slice(0, 40).map((c) => c.id), basics: [] });
    room.run('a', { type: 'start' });
    expect(room.state.phase).toBe('playing');
    const game = room.state.game!;
    const zones = game.players.a!.zones;
    expect(zones.library.length + zones.hand.length).toBe(23 + 17);
    expect(zones.sideboard).toHaveLength(50 - 23);
    expect(zones.library.filter((id) => game.cards[id]!.printingId === 'forest')).toHaveLength(17 - zones.hand.filter((id) => game.cards[id]!.printingId === 'forest').length);
    expect(game.players.b!.zones.sideboard).toHaveLength(10);
    // Seats are the draft seats.
    expect(Object.values(room.state.players).sort((x, y) => x.seat - y.seat).map((p) => p.id)).toEqual(room.state.draft!.seats);
    // Restart re-deals from the same submitted decks.
    room.run('a', { type: 'restart' });
    expect(room.state.game!.players.a!.zones.library.length + room.state.game!.players.a!.zones.hand.length).toBe(40);
  });
});

describe('reporting results', () => {
  it('records winners per game number, whole teams in 2v2, and the decks as they sit', () => {
    const room = new Room();
    room.state = reduce(room.state, { type: 'roomCreated', ownerId: 'a', settings: { playerCount: 4, mode: '2v2', startingLife: 30, commander: false } });
    for (const p of ['a', 'b', 'c', 'd']) room.run(p, { type: 'join' });
    expect(decide(room.state, { type: 'reportResult', winners: ['a'] }, ctx('a'))).toEqual({ ok: false, error: 'Game not running' });
    const decks = Object.fromEntries(['a', 'b', 'c', 'd'].map((p) => [p, { main: [{ printingId: `${p}-main`, quantity: 9 }], sideboard: [{ printingId: `${p}-side`, quantity: 2 }], commander: [] }]));
    for (const p of ['a', 'b', 'c', 'd']) {
      room.run(p, { type: 'selectDeck', deckId: 'd' });
      room.run(p, { type: 'setReady', ready: true });
    }
    room.run('a', { type: 'start' }, { decks });
    expect(room.state.game?.gameNumber).toBe(1);
    expect(decide(room.state, { type: 'reportResult', winners: ['zed'] }, ctx('a'))).toEqual({ ok: false, error: 'Winners must be seated players' });
    expect(decide(room.state, { type: 'reportResult', winners: ['a'] }, ctx('zed'))).toEqual({ ok: false, error: 'Not in the room' });

    room.run('b', { type: 'reportResult', winners: ['a'], note: '  close one ' });
    expect(room.state.results).toEqual([{ gameNumber: 1, reportedBy: 'b', winners: ['a', 'c'], note: 'close one', at: '2026-01-01T00:00:00.000Z' }]);
    room.run('a', { type: 'reportResult', winners: [] });
    expect(room.state.results).toEqual([{ gameNumber: 1, reportedBy: 'a', winners: [], note: null, at: '2026-01-01T00:00:00.000Z' }]);

    const snapshot = decksFromGame(room.state);
    expect(snapshot.a).toEqual({ main: [{ printingId: 'a-main', quantity: 9 }], sideboard: [{ printingId: 'a-side', quantity: 2 }], commander: [] });

    room.run('a', { type: 'restart' }, { decks });
    expect(room.state.game?.gameNumber).toBe(2);
    room.run('c', { type: 'reportResult', winners: ['b', 'd'] });
    expect(room.state.results.map((r) => [r.gameNumber, r.winners])).toEqual([[1, []], [2, ['b', 'd']]]);
  });
});

describe('winston rooms', () => {
  it('runs a two-player Winston phase with every replica matching its projection', () => {
    const winston: DraftConfig = { name: 'Winston', seats: 2, startDirection: 'left', phases: [{ type: 'winston', name: 'Winston', poolCubeVersionId: 'main', stackSize: 24, piles: 3 }] };
    const room = new Room();
    room.state = reduce(room.state, { type: 'roomCreated', ownerId: 'a', settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false, draft: winston } });
    for (const p of ['a', 'b']) {
      room.run(p, { type: 'join' });
      room.run(p, { type: 'setReady', ready: true });
    }
    room.run('a', { type: 'start' }, { draftPools: { main: pools.main } });
    expect(room.state.draft?.winston).toMatchObject({ activeSeat: 0, pileIndex: 0 });

    const viewers = ['a', 'b', 'zed'];
    const clients = Object.fromEntries(viewers.map((v) => [v, projectState({ ...initialRoomState('r'), ownerId: 'a', settings: room.state.settings }, v)]));
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
    let turns = 0;
    while (room.state.phase === 'drafting') {
      const w = room.state.draft!.winston!;
      const who = room.state.draft!.seats[w.activeSeat]!;
      const other = who === 'a' ? 'b' : 'a';
      expect(decide(room.state, { type: 'winstonDecide', take: true }, ctx(other))).toEqual({ ok: false, error: 'Not your turn' });
      room.run(who, { type: 'winstonDecide', take: turns % 3 !== 1 });
      turns++;
      sync();
      // The player not on turn never sees a pile card; the spectator sees nothing at all.
      const idle = room.state.draft!.winston ? room.state.draft!.seats[1 - room.state.draft!.winston.activeSeat]! : other;
      const view = projectState(room.state, idle).draft!;
      expect(view.winston?.piles.flat().every((c) => c.printingId === '') ?? true).toBe(true);
      expect(Object.values(projectState(room.state, 'zed').draft!.players).flatMap((p) => p.pool).every((c) => c.printingId === '')).toBe(true);
    }
    expect(room.state.phase).toBe('deckbuilding');
    expect(room.state.draft!.players.a!.pool.length + room.state.draft!.players.b!.pool.length).toBe(24);
    expect(room.state.draft!.picks).toHaveLength(24);
  });
});

describe('grid rooms', () => {
  it('runs a Grid phase with every replica matching its projection', () => {
    const grid: DraftConfig = { name: 'Grid', seats: 2, startDirection: 'left', phases: [{ type: 'grid', name: 'Grid', poolCubeVersionId: 'main', grids: 4, size: 3 }] };
    const room = new Room();
    room.state = reduce(room.state, { type: 'roomCreated', ownerId: 'a', settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false, draft: grid } });
    for (const p of ['a', 'b']) {
      room.run(p, { type: 'join' });
      room.run(p, { type: 'setReady', ready: true });
    }
    room.run('a', { type: 'start' }, { draftPools: { main: pools.main } });
    const viewers = ['a', 'b', 'zed'];
    const clients = Object.fromEntries(viewers.map((v) => [v, projectState({ ...initialRoomState('r'), ownerId: 'a', settings: room.state.settings }, v)]));
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
    let n = 0;
    while (room.state.phase === 'drafting') {
      const g = room.state.draft!.grid!;
      const who = room.state.draft!.seats[g.activeSeat]!;
      const line = n % 2 === 0 ? 'row' : 'col';
      const index = [0, 2, 1][n % 3]!;
      const d = decide(room.state, { type: 'gridPick', line, index }, ctx(who));
      room.run(who, { type: 'gridPick', line, index: d.ok ? index : 0 });
      n++;
      sync();
    }
    expect(room.state.phase).toBe('deckbuilding');
    expect(room.state.draft!.players.a!.pool.length + room.state.draft!.players.b!.pool.length).toBeGreaterThanOrEqual(16);
  });
});

describe('winchester rooms', () => {
  it('runs a Winchester phase with every replica matching its projection', () => {
    const winchester: DraftConfig = { name: 'Winchester', seats: 2, startDirection: 'left', phases: [{ type: 'winchester', name: 'Winchester', poolCubeVersionId: 'main', stackSize: 20, piles: 4 }] };
    const room = new Room();
    room.state = reduce(room.state, { type: 'roomCreated', ownerId: 'a', settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false, draft: winchester } });
    for (const p of ['a', 'b']) {
      room.run(p, { type: 'join' });
      room.run(p, { type: 'setReady', ready: true });
    }
    room.run('a', { type: 'start' }, { draftPools: { main: pools.main } });
    const viewers = ['a', 'b', 'zed'];
    const clients = Object.fromEntries(viewers.map((v) => [v, projectState({ ...initialRoomState('r'), ownerId: 'a', settings: room.state.settings }, v)]));
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
    let n = 0;
    while (room.state.phase === 'drafting') {
      const w = room.state.draft!.winchester!;
      const who = room.state.draft!.seats[w.activeSeat]!;
      const index = w.piles.findIndex((p, i) => p.length > 0 && i >= n % 4) >= 0 ? w.piles.findIndex((p, i) => p.length > 0 && i >= n % 4) : w.piles.findIndex((p) => p.length > 0);
      room.run(who, { type: 'winchesterTake', index });
      n++;
      sync();
    }
    expect(room.state.phase).toBe('deckbuilding');
    expect(room.state.draft!.players.a!.pool.length + room.state.draft!.players.b!.pool.length).toBe(20);
  });
});

describe('rotisserie rooms', () => {
  it('runs a four-player Rotisserie phase with every replica matching its projection', () => {
    const roti: DraftConfig = { name: 'Roti', seats: 4, startDirection: 'left', phases: [{ type: 'rotisserie', name: 'Rotisserie', poolCubeVersionId: 'main', poolSize: 30, picksPerPlayer: 5 }] };
    const room = new Room();
    room.state = reduce(room.state, { type: 'roomCreated', ownerId: 'a', settings: { playerCount: 4, mode: 'ffa', startingLife: 20, commander: false, draft: roti } });
    for (const p of ['a', 'b', 'c', 'd']) {
      room.run(p, { type: 'join' });
      room.run(p, { type: 'setReady', ready: true });
    }
    room.run('a', { type: 'start' }, { draftPools: { main: pools.main } });
    const viewers = ['a', 'b', 'c', 'd', 'zed'];
    const clients = Object.fromEntries(viewers.map((v) => [v, projectState({ ...initialRoomState('r'), ownerId: 'a', settings: room.state.settings }, v)]));
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
    while (room.state.phase === 'drafting') {
      const r = room.state.draft!.rotisserie!;
      const who = room.state.draft!.seats[r.activeSeat]!;
      const table = room.state.draft!.packs[r.packId]!.cards;
      room.run(who, { type: 'rotisseriePick', cardId: table[table.length - 1]!.id });
      sync();
    }
    expect(room.state.phase).toBe('deckbuilding');
    expect(Object.values(room.state.draft!.players).map((p) => p.pool.length)).toEqual([5, 5, 5, 5]);
  });
});

describe('ending a game together', () => {
  function playing(): Room {
    const room = new Room();
    room.state = reduce(room.state, { type: 'roomCreated', ownerId: 'a', settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false } });
    for (const p of ['a', 'b']) {
      room.run(p, { type: 'join' });
      room.run(p, { type: 'selectDeck', deckId: 'd' });
      room.run(p, { type: 'setReady', ready: true });
    }
    room.run('a', { type: 'start' }, { decks });
    return room;
  }
  const decks = { a: { main: [{ printingId: 'x', quantity: 9 }], sideboard: [], commander: [] }, b: { main: [{ printingId: 'y', quantity: 9 }], sideboard: [], commander: [] } };

  it('records the outcome only once every seat confirmed, then ends the room', () => {
    const room = playing();
    expect(decide(room.state, { type: 'confirmResult' }, ctx('b'))).toEqual({ ok: false, error: 'Nothing to confirm' });
    room.run('a', { type: 'proposeResult', winners: ['b'], then: 'end' });
    expect(room.state.game?.pendingResult).toEqual({ proposedBy: 'a', winners: ['b'], then: 'end', confirmed: ['a'] });
    expect(room.state.results).toEqual([]);
    expect(decide(room.state, { type: 'proposeResult', winners: [], then: 'end' }, ctx('b'))).toEqual({ ok: false, error: 'An outcome is already waiting for confirmation' });
    expect(decide(room.state, { type: 'confirmResult' }, ctx('a'))).toEqual({ ok: false, error: 'Already confirmed' });
    room.run('b', { type: 'confirmResult' });
    expect(room.state.results).toEqual([{ gameNumber: 1, reportedBy: 'a', winners: ['b'], note: null, at: '2026-01-01T00:00:00.000Z' }]);
    expect(room.state.phase).toBe('ended');
  });

  it('leaves untracked games out of the results and deals again when asked', () => {
    const room = playing();
    room.run('b', { type: 'proposeResult', winners: null, then: 'restart' });
    room.run('a', { type: 'confirmResult' }, { decks });
    expect(room.state.results).toEqual([]);
    expect(room.state.phase).toBe('playing');
    expect(room.state.game?.gameNumber).toBe(2);
    expect(room.state.game?.pendingResult).toBeNull();
  });

  it('a dispute clears the proposal so anyone can propose again', () => {
    const room = playing();
    room.run('a', { type: 'proposeResult', winners: ['a'], then: 'end' });
    room.run('b', { type: 'rejectResult' });
    expect(room.state.game?.pendingResult).toBeNull();
    expect(room.state.phase).toBe('playing');
    room.run('b', { type: 'proposeResult', winners: ['b'], then: 'end' });
    room.run('a', { type: 'rejectResult' }); // the proposer may also withdraw; here the other side withdraws for them
    expect(room.state.game?.pendingResult).toBeNull();
    expect(decide(room.state, { type: 'rejectResult' }, ctx('zed'))).toEqual({ ok: false, error: 'Not in the room' });
  });
});
