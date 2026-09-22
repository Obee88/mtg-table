import { describe, expect, it } from 'vitest';
import { attentionFor } from './attention.js';
import { decide, type CommandContext } from './decide.js';
import { initialRoomState, reduce, reduceAll } from './reduce.js';
import type { RoomSettings } from './types.js';

const settings: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };
const ctx = (actorId: string): CommandContext => ({ actorId, actorDisplayName: actorId, now: new Date('2026-01-01') });
const run = (state: ReturnType<typeof initialRoomState>, actor: string, command: Parameters<typeof decide>[1], extra: Partial<CommandContext> = {}) => {
  const d = decide(state, command, { ...ctx(actor), ...extra });
  if (!d.ok) throw new Error(d.error);
  return reduceAll(state, d.events);
};
const deck = { main: [{ printingId: 'x', quantity: 8 }], sideboard: [], commander: [] };

describe('attentionFor', () => {
  it('follows a constructed game from lobby to the table', () => {
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    s = run(s, 'a', { type: 'join' });
    expect(attentionFor(s, 'a')).toBe('choose a deck');
    expect(attentionFor(s, 'b')).toBeNull(); // not seated
    s = run(s, 'a', { type: 'selectDeck', deckId: 'd' });
    expect(attentionFor(s, 'a')).toBe('ready up');
    s = run(s, 'a', { type: 'setReady', ready: true });
    expect(attentionFor(s, 'a')).toBeNull(); // waiting for the other seat
    s = run(s, 'b', { type: 'join' });
    s = run(s, 'b', { type: 'selectDeck', deckId: 'd' });
    s = run(s, 'b', { type: 'setReady', ready: true });
    expect(attentionFor(s, 'a')).toBe('start the game');
    expect(attentionFor(s, 'b')).toBeNull();

    let n = 0;
    let r = 0;
    s = run(s, 'a', { type: 'start' }, { decks: { a: deck, b: deck }, random: () => ((r += 7) % 11) / 11, newId: () => `c${++n}` });
    expect(attentionFor(s, 'a')).toBe('sideboard');
    s = run(s, 'a', { type: 'finishSideboarding' });
    expect(attentionFor(s, 'a')).toBeNull();
    s = run(s, 'b', { type: 'finishSideboarding' });
    expect(attentionFor(s, 'a')).toBe('keep or mulligan');
    s = run(s, 'a', { type: 'keepHand', bottom: [] });
    s = run(s, 'b', { type: 'keepHand', bottom: [] });
    const first = s.game!.firstPlayerId;
    const other = first === 'a' ? 'b' : 'a';
    expect(attentionFor(s, first)).toBe('your turn');
    expect(attentionFor(s, other)).toBeNull();
    s = run(s, first, { type: 'proposeResult', winners: [first], then: 'end' }, { decks: { a: deck, b: deck } });
    expect(attentionFor(s, other)).toBe('confirm the result');
    expect(attentionFor(s, first)).toBeNull();
  });
});
