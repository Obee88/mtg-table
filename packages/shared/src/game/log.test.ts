import { describe, expect, it } from 'vitest';
import type { RoomEvent } from './events.js';
import { describeEvent, logContextFor } from './log.js';
import { initialRoomState, reduce } from './reduce.js';

const state = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false } });
const withPlayers = { ...state, players: { a: { id: 'a', displayName: 'Alice', seat: 0, team: 0, deckId: null, ready: false }, b: { id: 'b', displayName: 'Bob', seat: 1, team: 1, deckId: null, ready: false } } };
const ctx = logContextFor(withPlayers, () => undefined);
const namedCtx = { ...ctx, cardName: (id: string) => (id === 'x' ? 'Lightning Bolt' : null) };
const ev = (event: RoomEvent['event'], actorId = 'a'): RoomEvent => ({ seq: 1, actorId, at: '', event });

describe('describeEvent', () => {
  it('names visible cards and hides hidden ones', () => {
    expect(describeEvent(ev({ type: 'cardMoved', instanceId: 'x', from: 'hand', to: 'battlefield', position: null, libraryPosition: null }), namedCtx)).toBe('Alice moved Lightning Bolt from hand to the battlefield');
    expect(describeEvent(ev({ type: 'cardMoved', instanceId: 'hidden', from: 'library', to: 'hand', position: null, libraryPosition: null }, 'b'), namedCtx)).toBe('Bob drew a card');
    expect(describeEvent(ev({ type: 'cardMoved', instanceId: 'x', from: 'battlefield', to: 'battlefield', position: { row: 0, col: 1 }, libraryPosition: null }), namedCtx)).toBeNull();
  });

  it('describes player state and randomness', () => {
    expect(describeEvent(ev({ type: 'lifeChanged', target: { type: 'player', playerId: 'b' }, delta: -3, value: 17 }), ctx)).toBe('Bob lost 3 life (17)');
    expect(describeEvent(ev({ type: 'lifeChanged', target: { type: 'team', team: 1 }, delta: 2, value: 32 }), ctx)).toBe('team 2 gained 2 life (32)');
    expect(describeEvent(ev({ type: 'diceRolled', playerId: 'a', sides: 6, results: [3, 5] }), ctx)).toBe('Alice rolled 2d6: 3, 5 (total 8)');
    expect(describeEvent(ev({ type: 'diceRolled', playerId: 'a', sides: 20, results: [17] }), ctx)).toBe('Alice rolled a d20: 17');
    expect(describeEvent(ev({ type: 'coinFlipped', playerId: 'a', results: ['heads'] }), ctx)).toBe('Alice flipped a coin: heads');
    expect(describeEvent(ev({ type: 'counterChanged', target: { type: 'card', instanceId: 'x' }, kind: '+1/+1', delta: 2, value: 2 }), namedCtx)).toBe('Alice added 2 +1/+1 counters to Lightning Bolt (now 2)');
  });

  it('covers every event type without throwing', () => {
    const samples: RoomEvent['event'][] = [
      { type: 'settingsChanged', settings: withPlayers.settings },
      { type: 'playerJoined', playerId: 'c', displayName: 'Cy', seat: 2, team: 2 },
      { type: 'playerLeft', playerId: 'b' },
      { type: 'deckSelected', playerId: 'a', deckId: 'd' },
      { type: 'readyChanged', playerId: 'a', ready: true },
      { type: 'roomClosed' },
      { type: 'gameStarted', firstPlayerId: 'a', openingRoll: { a: 12, b: 3 }, players: {} },
      { type: 'cardTapped', instanceId: 'x', tapped: true },
      { type: 'cardTransformed', instanceId: 'x', transformed: true },
      { type: 'cardFlipped', instanceId: 'x', flipped: true },
      { type: 'cardFaceDownChanged', instanceId: 'x', faceDown: true },
      { type: 'libraryShuffled', playerId: 'a', cards: [] },
      { type: 'cardAttached', instanceId: 'x', to: null },
      { type: 'noteChanged', instanceId: 'x', note: 'hi' },
      { type: 'tokenCreated', controllerId: 'a', cards: [{ id: 't', printingId: null, customName: 'Zombie' }], position: { row: 0, col: 0 } },
      { type: 'poisonChanged', playerId: 'a', delta: 1, value: 1 },
      { type: 'commanderTaxChanged', playerId: 'a', delta: 2, value: 2 },
      { type: 'commanderDamageChanged', playerId: 'a', fromPlayerId: 'b', delta: 4, value: 4 },
    ];
    for (const s of samples) expect(typeof describeEvent(ev(s), namedCtx)).toBe('string');
  });
});
