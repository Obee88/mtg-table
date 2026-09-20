import { describe, expect, it } from 'vitest';
import { computeCardStats, mostPassed, type StatPick } from './stats.js';

const pick = (printingId: string, pickInPack: number, packContents: string[], double = false): StatPick => ({ printingId, pickInPack, packContents, double });

describe('computeCardStats', () => {
  it('counts seen, taken, passed, pick rate, average pick and first-pick rate', () => {
    // One pack of three cards drafted to the end: A first, then C over B, then B.
    const stats = computeCardStats([pick('A', 1, ['A', 'B', 'C']), pick('C', 2, ['B', 'C']), pick('B', 3, ['B'])]);
    const by = Object.fromEntries(stats.map((s) => [s.printingId, s]));
    expect(by.A).toMatchObject({ seen: 1, taken: 1, passed: 0, pickRate: 1, avgPick: 1, firstPickChances: 1, firstPicks: 1, firstPickRate: 1 });
    expect(by.B).toMatchObject({ seen: 3, taken: 1, passed: 2, pickRate: 1 / 3, avgPick: 3, firstPickChances: 1, firstPicks: 0, firstPickRate: 0 });
    expect(by.C).toMatchObject({ seen: 2, taken: 1, passed: 1, pickRate: 0.5, avgPick: 2 });
    expect(stats.map((s) => s.printingId)).toEqual(['A', 'C', 'B']); // most wanted first
  });

  it('treats extra Librarian picks as taken only and ignores blank pack entries', () => {
    const stats = computeCardStats([pick('A', 1, ['A', 'B', '']), pick('B', 2, ['B', ''], true)]);
    const by = Object.fromEntries(stats.map((s) => [s.printingId, s]));
    expect(by.B).toMatchObject({ seen: 1, taken: 1, passed: 1, pickRate: 0, avgPick: null, firstPickChances: 1, firstPicks: 0 });
    expect(stats.some((s) => s.printingId === '')).toBe(false);
  });

  it('lists the most passed cards', () => {
    const stats = computeCardStats([pick('A', 1, ['A', 'B', 'C']), pick('A', 1, ['A', 'B', 'C']), pick('C', 1, ['B', 'C'])]);
    expect(mostPassed(stats).map((s) => [s.printingId, s.passed])).toEqual([['B', 3], ['C', 2]]);
    expect(mostPassed(stats, 1)).toHaveLength(1);
    expect(computeCardStats([])).toEqual([]);
  });
});
