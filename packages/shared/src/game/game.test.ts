import { describe, expect, it } from 'vitest';
import { decide, type CommandContext } from './decide.js';
import type { GameEvent } from './events.js';
import { initialRoomState, reduce, reduceAll } from './reduce.js';
import { shuffled, type RoomSettings } from './types.js';

const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
const ctx = (actorId: string): CommandContext => ({ actorId, actorDisplayName: actorId.toUpperCase(), now: new Date('2026-01-01') });

/** Runs a command and folds its events into the state; throws on rejection. */
function run(state: ReturnType<typeof initialRoomState>, actor: string, command: Parameters<typeof decide>[1]) {
  const d = decide(state, command, ctx(actor));
  if (!d.ok) throw new Error(d.error);
  return reduceAll(state, d.events);
}

describe('reduce', () => {
  it('applies lobby events and ignores events for unknown players', () => {
    const events: GameEvent[] = [
      { type: 'roomCreated', ownerId: 'a', settings },
      { type: 'playerJoined', playerId: 'a', displayName: 'A', seat: 0, team: 0 },
      { type: 'deckSelected', playerId: 'a', deckId: 'deck-1' },
      { type: 'readyChanged', playerId: 'a', ready: true },
      { type: 'readyChanged', playerId: 'ghost', ready: true },
    ];
    const state = reduceAll(initialRoomState('r'), events);
    expect(state.ownerId).toBe('a');
    expect(state.players.a).toEqual({ id: 'a', displayName: 'A', seat: 0, team: 0, deckId: 'deck-1', ready: true });
    expect(state.players.ghost).toBeUndefined();
  });

  it('does not mutate the previous state', () => {
    const before = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    const after = reduce(before, { type: 'playerJoined', playerId: 'a', displayName: 'A', seat: 0, team: 0 });
    expect(before.players).toEqual({});
    expect(Object.keys(after.players)).toEqual(['a']);
  });

  it('changing settings or deck clears ready flags', () => {
    let state = reduceAll(initialRoomState('r'), [
      { type: 'roomCreated', ownerId: 'a', settings },
      { type: 'playerJoined', playerId: 'a', displayName: 'A', seat: 0, team: 0 },
      { type: 'deckSelected', playerId: 'a', deckId: 'd' },
      { type: 'readyChanged', playerId: 'a', ready: true },
    ]);
    state = reduce(state, { type: 'settingsChanged', settings: { ...settings, startingLife: 30 } });
    expect(state.players.a?.ready).toBe(false);
  });
});

describe('decide', () => {
  const created = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });

  it('seats players in order and rejects a full room or double join', () => {
    let state = run(created, 'a', { type: 'join' });
    state = run(state, 'b', { type: 'join' });
    expect(state.players.a?.seat).toBe(0);
    expect(state.players.b?.seat).toBe(1);
    expect(decide(state, { type: 'join' }, ctx('c'))).toEqual({ ok: false, error: 'Room is full' });
    expect(decide(state, { type: 'join' }, ctx('a'))).toEqual({ ok: false, error: 'Already in the room' });
  });

  it('assigns diagonal teams in 2v2 and refills a vacated seat', () => {
    const four = reduce(created, { type: 'settingsChanged', settings: { playerCount: 4, mode: '2v2', startingLife: 30, commander: false } });
    let state = ['a', 'b', 'c', 'd'].reduce((s, p) => run(s, p, { type: 'join' }), four);
    expect(Object.values(state.players).map((p) => [p.seat, p.team])).toEqual([[0, 0], [1, 1], [2, 0], [3, 1]]);
    state = run(state, 'b', { type: 'leave' });
    state = run(state, 'e', { type: 'join' });
    expect(state.players.e).toMatchObject({ seat: 1, team: 1 });
  });

  it('requires a deck before readying and is idempotent', () => {
    let state = run(created, 'a', { type: 'join' });
    expect(decide(state, { type: 'setReady', ready: true }, ctx('a'))).toEqual({ ok: false, error: 'Choose a deck first' });
    state = run(state, 'a', { type: 'selectDeck', deckId: 'd' });
    state = run(state, 'a', { type: 'setReady', ready: true });
    expect(decide(state, { type: 'setReady', ready: true }, ctx('a'))).toEqual({ ok: true, events: [] });
    expect(state.players.a?.ready).toBe(true);
  });

  it('guards settings and closing behind the owner, and validates mode vs player count', () => {
    const state = run(created, 'b', { type: 'join' });
    expect(decide(state, { type: 'updateSettings', settings }, ctx('b')).ok).toBe(false);
    expect(decide(state, { type: 'updateSettings', settings: { ...settings, mode: '2v2' } }, ctx('a'))).toEqual({ ok: false, error: '2v2 needs 4 players' });
    expect(decide(state, { type: 'closeRoom' }, ctx('b')).ok).toBe(false);
    const closed = run(state, 'a', { type: 'closeRoom' });
    expect(closed.phase).toBe('ended');
    expect(decide(closed, { type: 'join' }, ctx('c'))).toEqual({ ok: false, error: 'Room is closed' });
  });

  it('rejects commands from players not in the room', () => {
    expect(decide(created, { type: 'leave' }, ctx('z'))).toEqual({ ok: false, error: 'Not in the room' });
    expect(decide(created, { type: 'selectDeck', deckId: 'd' }, ctx('z')).ok).toBe(false);
  });
});

describe('start', () => {
  const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
  const decks = {
    a: { main: [{ printingId: 'bolt', quantity: 8 }, { printingId: 'mountain', quantity: 2 }], sideboard: [{ printingId: 'rip', quantity: 1 }], commander: [] },
    b: { main: [{ printingId: 'island', quantity: 9 }], sideboard: [], commander: [{ printingId: 'cmdr', quantity: 1 }] },
  };
  let n = 0;
  const startCtx = (actorId: string, seq: number[] = []): CommandContext => {
    let i = 0;
    return { ...ctx(actorId), decks, random: () => seq[i++ % Math.max(seq.length, 1)] ?? 0.5, newId: () => `c${++n}` };
  };
  const lobby = () => {
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: `deck-${p}` });
    }
    return s;
  };

  it('refuses until everyone is seated and ready, and only for the owner', () => {
    let s = lobby();
    expect(decide(s, { type: 'start' }, startCtx('a'))).toEqual({ ok: false, error: 'Not ready: A, B' });
    s = run(s, 'a', { type: 'setReady', ready: true });
    s = run(s, 'b', { type: 'setReady', ready: true });
    expect(decide(s, { type: 'start' }, startCtx('b'))).toEqual({ ok: false, error: 'Only the owner can start the game' });
    expect(decide(s, { type: 'start' }, ctx('a'))).toEqual({ ok: false, error: 'Decks unavailable' });
  });

  it('deals shuffled libraries, seven-card hands, command zone and sideboard, and rolls for first', () => {
    let s = lobby();
    s = run(s, 'a', { type: 'setReady', ready: true });
    s = run(s, 'b', { type: 'setReady', ready: true });
    const d = decide(s, { type: 'start' }, startCtx('a', [0.1, 0.9, 0.3, 0.7]));
    if (!d.ok) throw new Error(d.error);
    const started = d.events[0];
    expect(started?.type).toBe('gameStarted');
    s = reduceAll(s, d.events);
    expect(s.phase).toBe('playing');
    const g = s.game!;
    expect(g.players.a?.zones.hand).toHaveLength(7);
    expect(g.players.a?.zones.library).toHaveLength(3);
    expect(g.players.a?.zones.sideboard).toHaveLength(1);
    expect(g.players.b?.zones.command).toHaveLength(1);
    expect(g.players.b?.zones.library).toHaveLength(2);
    expect(Object.keys(g.cards)).toHaveLength(10 + 1 + 9 + 1);
    const cmdr = g.cards[g.players.b!.zones.command[0]!]!;
    expect(cmdr).toMatchObject({ printingId: 'cmdr', ownerId: 'b', zone: 'command', visibleTo: 'all' });
    expect(g.cards[g.players.a!.zones.hand[0]!]?.visibleTo).toBe('owner');
    expect(Object.keys(g.openingRoll).sort()).toEqual(['a', 'b']);
    expect(['a', 'b']).toContain(g.firstPlayerId);
    expect(g.players.a?.life).toBe(20);
    expect(g.teamLife).toBeNull();
  });

  it('shuffles with the injected random source deterministically', () => {
    const items = [1, 2, 3, 4, 5];
    const seq = [0.9, 0.1, 0.5, 0.3];
    let i = 0;
    const a = shuffled(items, () => seq[i++ % seq.length]!);
    i = 0;
    const b = shuffled(items, () => seq[i++ % seq.length]!);
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('table actions', () => {
  const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
  const decks = {
    a: { main: [{ printingId: 'bolt', quantity: 10 }], sideboard: [], commander: [] },
    b: { main: [{ printingId: 'island', quantity: 9 }], sideboard: [], commander: [] },
  };
  let n = 0;
  const playing = () => {
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: `deck-${p}` });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    let r = 0;
    const d = decide(s, { type: 'start' }, { ...ctx('a'), decks, random: () => ((r += 7) % 11) / 11, newId: () => `c${++n}` });
    if (!d.ok) throw new Error(d.error);
    return reduceAll(s, d.events);
  };
  const g = (s: ReturnType<typeof playing>) => s.game!;

  it('moves a card from hand to the battlefield with a position, then to the graveyard', () => {
    let s = playing();
    const id = g(s).players.a!.zones.hand[0]!;
    s = run(s, 'a', { type: 'moveCard', instanceId: id, to: 'battlefield', position: { x: 10, y: 20 } });
    expect(g(s).cards[id]).toMatchObject({ zone: 'battlefield', position: { x: 10, y: 20 }, visibleTo: 'all' });
    expect(g(s).players.a!.zones.hand).toHaveLength(6);
    expect(g(s).players.a!.zones.battlefield).toEqual([id]);
    s = run(s, 'a', { type: 'tapCard', instanceId: id, tapped: true });
    expect(g(s).cards[id]?.tapped).toBe(true);
    s = run(s, 'a', { type: 'moveCard', instanceId: id, to: 'graveyard' });
    expect(g(s).cards[id]).toMatchObject({ zone: 'graveyard', tapped: false, position: null });
    expect(g(s).players.a!.zones.battlefield).toEqual([]);
    expect(g(s).players.a!.zones.graveyard).toEqual([id]);
  });

  it('repositions within the battlefield without resetting state', () => {
    let s = playing();
    const id = g(s).players.a!.zones.hand[0]!;
    s = run(s, 'a', { type: 'moveCard', instanceId: id, to: 'battlefield', position: { x: 1, y: 1 } });
    s = run(s, 'a', { type: 'tapCard', instanceId: id, tapped: true });
    s = run(s, 'a', { type: 'moveCard', instanceId: id, to: 'battlefield', position: { x: 5, y: 5 } });
    expect(g(s).cards[id]).toMatchObject({ tapped: true, position: { x: 5, y: 5 } });
    expect(g(s).players.a!.zones.battlefield).toEqual([id]);
  });

  it('draws from the top and puts cards on top or bottom of the library', () => {
    let s = playing();
    const lib = g(s).players.a!.zones.library;
    const [top, second] = [lib[0]!, lib[1]!];
    s = run(s, 'a', { type: 'draw', count: 2 });
    expect(g(s).players.a!.zones.hand.slice(-2)).toEqual([top, second]);
    expect(g(s).players.a!.zones.library).toHaveLength(1);
    s = run(s, 'a', { type: 'moveCard', instanceId: top, to: 'library', libraryPosition: 'bottom' });
    s = run(s, 'a', { type: 'moveCard', instanceId: second, to: 'library', libraryPosition: 'top' });
    expect(g(s).players.a!.zones.library).toEqual([second, lib[2], top]);
    expect(g(s).cards[top]?.visibleTo).toBe('owner');
    s = run(s, 'a', { type: 'draw', count: 3 });
    expect(decide(s, { type: 'draw', count: 1 }, ctx('a'))).toEqual({ ok: false, error: 'Library is empty' });
  });

  it("refuses to touch another player's cards or to tap outside the battlefield", () => {
    const s = playing();
    const mine = g(s).players.a!.zones.hand[0]!;
    const theirs = g(s).players.b!.zones.hand[0]!;
    expect(decide(s, { type: 'moveCard', instanceId: theirs, to: 'graveyard' }, ctx('a'))).toEqual({ ok: false, error: 'Not your card' });
    expect(decide(s, { type: 'tapCard', instanceId: mine, tapped: true }, ctx('a'))).toEqual({ ok: false, error: 'Only permanents can be tapped' });
    expect(decide(s, { type: 'moveCard', instanceId: 'nope', to: 'graveyard' }, ctx('a'))).toEqual({ ok: false, error: 'No such card' });
  });
});

describe('rollForFirst safety', () => {
  it('terminates with a constant random source', () => {
    const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const decks = { a: { main: [{ printingId: 'x', quantity: 8 }], sideboard: [], commander: [] }, b: { main: [{ printingId: 'y', quantity: 8 }], sideboard: [], commander: [] } };
    let n = 0;
    const d = decide(s, { type: 'start' }, { ...ctx('a'), decks, random: () => 0.5, newId: () => `k${++n}` });
    expect(d.ok).toBe(true);
    if (d.ok && d.events[0]?.type === 'gameStarted') expect(d.events[0].firstPlayerId).toBe('a');
  });
});
