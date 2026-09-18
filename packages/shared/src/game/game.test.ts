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
    return reduceAll(s, d.events);
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

  it('mulligan returns the hand, shuffles and draws the requested number', () => {
    let s = playing();
    const oldHand = g(s).players.a!.zones.hand;
    s = runFull(s, 'a', { type: 'mulligan', count: 6 });
    const p = g(s).players.a!;
    expect(p.zones.hand).toHaveLength(6);
    expect(p.zones.library).toHaveLength(6);
    expect(p.zones.hand.some((id) => oldHand.includes(id))).toBe(false);
    expect(Object.keys(g(s).cards)).toHaveLength(12 + 9);
    expect(g(s).cards[p.zones.hand[0]!]).toMatchObject({ zone: 'hand', visibleTo: 'owner' });
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
    const [x, y] = s.game!.players.a!.zones.hand;
    s = run(s, 'a', { type: 'moveCard', instanceId: x!, to: 'battlefield', position: { x: 10, y: 10 } });
    s = run(s, 'a', { type: 'moveCard', instanceId: y!, to: 'battlefield', position: { x: 30, y: 10 } });
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
    s = runFull(s, 'a', { type: 'createToken', printingId: null, customName: 'Zombie 2/2', count: 3, position: { x: 50, y: 50 } });
    const tokens = s.game!.players.a!.zones.battlefield.slice(-3);
    expect(tokens).toHaveLength(3);
    expect(s.game!.cards[tokens[0]!]).toMatchObject({ isToken: true, printingId: null, customName: 'Zombie 2/2', visibleTo: 'all', zone: 'battlefield' });
    s = run(s, 'a', { type: 'moveCard', instanceId: tokens[0]!, to: 'graveyard' });
    expect(s.game!.cards[tokens[0]!]).toBeUndefined();
    expect(s.game!.players.a!.zones.graveyard).toEqual([]);
    expect(decide(s, { type: 'createToken', printingId: null, customName: null, count: 1, position: { x: 0, y: 0 } }, full('a')).ok).toBe(false);
    s = runFull(s, 'a', { type: 'createToken', printingId: 'bolt', customName: null, count: 1, position: { x: 1, y: 1 } });
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
    return reduceAll(s, d.events);
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
    return reduceAll(s, d.events);
  };

  it('moves several cards in one batch with per-card positions, then taps them together', () => {
    let s = playing();
    const [x, y, z] = s.game!.players.a!.zones.hand;
    s = run(s, 'a', { type: 'moveCards', instanceIds: [x!, y!, x!], to: 'battlefield', positions: { [x!]: { x: 1, y: 1 }, [y!]: { x: 2, y: 2 } } });
    expect(s.game!.players.a!.zones.battlefield).toEqual([x, y]);
    expect(s.game!.cards[y!]?.position).toEqual({ x: 2, y: 2 });
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
