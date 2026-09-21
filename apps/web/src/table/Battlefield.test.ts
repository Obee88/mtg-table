import type { CardInstance } from '@mtg/shared';
import { describe, expect, it } from 'vitest';
import { columnStep, defaultRow, dropSlot, freeColumns, gapFor, layoutRows, normalizePosition, tokenGroup } from './Battlefield';

const card = (id: string, row: number, col: number, attachedTo: string | null = null): CardInstance => ({
  id, printingId: 'p', ownerId: 'a', controllerId: 'a', zone: 'battlefield', tapped: false, transformed: false, flipped: false, faceDown: false,
  counters: {}, attachedTo, note: null, isToken: false, isCommander: false, customName: null, visibleTo: 'all', revealUntil: null, targetedBy: [], noUntap: null, position: { row, col },
});

describe('layoutRows', () => {
  it('keeps absolute columns (gaps allowed), piles equal slots, attached cards join their host pile', () => {
    const cards = [card('a', 0, 4), card('b', 0, 1), card('c', 0, 1), card('d', 1, 0), card('e', 1, 9, 'a')];
    const all = Object.fromEntries(cards.map((c) => [c.id, c]));
    const rows = layoutRows(cards, all);
    expect(rows[0]!.map((s) => [s.col, s.cards.map((c) => c.id)])).toEqual([[1, ['b', 'c']], [4, ['a', 'e']]]);
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

describe('normalizePosition', () => {
  it('accepts row/col, maps legacy x/y percentages, and never yields NaN', () => {
    expect(normalizePosition({ row: 1, col: 2.4 })).toEqual({ row: 1, col: 2 });
    expect(normalizePosition({ x: 62, y: 70 })).toEqual({ row: 1, col: 5 });
    expect(normalizePosition({ x: 4, y: 8 })).toEqual({ row: 0, col: 0 });
    expect(normalizePosition(null)).toEqual({ row: 0, col: 0 });
    expect(normalizePosition({ row: Number.NaN, col: 1 })).toEqual({ row: 0, col: 0 });
    const rows = layoutRows([{ ...card('a', 0, 0), position: { x: 30, y: 70 } as never }], {});
    expect(rows[1]!.map((s) => s.col)).toEqual([3]);
  });
});

describe('defaultRow / tokenGroup', () => {
  const tok = (id: string, extra: Partial<CardInstance> = {}): CardInstance => ({ ...card(id, 0, 0), isToken: true, printingId: 'soldier', ...extra });
  it('sends lands to the back row and everything else to the front', () => {
    expect(defaultRow({ typeLine: 'Basic Land — Forest' })).toBe(1);
    expect(defaultRow({ typeLine: 'Legendary Land' })).toBe(1);
    expect(defaultRow({ typeLine: 'Creature — Elf Druid' })).toBe(0);
    expect(defaultRow({ typeLine: 'Artifact — Equipment' })).toBe(0);
    expect(defaultRow({ typeLine: 'Enchantment — Aura' })).toBe(0); // "Landfall" style text is not in the type line
    expect(defaultRow(undefined)).toBe(0);
  });
  it('groups only identical tokens in a slot', () => {
    expect(tokenGroup({ col: 0, cards: [tok('a'), tok('b'), tok('c')] })?.length).toBe(3);
    expect(tokenGroup({ col: 0, cards: [tok('a'), tok('b', { tapped: true })] })).toBeNull();
    expect(tokenGroup({ col: 0, cards: [tok('a'), tok('b', { counters: { '+1/+1': 1 } })] })).toBeNull();
    expect(tokenGroup({ col: 0, cards: [tok('a'), card('x', 0, 0)] })).toBeNull();
    expect(tokenGroup({ col: 0, cards: [tok('a')] })).toBeNull();
    expect(tokenGroup({ col: 0, cards: [tok('a', { printingId: null, customName: 'Zombie 2/2' }), tok('b', { printingId: null, customName: 'Zombie 2/2' })] })?.length).toBe(2);
  });
});
