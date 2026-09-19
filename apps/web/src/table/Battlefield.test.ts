import type { CardInstance } from '@mtg/shared';
import { describe, expect, it } from 'vitest';
import { columnStep, dropSlot, freeColumns, gapFor, layoutRows } from './Battlefield';

const card = (id: string, row: number, col: number, attachedTo: string | null = null): CardInstance => ({
  id, printingId: 'p', ownerId: 'a', controllerId: 'a', zone: 'battlefield', tapped: false, transformed: false, flipped: false, faceDown: false,
  counters: {}, attachedTo, note: null, isToken: false, customName: null, visibleTo: 'all', revealUntil: null, position: { row, col },
});

describe('layoutRows', () => {
  it('keeps absolute columns (gaps allowed), piles equal slots, tucks attachments with their host', () => {
    const cards = [card('a', 0, 4), card('b', 0, 1), card('c', 0, 1), card('d', 1, 0), card('e', 1, 9, 'a')];
    const all = Object.fromEntries(cards.map((c) => [c.id, c]));
    const rows = layoutRows(cards, all);
    expect(rows[0]!.map((s) => [s.col, s.cards.map((c) => c.id), s.attachments.map((c) => c.id)])).toEqual([[1, ['b', 'c'], []], [4, ['a'], ['e']]]);
    expect(rows[1]!.map((s) => s.cards.map((c) => c.id))).toEqual([['d']]);
  });
});

describe('columnStep / dropSlot / freeColumns', () => {
  const slots = layoutRows([card('a', 0, 0), card('b', 0, 1), card('c', 0, 5)], {})[0]!;
  it('uses the full pitch when it fits and compresses otherwise', () => {
    expect(columnStep(slots, 2000, 100)).toBe(100 + gapFor(100));
    expect(columnStep(slots, 400, 100)).toBeCloseTo((400 - 100) / 5);
  });
  it('drops land on the column under the pointer, piling when occupied', () => {
    const step = 100 + gapFor(100);
    expect(dropSlot(slots, 50, step)).toEqual({ col: 0, pile: true });
    expect(dropSlot(slots, 2 * step + 10, step)).toEqual({ col: 2, pile: false });
    expect(dropSlot(slots, 5 * step + 10, step)).toEqual({ col: 5, pile: true });
    expect(dropSlot(slots, 9 * step, step)).toEqual({ col: 9, pile: false });
  });
  it('finds the next free columns for a multi-drop', () => {
    expect(freeColumns(slots, 0, 3)).toEqual([2, 3, 4]);
    expect(freeColumns(slots, 4, 2)).toEqual([4, 6]);
  });
});
