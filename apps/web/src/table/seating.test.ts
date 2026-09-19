import type { RoomState } from '@mtg/shared';
import { describe, expect, it } from 'vitest';
import { playerAtSeat, quadrants } from './seating';

const room = (mode: '2v2' | 'ffa'): RoomState => ({
  id: 'r', ownerId: 'a', settings: { playerCount: 4, mode, startingLife: 20, commander: false }, phase: 'playing', game: null, seq: 0,
  players: {
    a: { id: 'a', displayName: 'A', seat: 0, team: 0, deckId: null, ready: true },
    b: { id: 'b', displayName: 'B', seat: 1, team: 1, deckId: null, ready: true },
    c: { id: 'c', displayName: 'C', seat: 2, team: 0, deckId: null, ready: true },
    d: { id: 'd', displayName: 'D', seat: 3, team: 1, deckId: null, ready: true },
  },
});

describe('quadrants', () => {
  it('puts the viewer bottom-left and continues clockwise', () => {
    const q = quadrants(room('ffa'), 'a');
    expect([q.bottomLeft?.id, q.topLeft?.id, q.topRight?.id, q.bottomRight?.id]).toEqual(['a', 'b', 'c', 'd']);
  });
  it('rotates for another viewer so everyone sees themselves bottom-left', () => {
    const q = quadrants(room('ffa'), 'c');
    expect([q.bottomLeft?.id, q.topLeft?.id, q.topRight?.id, q.bottomRight?.id]).toEqual(['c', 'd', 'a', 'b']);
  });
  it('places the 2v2 teammate across (top-right)', () => {
    const q = quadrants(room('2v2'), 'b');
    expect(q.topRight?.id).toBe('d');
    expect(q.topRight?.team).toBe(q.bottomLeft?.team);
  });
  it('tolerates empty seats', () => {
    const r = room('ffa');
    delete r.players.d;
    expect(quadrants(r, 'a').bottomRight).toBeNull();
    expect(playerAtSeat(r, 4)).toBeNull();
    expect(playerAtSeat(r, 2)?.id).toBe('b');
  });
});
