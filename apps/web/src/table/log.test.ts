import type { RoomEvent } from '@mtg/shared';
import { describe, expect, it } from 'vitest';
import { mergeEvents, touchedPlayers } from './log';

const ev = (seq: number, event: RoomEvent['event'] = { type: 'roomClosed' }, actorId = 'a'): RoomEvent => ({ seq, actorId, at: '', event });

describe('mergeEvents', () => {
  it('dedupes by seq, prefers live copies, sorts ascending', () => {
    const history = [ev(1), ev(2), ev(3)];
    const live = [ev(3, { type: 'readyChanged', playerId: 'a', ready: true }), ev(4)];
    const merged = mergeEvents(history, live);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(merged[2]?.event.type).toBe('readyChanged');
  });
});

describe('touchedPlayers', () => {
  const owner = (id: string) => (id === 'x' ? 'b' : undefined);
  it('includes the actor and the owner of the affected card or player', () => {
    expect(touchedPlayers(ev(1, { type: 'cardMoved', instanceId: 'x', from: 'hand', to: 'graveyard', position: null, libraryPosition: null }), owner)).toEqual(['a', 'b']);
    expect(touchedPlayers(ev(1, { type: 'lifeChanged', target: { type: 'player', playerId: 'c' }, delta: 1, value: 21 }), owner)).toEqual(['a', 'c']);
    expect(touchedPlayers(ev(1, { type: 'diceRolled', playerId: 'a', sides: 6, results: [1] }), owner)).toEqual(['a']);
    expect(touchedPlayers(ev(1, { type: 'roomClosed' }, null as unknown as string), owner)).toEqual([]);
  });
});
