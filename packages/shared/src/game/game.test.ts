import { describe, expect, it } from 'vitest';
import { decide, type CommandContext } from './decide.js';
import type { GameEvent } from './events.js';
import { initialRoomState, reduce, reduceAll } from './reduce.js';
import type { RoomSettings } from './types.js';

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
