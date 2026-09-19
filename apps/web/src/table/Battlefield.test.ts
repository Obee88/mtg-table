import type { CardInstance } from '@mtg/shared';
import { describe, expect, it } from 'vitest';
import { dropSlot, layoutRows } from './Battlefield';

const card = (id: string, row: number, col: number, attachedTo: string | null = null): CardInstance => ({
  id, printingId: 'p', ownerId: 'a', controllerId: 'a', zone: 'battlefield', tapped: false, transformed: false, flipped: false, faceDown: false,
  counters: {}, attachedTo, note: null, isToken: false, customName: null, visibleTo: 'all', revealUntil: null, position: { row, col },
});

describe('layoutRows', () => {
  it('groups by row, sorts by col, piles equal slots, tucks attachments with their host', () => {
    const cards = [card('a', 0, 2), card('b', 0, 1), card('c', 0, 1), card('d', 1, 0), card('e', 1, 9, 'a')];
    const all = Object.fromEntries(cards.map((c) => [c.id, c]));
    const rows = layoutRows(cards, all);
    expect(rows[0]!.map((s) => [s.col, s.cards.map((c) => c.id), s.attachments.map((c) => c.id)])).toEqual([[1, ['b', 'c'], []], [2, ['a'], ['e']]]);
    expect(rows[1]!.map((s) => s.cards.map((c) => c.id))).toEqual([['d']]);
  });
});

describe('dropSlot', () => {
  const slots = layoutRows([card('a', 0, 0), card('b', 0, 1), card('c', 0, 5)], {})[0]!;
  it('joins a pile in the middle of a card, inserts beside at the edges, appends past the end', () => {
    expect(dropSlot(slots, 50, 100, 8, 0)).toEqual({ col: 0, pile: true });
    expect(dropSlot(slots, 5, 100, 8, 0)).toEqual({ col: -1, pile: false });
    expect(dropSlot(slots, 95, 100, 8, 0)).toEqual({ col: 0.5, pile: false });
    expect(dropSlot(slots, 108 + 95, 100, 8, 0)).toEqual({ col: 3, pile: false });
    expect(dropSlot(slots, 1000, 100, 8, 0)).toEqual({ col: 6, pile: false });
    expect(dropSlot([], 30, 100, 8, 0)).toEqual({ col: 0, pile: false });
  });
});
