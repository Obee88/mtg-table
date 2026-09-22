import { describe, expect, it } from 'vitest';
import { decide, type CommandContext } from './decide.js';
import { activePlayer, inMulligan, isActive } from './types.js';
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

  it('keeps a reserved table for the named players and the owner', () => {
    const reserved = reduce(created, { type: 'settingsChanged', settings: { ...settings, reservedPlayerIds: ['b'] } });
    expect(decide(reserved, { type: 'join' }, ctx('c'))).toEqual({ ok: false, error: 'This table is reserved for other players' });
    let state = run(reserved, 'a', { type: 'join' }); // the owner
    state = run(state, 'b', { type: 'join' });
    expect(Object.keys(state.players)).toEqual(['a', 'b']);
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
    expect(g.mulligans).toEqual({ a: { taken: 0, kept: false }, b: { taken: 0, kept: false } });
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
    return keepAll(reduceAll(s, d.events));
  };
  const g = (s: ReturnType<typeof playing>) => s.game!;

  it('moves a card from hand to the battlefield with a position, then to the graveyard', () => {
    let s = playing();
    const id = g(s).players.a!.zones.hand[0]!;
    s = run(s, 'a', { type: 'moveCard', instanceId: id, to: 'battlefield', position: { row: 0, col: 3 } });
    expect(g(s).cards[id]).toMatchObject({ zone: 'battlefield', position: { row: 0, col: 3 }, visibleTo: 'all' });
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
    s = run(s, 'a', { type: 'moveCard', instanceId: id, to: 'battlefield', position: { row: 0, col: 1 } });
    s = run(s, 'a', { type: 'tapCard', instanceId: id, tapped: true });
    s = run(s, 'a', { type: 'moveCard', instanceId: id, to: 'battlefield', position: { row: 1, col: 2 } });
    expect(g(s).cards[id]).toMatchObject({ tapped: true, position: { row: 1, col: 2 } });
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
    expect(g(s).cards[top]?.visibleTo).toEqual([]); // nobody knows library order
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

describe('untap all, shuffle, mulligan', () => {
  const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
  const decks = {
    a: { main: [{ printingId: 'bolt', quantity: 6 }, { printingId: 'mountain', quantity: 6 }], sideboard: [], commander: [] },
    b: { main: [{ printingId: 'island', quantity: 9 }], sideboard: [], commander: [] },
  };
  let n = 0;
  let r = 0;
  const rnd = () => ((r += 7) % 11) / 11;
  const full = (actor: string): CommandContext => ({ ...ctx(actor), random: rnd, newId: () => `n${++n}` });
  const playing = () => {
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: `deck-${p}` });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...full('a'), decks });
    if (!d.ok) throw new Error(d.error);
    return keepAll(reduceAll(s, d.events));
  };
  const g = (s: ReturnType<typeof playing>) => s.game!;
  const runFull = (s: ReturnType<typeof playing>, actor: string, command: Parameters<typeof decide>[1]) => {
    const d = decide(s, command, full(actor));
    if (!d.ok) throw new Error(d.error);
    return reduceAll(s, d.events);
  };

  it('untaps every tapped permanent of the actor only', () => {
    let s = playing();
    const [x, y] = g(s).players.a!.zones.hand;
    s = run(s, 'a', { type: 'moveCard', instanceId: x!, to: 'battlefield' });
    s = run(s, 'a', { type: 'moveCard', instanceId: y!, to: 'battlefield' });
    s = run(s, 'a', { type: 'tapCard', instanceId: x!, tapped: true });
    s = run(s, 'a', { type: 'tapCard', instanceId: y!, tapped: true });
    const other = g(s).players.b!.zones.hand[0]!;
    s = run(s, 'b', { type: 'moveCard', instanceId: other, to: 'battlefield' });
    s = run(s, 'b', { type: 'tapCard', instanceId: other, tapped: true });
    s = run(s, 'a', { type: 'untapAll' });
    expect(g(s).cards[x!]?.tapped).toBe(false);
    expect(g(s).cards[y!]?.tapped).toBe(false);
    expect(g(s).cards[other]?.tapped).toBe(true);
    expect(decide(s, { type: 'untapAll' }, ctx('a'))).toEqual({ ok: true, events: [] });
  });

  it('shuffling re-keys the library, keeps its contents, and removes the old ids', () => {
    let s = playing();
    const before = g(s).players.a!.zones.library;
    const identities = before.map((id) => g(s).cards[id]!.printingId).sort();
    s = runFull(s, 'a', { type: 'shuffleLibrary' });
    const after = g(s).players.a!.zones.library;
    expect(after).toHaveLength(before.length);
    expect(after.some((id) => before.includes(id))).toBe(false);
    expect(after.map((id) => g(s).cards[id]!.printingId).sort()).toEqual(identities);
    for (const id of before) expect(g(s).cards[id]).toBeUndefined();
    expect(Object.keys(g(s).cards)).toHaveLength(12 + 9);
    expect(g(s).cards[after[0]!]).toMatchObject({ zone: 'library', visibleTo: [], ownerId: 'a' });
  });

});

describe('card state', () => {
  const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
  const decks = {
    a: { main: [{ printingId: 'bolt', quantity: 10 }], sideboard: [], commander: [] },
    b: { main: [{ printingId: 'island', quantity: 9 }], sideboard: [], commander: [] },
  };
  let n = 0;
  let r = 0;
  const full = (actor: string): CommandContext => ({ ...ctx(actor), random: () => ((r += 7) % 11) / 11, newId: () => `t${++n}` });
  const playing = () => {
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: `deck-${p}` });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...full('a'), decks });
    if (!d.ok) throw new Error(d.error);
    s = reduceAll(s, d.events);
    s = keepAll(s);
    const [x, y] = s.game!.players.a!.zones.hand;
    s = run(s, 'a', { type: 'moveCard', instanceId: x!, to: 'battlefield', position: { row: 0, col: 0 } });
    s = run(s, 'a', { type: 'moveCard', instanceId: y!, to: 'battlefield', position: { row: 0, col: 1 } });
    return { s, x: x!, y: y! };
  };
  const runFull = (s: ReturnType<typeof initialRoomState>, actor: string, command: Parameters<typeof decide>[1]) => {
    const d = decide(s, command, full(actor));
    if (!d.ok) throw new Error(d.error);
    return reduceAll(s, d.events);
  };

  it('transform, flip and note are simple toggles with idempotent commands', () => {
    const p = playing();
    let s = p.s;
    const { x } = p;
    s = run(s, 'a', { type: 'transformCard', instanceId: x, transformed: true });
    s = run(s, 'a', { type: 'flipCard', instanceId: x, flipped: true });
    s = run(s, 'a', { type: 'setNote', instanceId: x, note: 'copy of Bolt' });
    expect(s.game!.cards[x]).toMatchObject({ transformed: true, flipped: true, note: 'copy of Bolt' });
    expect(decide(s, { type: 'transformCard', instanceId: x, transformed: true }, ctx('a'))).toEqual({ ok: true, events: [] });
    s = run(s, 'a', { type: 'setNote', instanceId: x, note: '' });
    expect(s.game!.cards[x]?.note).toBeNull();
    // leaving the battlefield resets transform/flip but keeps the note
    s = run(s, 'a', { type: 'setNote', instanceId: x, note: 'n' });
    s = run(s, 'a', { type: 'moveCard', instanceId: x, to: 'graveyard' });
    expect(s.game!.cards[x]).toMatchObject({ transformed: false, flipped: false, note: 'n' });
  });

  it('face-down hides the card from opponents until turned face up', () => {
    const p = playing();
    let s = p.s;
    const { x } = p;
    s = run(s, 'a', { type: 'setFaceDown', instanceId: x, faceDown: true });
    expect(s.game!.cards[x]).toMatchObject({ faceDown: true, visibleTo: 'owner' });
    s = run(s, 'a', { type: 'setFaceDown', instanceId: x, faceDown: false });
    expect(s.game!.cards[x]).toMatchObject({ faceDown: false, visibleTo: 'all' });
    const inHand = s.game!.players.a!.zones.hand[0]!;
    expect(decide(s, { type: 'setFaceDown', instanceId: inHand, faceDown: true }, ctx('a')).ok).toBe(false);
  });

  it('counters accumulate per kind, never go negative, and vanish at zero', () => {
    const p = playing();
    let s = p.s;
    const { x } = p;
    s = run(s, 'a', { type: 'addCounter', instanceId: x, kind: '+1/+1', delta: 2 });
    s = run(s, 'a', { type: 'addCounter', instanceId: x, kind: '+1/+1', delta: 1 });
    s = run(s, 'a', { type: 'addCounter', instanceId: x, kind: 'loyalty', delta: 4 });
    expect(s.game!.cards[x]?.counters).toEqual({ '+1/+1': 3, loyalty: 4 });
    s = run(s, 'a', { type: 'addCounter', instanceId: x, kind: '+1/+1', delta: -5 });
    expect(s.game!.cards[x]?.counters).toEqual({ loyalty: 4 });
    expect(decide(s, { type: 'addCounter', instanceId: x, kind: '+1/+1', delta: -1 }, ctx('a'))).toEqual({ ok: true, events: [] });
    s = run(s, 'a', { type: 'moveCard', instanceId: x, to: 'hand' });
    expect(s.game!.cards[x]?.counters).toEqual({});
  });

  it('attachments: host must be a permanent, no self or loops, detach when the host leaves', () => {
    const p = playing();
    let s = p.s;
    const { x, y } = p;
    s = run(s, 'a', { type: 'attachCard', instanceId: x, to: y });
    expect(s.game!.cards[x]?.attachedTo).toBe(y);
    expect(decide(s, { type: 'attachCard', instanceId: y, to: x }, ctx('a'))).toEqual({ ok: false, error: 'Cannot create an attachment loop' });
    expect(decide(s, { type: 'attachCard', instanceId: y, to: y }, ctx('a'))).toEqual({ ok: false, error: 'Cannot attach a card to itself' });
    const inHand = s.game!.players.a!.zones.hand[0]!;
    expect(decide(s, { type: 'attachCard', instanceId: x, to: inHand }, ctx('a'))).toEqual({ ok: false, error: 'Target is not on the battlefield' });
    s = run(s, 'a', { type: 'moveCard', instanceId: y, to: 'graveyard' });
    expect(s.game!.cards[x]?.attachedTo).toBeNull();
  });

  it('tokens are created on the battlefield, visible to all, and cease to exist when they leave', () => {
    let { s } = playing();
    s = runFull(s, 'a', { type: 'createToken', printingId: null, customName: 'Zombie 2/2', count: 3, position: { row: 0, col: 5 } });
    const tokens = s.game!.players.a!.zones.battlefield.slice(-3);
    expect(tokens).toHaveLength(3);
    expect(s.game!.cards[tokens[0]!]).toMatchObject({ isToken: true, printingId: null, customName: 'Zombie 2/2', visibleTo: 'all', zone: 'battlefield' });
    s = run(s, 'a', { type: 'moveCard', instanceId: tokens[0]!, to: 'graveyard' });
    expect(s.game!.cards[tokens[0]!]).toBeUndefined();
    expect(s.game!.players.a!.zones.graveyard).toEqual([]);
    expect(decide(s, { type: 'createToken', printingId: null, customName: null, count: 1, position: { row: 0, col: 0 } }, full('a')).ok).toBe(false);
    s = runFull(s, 'a', { type: 'createToken', printingId: 'bolt', customName: null, count: 1, position: { row: 0, col: 1 } });
    expect(s.game!.cards[s.game!.players.a!.zones.battlefield.at(-1)!]).toMatchObject({ isToken: true, printingId: 'bolt' });
  });
});

describe('player state and dice', () => {
  const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: true };
  const decks = {
    a: { main: [{ printingId: 'bolt', quantity: 8 }], sideboard: [], commander: [{ printingId: 'cmd', quantity: 1 }] },
    b: { main: [{ printingId: 'island', quantity: 8 }], sideboard: [], commander: [] },
  };
  let n = 0;
  let r = 0;
  const full = (actor: string): CommandContext => ({ ...ctx(actor), random: () => ((r += 7) % 11) / 11, newId: () => `p${++n}` });
  const playing = (s0?: RoomSettings) => {
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings: s0 ?? settings });
    const ids = (s0?.playerCount ?? 2) === 4 ? ['a', 'b', 'c', 'd'] : ['a', 'b'];
    const dk = Object.fromEntries(ids.map((id) => [id, decks.b]));
    for (const p of ids) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...full('a'), decks: dk });
    if (!d.ok) throw new Error(d.error);
    return keepAll(reduceAll(s, d.events));
  };

  it('life, poison, counters, commander tax and damage change only for the actor', () => {
    let s = playing();
    s = run(s, 'a', { type: 'adjustLife', delta: -3 });
    s = run(s, 'a', { type: 'adjustPoison', delta: 2 });
    s = run(s, 'a', { type: 'adjustPlayerCounter', kind: 'energy', delta: 4 });
    s = run(s, 'a', { type: 'adjustCommanderTax', delta: 2 });
    s = run(s, 'a', { type: 'adjustCommanderDamage', fromPlayerId: 'b', delta: 5 });
    expect(s.game!.players.a).toMatchObject({ life: 17, poison: 2, counters: { energy: 4 }, commanderTax: 2, commanderDamage: { b: 5 } });
    expect(s.game!.players.b).toMatchObject({ life: 20, poison: 0, counters: {} });
    s = run(s, 'a', { type: 'adjustPoison', delta: -9 });
    s = run(s, 'a', { type: 'adjustPlayerCounter', kind: 'energy', delta: -4 });
    s = run(s, 'a', { type: 'adjustCommanderDamage', fromPlayerId: 'b', delta: -5 });
    expect(s.game!.players.a).toMatchObject({ poison: 0, counters: {}, commanderDamage: {} });
    expect(decide(s, { type: 'adjustCommanderDamage', fromPlayerId: 'zz', delta: 1 }, ctx('a'))).toEqual({ ok: false, error: 'Unknown player' });
    expect(decide(s, { type: 'adjustLife', delta: 0 }, ctx('a'))).toEqual({ ok: true, events: [] });
  });

  it('2v2 life is shared per team', () => {
    let s = playing({ playerCount: 4, mode: '2v2', startingLife: 30, commander: false });
    expect(s.game!.teamLife).toEqual({ 0: 30, 1: 30 });
    s = run(s, 'a', { type: 'adjustLife', delta: -4 });
    s = run(s, 'c', { type: 'adjustLife', delta: -1 }); // a's teammate
    expect(s.game!.teamLife).toEqual({ 0: 25, 1: 30 });
    expect(s.game!.players.a!.life).toBe(30); // untouched individual value
  });

  it('dice and coins come from the injected random source and change no state', () => {
    const s = playing();
    let i = 0;
    const seq = [0, 0.999, 0.5, 0.25];
    const c: CommandContext = { ...ctx('a'), random: () => seq[i++ % seq.length]! };
    const dice = decide(s, { type: 'rollDice', sides: 20, count: 4 }, c);
    expect(dice).toEqual({ ok: true, events: [{ type: 'diceRolled', playerId: 'a', sides: 20, results: [1, 20, 11, 6] }] });
    i = 0;
    const coins = decide(s, { type: 'flipCoin', count: 2 }, c);
    expect(coins).toEqual({ ok: true, events: [{ type: 'coinFlipped', playerId: 'a', results: ['heads', 'tails'] }] });
    expect(reduceAll(s, [...(dice.ok ? dice.events : []), ...(coins.ok ? coins.events : [])])).toEqual(s);
    expect(decide(s, { type: 'rollDice', sides: 6, count: 1 }, ctx('a'))).toEqual({ ok: false, error: 'Randomness unavailable' });
  });
});

describe('actionUndone', () => {
  it('restores the embedded state (except the room id and seq)', () => {
    const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
    const before = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    const after = run(before, 'b', { type: 'join' });
    const restored = reduce(after, { type: 'actionUndone', fromSeq: 2, toSeq: 2, state: { ...before, id: 'other', seq: 1 } });
    expect(restored).toEqual({ ...before, id: 'r', seq: 1 });
    expect(decide(after, { type: 'undo' }, ctx('b'))).toEqual({ ok: false, error: 'Undo is handled by the server' });
  });
});

describe('multi-card commands', () => {
  const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
  const decks = { a: { main: [{ printingId: 'bolt', quantity: 10 }], sideboard: [], commander: [] }, b: { main: [{ printingId: 'isle', quantity: 9 }], sideboard: [], commander: [] } };
  let n = 0;
  let r = 0;
  const playing = () => {
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...ctx('a'), decks, random: () => ((r += 7) % 11) / 11, newId: () => `m${++n}` });
    if (!d.ok) throw new Error(d.error);
    return keepAll(reduceAll(s, d.events));
  };

  it('moves several cards in one batch with per-card positions, then taps them together', () => {
    let s = playing();
    const [x, y, z] = s.game!.players.a!.zones.hand;
    s = run(s, 'a', { type: 'moveCards', instanceIds: [x!, y!, x!], to: 'battlefield', positions: { [x!]: { row: 0, col: 1 }, [y!]: { row: 0, col: 2 } } });
    expect(s.game!.players.a!.zones.battlefield).toEqual([x, y]);
    expect(s.game!.cards[y!]?.position).toEqual({ row: 0, col: 2 });
    s = run(s, 'a', { type: 'tapCards', instanceIds: [x!, y!, z!], tapped: true }); // z is in hand: skipped
    expect(s.game!.cards[x!]?.tapped).toBe(true);
    expect(s.game!.cards[y!]?.tapped).toBe(true);
    expect(s.game!.cards[z!]?.tapped).toBe(false);
    expect(decide(s, { type: 'tapCards', instanceIds: [x!], tapped: true }, ctx('a'))).toEqual({ ok: true, events: [] });
    s = run(s, 'a', { type: 'moveCards', instanceIds: [x!, y!], to: 'library', libraryPosition: 'bottom' });
    expect(s.game!.players.a!.zones.library.slice(-2)).toEqual([x, y]);
  });

  it('rejects the whole batch if any card is not yours', () => {
    const s = playing();
    const mine = s.game!.players.a!.zones.hand[0]!;
    const theirs = s.game!.players.b!.zones.hand[0]!;
    expect(decide(s, { type: 'moveCards', instanceIds: [mine, theirs], to: 'graveyard' }, ctx('a'))).toEqual({ ok: false, error: 'Not your card' });
  });
});

describe('stack zone', () => {
  const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
  const decks = { a: { main: [{ printingId: 'bolt', quantity: 10 }], sideboard: [], commander: [] }, b: { main: [{ printingId: 'isle', quantity: 9 }], sideboard: [], commander: [] } };
  let n = 0;
  let r = 0;
  const playing = () => {
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...ctx('a'), decks, random: () => ((r += 7) % 11) / 11, newId: () => `s${++n}` });
    if (!d.ok) throw new Error(d.error);
    return keepAll(reduceAll(s, d.events));
  };

  it('is shared, public and ordered by cast order across players', () => {
    let s = playing();
    const a1 = s.game!.players.a!.zones.hand[0]!;
    const b1 = s.game!.players.b!.zones.hand[0]!;
    const a2 = s.game!.players.a!.zones.hand[1]!;
    s = run(s, 'a', { type: 'moveCard', instanceId: a1, to: 'stack' });
    s = run(s, 'b', { type: 'moveCard', instanceId: b1, to: 'stack' });
    s = run(s, 'a', { type: 'moveCard', instanceId: a2, to: 'stack' });
    expect(s.game!.stack).toEqual([a1, b1, a2]);
    expect(s.game!.cards[b1]).toMatchObject({ zone: 'stack', visibleTo: 'all' });
    expect(s.game!.players.a!.zones.stack).toEqual([a1, a2]);
    // top resolves: b1 leaves in the middle
    s = run(s, 'b', { type: 'moveCard', instanceId: b1, to: 'graveyard' });
    expect(s.game!.stack).toEqual([a1, a2]);
    s = run(s, 'a', { type: 'moveCard', instanceId: a2, to: 'battlefield' });
    expect(s.game!.stack).toEqual([a1]);
    expect(decide(s, { type: 'tapCard', instanceId: a1, tapped: true }, ctx('a')).ok).toBe(false);
  });
});

describe('battlefield slots', () => {
  const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
  const decks = { a: { main: [{ printingId: 'bolt', quantity: 10 }], sideboard: [], commander: [] }, b: { main: [{ printingId: 'isle', quantity: 9 }], sideboard: [], commander: [] } };
  let n = 0;
  let r = 0;
  it('appends to the front row when no slot is given; explicit slots and piles are kept', () => {
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...ctx('a'), decks, random: () => ((r += 7) % 11) / 11, newId: () => `b${++n}` });
    if (!d.ok) throw new Error(d.error);
    s = reduceAll(s, d.events);
    s = keepAll(s);
    const [x, y, z] = s.game!.players.a!.zones.hand;
    s = run(s, 'a', { type: 'moveCard', instanceId: x!, to: 'battlefield' });
    s = run(s, 'a', { type: 'moveCard', instanceId: y!, to: 'battlefield' });
    expect(s.game!.cards[x!]?.position).toEqual({ row: 0, col: 0 });
    expect(s.game!.cards[y!]?.position).toEqual({ row: 0, col: 1 });
    // join x's pile
    s = run(s, 'a', { type: 'moveCard', instanceId: z!, to: 'battlefield', position: { row: 0, col: 0 } });
    expect(s.game!.cards[z!]?.position).toEqual({ row: 0, col: 0 });
    // a batch appends sequentially
    const [p, q] = s.game!.players.a!.zones.hand;
    s = run(s, 'a', { type: 'moveCards', instanceIds: [p!, q!], to: 'battlefield' });
    expect(s.game!.cards[p!]?.position).toEqual({ row: 0, col: 2 });
    expect(s.game!.cards[q!]?.position).toEqual({ row: 0, col: 3 });
  });
});

/** Everyone finishes sideboarding without changes. */
function finishAll(s: ReturnType<typeof initialRoomState>) {
  return Object.keys(s.players).reduce((acc, p) => run(acc, p, { type: 'finishSideboarding' }), s);
}

/** Everyone finishes sideboarding and keeps their opening hand so ordinary actions are allowed. */
function keepAll(s: ReturnType<typeof initialRoomState>) {
  return Object.keys(s.players).reduce((acc, p) => run(acc, p, { type: 'keepHand', bottom: [] }), finishAll(s));
}

describe('mulligan phase', () => {
  const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
  const decks = { a: { main: [{ printingId: 'bolt', quantity: 12 }], sideboard: [], commander: [] }, b: { main: [{ printingId: 'isle', quantity: 12 }], sideboard: [], commander: [] } };
  let n = 0;
  let r = 0;
  const full = (actor: string): CommandContext => ({ ...ctx(actor), random: () => ((r += 7) % 11) / 11, newId: () => `mu${++n}`, decks });
  const dealt = () => {
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, full('a'));
    if (!d.ok) throw new Error(d.error);
    return reduceAll(s, d.events);
  };
  const runFull = (s: ReturnType<typeof initialRoomState>, actor: string, command: Parameters<typeof decide>[1]) => {
    const d = decide(s, command, full(actor));
    if (!d.ok) throw new Error(d.error);
    return reduceAll(s, d.events);
  };

  it('blocks play until everyone has kept', () => {
    let s = finishAll(dealt());
    expect(inMulligan(s.game!)).toBe(true);
    const hand = s.game!.players.a!.zones.hand[0]!;
    expect(decide(s, { type: 'moveCard', instanceId: hand, to: 'battlefield' }, ctx('a'))).toEqual({ ok: false, error: 'Waiting for everyone to keep their opening hand' });
    expect(decide(s, { type: 'draw', count: 1 }, ctx('a')).ok).toBe(false);
    s = run(s, 'a', { type: 'keepHand', bottom: [] });
    expect(inMulligan(s.game!)).toBe(true);
    expect(decide(s, { type: 'draw', count: 1 }, ctx('a')).ok).toBe(false);
    s = run(s, 'b', { type: 'keepHand', bottom: [] });
    expect(inMulligan(s.game!)).toBe(false);
    expect(decide(s, { type: 'draw', count: 1 }, ctx('a')).ok).toBe(true);
    expect(decide(s, { type: 'keepHand', bottom: [] }, ctx('a'))).toEqual({ ok: false, error: 'You have already kept your hand' });
  });

  it('a mulligan redraws seven and keeping then bottoms one card per mulligan', () => {
    let s = finishAll(dealt());
    const before = s.game!.players.a!.zones.hand;
    s = runFull(s, 'a', { type: 'mulligan' });
    expect(s.game!.mulligans.a).toEqual({ taken: 1, kept: false });
    expect(s.game!.players.a!.zones.hand).toHaveLength(7);
    expect(s.game!.players.a!.zones.hand.some((id) => before.includes(id))).toBe(false);
    expect(s.game!.players.a!.zones.library).toHaveLength(5);
    s = runFull(s, 'a', { type: 'mulligan' });
    expect(s.game!.mulligans.a?.taken).toBe(2);
    expect(decide(s, { type: 'keepHand', bottom: [] }, ctx('a'))).toEqual({ ok: false, error: 'Choose 2 cards to put on the bottom' });
    const [x, y] = s.game!.players.a!.zones.hand;
    expect(decide(s, { type: 'keepHand', bottom: [x!, 'nope'] }, ctx('a')).ok).toBe(false);
    s = run(s, 'a', { type: 'keepHand', bottom: [x!, y!] });
    expect(s.game!.mulligans.a).toEqual({ taken: 2, kept: true });
    expect(s.game!.players.a!.zones.hand).toHaveLength(5);
    expect(s.game!.players.a!.zones.library.slice(-2)).toEqual([x, y]);
    expect(decide(s, { type: 'mulligan' }, full('a')).ok).toBe(false);
  });

  it('restart re-deals for the owner only and re-enters the mulligan phase', () => {
    let s = keepAll(dealt());
    expect(decide(s, { type: 'restart' }, full('b'))).toEqual({ ok: false, error: 'Only the owner can restart the game' });
    const oldHand = s.game!.players.a!.zones.hand;
    s = runFull(s, 'a', { type: 'restart' });
    expect(inMulligan(s.game!)).toBe(true);
    expect(s.game!.players.a!.zones.hand).toHaveLength(7);
    expect(s.game!.players.a!.zones.hand.some((id) => oldHand.includes(id))).toBe(false);
    expect(Object.keys(s.game!.cards)).toHaveLength(24);
  });
});

describe('turns', () => {
  const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
  const decks = { a: { main: [{ printingId: 'bolt', quantity: 9 }], sideboard: [], commander: [] }, b: { main: [{ printingId: 'isle', quantity: 9 }], sideboard: [], commander: [] } };
  it('starts with the roll winner and passes around the seats', () => {
    let n = 0;
    let r = 0;
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...ctx('a'), decks, random: () => ((r += 7) % 11) / 11, newId: () => `t${++n}` });
    if (!d.ok) throw new Error(d.error);
    s = reduceAll(s, d.events);
    expect(decide(s, { type: 'endTurn' }, ctx(s.game!.firstPlayerId)).ok).toBe(false); // mulligan phase
    s = keepAll(s);
    const first = s.game!.firstPlayerId;
    const other = first === 'a' ? 'b' : 'a';
    expect(activePlayer(s.game!)).toBe(first);
    expect(s.game!.turn).toBe(1);
    expect(decide(s, { type: 'endTurn' }, ctx(other))).toEqual({ ok: false, error: 'It is not your turn' });
    s = run(s, first, { type: 'endTurn' });
    expect(activePlayer(s.game!)).toBe(other);
    // Everyone counts their own turns: this is the other player's first, not turn two of the game.
    expect(s.game!.turn).toBe(1);
    expect(s.game!.turns).toEqual({ [first]: 1, [other]: 1 });
    s = run(s, other, { type: 'endTurn' });
    expect(activePlayer(s.game!)).toBe(first);
    expect(s.game!.turn).toBe(2);
    expect(s.game!.step).toBe('untap');
  });

  it('walks the steps with the play button, untapping, drawing and passing', () => {
    let n = 0;
    let r = 0;
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...ctx('a'), decks, random: () => ((r += 7) % 11) / 11, newId: () => `t${++n}` });
    if (!d.ok) throw new Error(d.error);
    s = keepAll(reduceAll(s, d.events));
    const first = s.game!.firstPlayerId;
    const other = first === 'a' ? 'b' : 'a';
    const play = (who: string) => (s = run(s, who, { type: 'advanceStep' }));
    const hand = () => s.game!.players[first]!.zones.hand.length;

    // In a duel, whoever goes first starts turn one at the first main phase: no untap, no upkeep, no draw.
    expect(s.game!.step).toBe('main1');
    expect(decide(s, { type: 'advanceStep' }, ctx(other))).toEqual({ ok: false, error: 'It is not your turn' });

    const card = s.game!.players[first]!.zones.hand[0]!;
    s = run(s, first, { type: 'moveCard', instanceId: card, to: 'battlefield' });
    s = run(s, first, { type: 'tapCard', instanceId: card, tapped: true });
    s = run(s, first, { type: 'setNoUntap', instanceId: card, value: 2 });
    const before = hand();
    play(first); // main1 → combat
    play(first); // combat → main2
    play(first); // main2 → end
    expect(s.game!.step).toBe('end');
    expect(hand()).toBe(before);
    play(first); // end → the turn passes
    expect(activePlayer(s.game!)).toBe(other);
    expect(s.game!.step).toBe('untap');

    // The second player does draw on their first turn.
    const theirs = s.game!.players[other]!.zones.hand.length;
    play(other);
    play(other);
    play(other);
    expect(s.game!.players[other]!.zones.hand).toHaveLength(theirs + 1);
    expect(s.game!.step).toBe('main1');

    // Clicking a later step auto-plays every step up to it in one command; it never passes the turn.
    s = run(s, other, { type: 'advanceStep', to: 'end' });
    expect(s.game!.step).toBe('end');
    expect(activePlayer(s.game!)).toBe(other);
    expect(decide(s, { type: 'advanceStep', to: 'draw' }, ctx(other))).toEqual({ ok: false, error: 'That step has already passed this turn' });
    play(other); // the turn passes back
    expect(activePlayer(s.game!)).toBe(first);
    expect(s.game!.step).toBe('untap');

    // A tapped permanent untaps, unless it is marked not to.
    play(first);
    expect(s.game!.step).toBe('upkeep');
    expect(s.game!.cards[card]!.tapped).toBe(true);
    expect(s.game!.cards[card]!.noUntap).toBe(1); // one more untap step to skip

    const mine = hand();
    s = run(s, first, { type: 'advanceStep', to: 'main1' });
    expect(s.game!.step).toBe('main1');
    expect(hand()).toBe(mine + 1); // drew on the way, this time
    expect(decide(s, { type: 'advanceStep', to: 'end' }, ctx(other))).toEqual({ ok: false, error: 'It is not your turn' });
  });

  it('lets anyone change anyone\'s life, and discards a whole hand as one action', () => {
    let n = 0;
    let r = 0;
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...ctx('a'), decks, random: () => ((r += 7) % 11) / 11, newId: () => `l${++n}` });
    if (!d.ok) throw new Error(d.error);
    s = keepAll(reduceAll(s, d.events));

    s = run(s, 'a', { type: 'adjustLife', delta: -3, playerId: 'b' });
    expect(s.game!.players.b!.life).toBe(17);
    expect(s.game!.players.a!.life).toBe(20);
    s = run(s, 'a', { type: 'adjustLife', delta: 1 });
    expect(s.game!.players.a!.life).toBe(21);
    expect(decide(s, { type: 'adjustLife', delta: 1, playerId: 'zed' }, ctx('a'))).toEqual({ ok: false, error: 'No such player' });

    const handSize = s.game!.players.b!.zones.hand.length;
    expect(handSize).toBeGreaterThan(0);
    const dec = decide(s, { type: 'discardHand' }, ctx('b'));
    expect(dec.ok && dec.events).toHaveLength(handSize);
    s = run(s, 'b', { type: 'discardHand' });
    expect(s.game!.players.b!.zones.hand).toEqual([]);
    expect(s.game!.players.b!.zones.graveyard).toHaveLength(handSize);
    expect(decide(s, { type: 'discardHand' }, ctx('b'))).toEqual({ ok: false, error: 'Your hand is empty' });
  });

  it('puts taplands onto the battlefield tapped, front or back face', () => {
    let n = 0;
    let r = 0;
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...ctx('a'), decks, random: () => ((r += 7) % 11) / 11, newId: () => `k${++n}` });
    if (!d.ok) throw new Error(d.error);
    s = keepAll(reduceAll(s, d.events));
    const [c1, c2, c3] = s.game!.players.a!.zones.hand;
    const taplands = (face: 'front' | 'back' | null) => ({ ...ctx('a'), taplands: () => face });

    const front = decide(s, { type: 'moveCard', instanceId: c1!, to: 'battlefield' }, taplands('front'));
    expect(front.ok && front.events[0]).toMatchObject({ type: 'cardMoved', tapped: true });
    s = reduceAll(s, front.ok ? front.events : []);
    expect(s.game!.cards[c1!]!.tapped).toBe(true);
    // Moving it around the battlefield keeps its state; it is only tapped on the way in.
    s = run(s, 'a', { type: 'tapCard', instanceId: c1!, tapped: false });
    const again = decide(s, { type: 'moveCard', instanceId: c1!, to: 'battlefield', position: { row: 1, col: 1 } }, taplands('front'));
    expect(again.ok && again.events[0]).not.toHaveProperty('tapped');

    // The back-face land of a modal double-faced card: put down, then turned over, and tapped by the turn.
    const plain = decide(s, { type: 'moveCard', instanceId: c2!, to: 'battlefield' }, taplands('back'));
    expect(plain.ok && plain.events[0]).not.toHaveProperty('tapped');
    s = reduceAll(s, plain.ok ? plain.events : []);
    const turned = decide(s, { type: 'transformCard', instanceId: c2!, transformed: true }, taplands('back'));
    expect(turned.ok && turned.events.map((e) => e.type)).toEqual(['cardTransformed', 'cardTapped']);
    s = reduceAll(s, turned.ok ? turned.events : []);
    expect(s.game!.cards[c2!]).toMatchObject({ transformed: true, tapped: true });

    // No lookup, or not a tapland: untapped as before.
    const none = decide(s, { type: 'moveCard', instanceId: c3!, to: 'battlefield' }, taplands(null));
    expect(none.ok && none.events[0]).not.toHaveProperty('tapped');
    s = reduceAll(s, none.ok ? none.events : []);
    expect(s.game!.cards[c3!]!.tapped).toBe(false);
  });
});

describe('2v2 seating and turns', () => {
  const settings: RoomSettings = { playerCount: 4, mode: '2v2', startingLife: 30, commander: false };
  const deck = { main: [{ printingId: 'x', quantity: 8 }], sideboard: [], commander: [] };
  const decks = { a: deck, b: deck, c: deck, d: deck };

  it('lets a player move to a free lobby seat and recomputes the team', () => {
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b', 'c']) s = run(s, p, { type: 'join' });
    expect(s.players.c?.team).toBe(0);
    s = run(s, 'c', { type: 'takeSeat', seat: 3 });
    expect(s.players.c).toMatchObject({ seat: 3, team: 1, ready: false });
    expect(decide(s, { type: 'takeSeat', seat: 1 }, ctx('c'))).toEqual({ ok: false, error: 'That seat is taken' });
    expect(decide(s, { type: 'takeSeat', seat: 4 }, ctx('c'))).toEqual({ ok: false, error: 'No such seat' });
    expect(decide(s, { type: 'takeSeat', seat: 3 }, ctx('c'))).toEqual({ ok: true, events: [] });
    s = run(s, 'd', { type: 'join' });
    expect(s.players.d).toMatchObject({ seat: 2, team: 0 });
  });

  it('partners share the turn: either may end it, and it passes to the other team', () => {
    let n = 0;
    let r = 0;
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b', 'c', 'd']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...ctx('a'), decks, random: () => ((r += 7) % 11) / 11, newId: () => `w${++n}` });
    if (!d.ok) throw new Error(d.error);
    s = keepAll(reduceAll(s, d.events));
    const first = s.game!.firstPlayerId;
    const team = s.players[first]!.team;
    const partner = Object.values(s.players).find((p) => p.team === team && p.id !== first)!;
    // Turn one of a multiplayer game starts at the draw step: the first player draws, but skips untap and upkeep.
    expect(s.game!.step).toBe('draw');
    const before = s.game!.players[first]!.zones.hand.length;
    s = run(s, first, { type: 'advanceStep' });
    expect(s.game!.players[first]!.zones.hand).toHaveLength(before + 1);
    expect(s.game!.step).toBe('main1');
    const enemy = Object.values(s.players).find((p) => p.team !== team)!;
    expect(isActive(s, partner.id)).toBe(true);
    expect(isActive(s, enemy.id)).toBe(false);
    expect(decide(s, { type: 'endTurn' }, ctx(enemy.id))).toEqual({ ok: false, error: 'It is not your turn' });
    s = run(s, partner.id, { type: 'endTurn' });
    expect(s.players[activePlayer(s.game!)]!.team).not.toBe(team);
    expect(isActive(s, first)).toBe(false);
  });
});

describe('commander', () => {
  const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 40, commander: true };
  const decks = {
    a: { main: [{ printingId: 'bolt', quantity: 9 }], sideboard: [], commander: [{ printingId: 'cmdr', quantity: 1 }] },
    b: { main: [{ printingId: 'isle', quantity: 9 }], sideboard: [], commander: [] },
  };
  let n = 0;
  let r = 0;
  const playing = () => {
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...ctx('a'), decks, random: () => ((r += 7) % 11) / 11, newId: () => `cm${++n}` });
    if (!d.ok) throw new Error(d.error);
    return keepAll(reduceAll(s, d.events));
  };

  it('marks commanders, taxes each cast from the command zone by 2, and lets them return', () => {
    let s = playing();
    const cmdr = s.game!.players.a!.zones.command[0]!;
    expect(s.game!.cards[cmdr]).toMatchObject({ isCommander: true, zone: 'command', visibleTo: 'all' });
    expect(s.game!.cards[s.game!.players.a!.zones.hand[0]!]?.isCommander).toBe(false);
    s = run(s, 'a', { type: 'moveCard', instanceId: cmdr, to: 'stack' });
    expect(s.game!.players.a!.commanderTax).toBe(2);
    s = run(s, 'a', { type: 'moveCard', instanceId: cmdr, to: 'battlefield' }); // resolving: no extra tax
    expect(s.game!.players.a!.commanderTax).toBe(2);
    s = run(s, 'a', { type: 'moveCard', instanceId: cmdr, to: 'graveyard' });
    s = run(s, 'a', { type: 'moveCard', instanceId: cmdr, to: 'command' });
    expect(s.game!.cards[cmdr]).toMatchObject({ zone: 'command', isCommander: true, visibleTo: 'all' });
    s = run(s, 'a', { type: 'moveCards', instanceIds: [cmdr], to: 'battlefield' });
    expect(s.game!.players.a!.commanderTax).toBe(4);
    // A non-commander game never taxes.
    const plain = reduce(initialRoomState('p'), { type: 'roomCreated', ownerId: 'a', settings: { ...settings, commander: false } });
    expect(plain.settings.commander).toBe(false);
  });
});

describe('extra turns', () => {
  const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
  const deck = { main: [{ printingId: 'x', quantity: 8 }], sideboard: [], commander: [] };
  const decks = { a: deck, b: deck };

  it('gives the turn back to whoever queued one, most recent first, and can be cancelled', () => {
    let n = 0;
    let r = 0;
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      s = run(s, p, { type: 'join' });
      s = run(s, p, { type: 'selectDeck', deckId: 'd' });
      s = run(s, p, { type: 'setReady', ready: true });
    }
    const d = decide(s, { type: 'start' }, { ...ctx('a'), decks, random: () => ((r += 7) % 11) / 11, newId: () => `x${++n}` });
    if (!d.ok) throw new Error(d.error);
    s = keepAll(reduceAll(s, d.events));
    const first = s.game!.firstPlayerId;
    const other = first === 'a' ? 'b' : 'a';

    expect(decide(s, { type: 'cancelExtraTurn' }, ctx(first))).toEqual({ ok: false, error: 'No extra turn to cancel' });
    // The active player queues one for themselves and one for the opponent (a "target player" effect); the opponent's, being newer, comes first.
    s = run(s, first, { type: 'queueExtraTurn' });
    s = run(s, first, { type: 'queueExtraTurn', playerId: other });
    expect(s.game!.extraTurns).toEqual([first, other]);
    const turnsBefore = s.game!.turns![first]!;
    s = run(s, first, { type: 'endTurn' });
    expect(activePlayer(s.game!)).toBe(other);
    expect(s.game!.extraTurns).toEqual([first]);
    s = run(s, other, { type: 'endTurn' });
    expect(activePlayer(s.game!)).toBe(first);
    expect(s.game!.turns![first]).toBe(turnsBefore + 1); // an extra turn still counts as a turn
    expect(s.game!.extraTurns).toEqual([]);
    // With the queue empty the turn passes normally, also from the play button at the end step.
    s = run(s, first, { type: 'queueExtraTurn' });
    s = run(s, first, { type: 'cancelExtraTurn' });
    expect(s.game!.extraTurns).toEqual([]);
    s = run(s, first, { type: 'advanceStep', to: 'end' });
    s = run(s, first, { type: 'advanceStep' });
    expect(activePlayer(s.game!)).toBe(other);
  });
});
