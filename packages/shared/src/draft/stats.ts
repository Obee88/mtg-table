import type { DraftPickSummary } from './types.js';

/** How one card fared across the drafts of a cube. */
export interface CardStat {
  printingId: string;
  /** Times the card was in a pack when a pick was made (one per pick, extra Librarian picks excluded). */
  seen: number;
  /** Times it was drafted (extra picks included). */
  taken: number;
  /** Times it sat in a pack and someone chose another card. */
  passed: number;
  /** taken / seen, fairer than raw pick position. Null when never seen. */
  pickRate: number | null;
  /** Mean pick-in-pack position over regular picks; null when never taken that way. */
  avgPick: number | null;
  /** Times the card was in an untouched pack (a first-pick opportunity). */
  firstPickChances: number;
  firstPicks: number;
  firstPickRate: number | null;
}

/** A pick as needed for statistics; `DraftPickSummary` fits. */
export type StatPick = Pick<DraftPickSummary, 'printingId' | 'pickInPack' | 'packContents' | 'double'>;

/**
 * Per-card statistics from a pick log. Every regular pick counts one "seen"
 * for each card in the pack at that moment; the chosen card counts as taken,
 * the rest as passed. Extra (Librarian) picks count as taken only, so they do
 * not distort positions or visibility.
 */
export function computeCardStats(picks: readonly StatPick[]): CardStat[] {
  const acc = new Map<string, { seen: number; taken: number; positions: number[]; firstChances: number; firstPicks: number }>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { seen: 0, taken: 0, positions: [], firstChances: 0, firstPicks: 0 }));
    return a;
  };
  for (const p of picks) {
    if (p.double) {
      get(p.printingId).taken++;
      continue;
    }
    for (const id of p.packContents) {
      if (!id) continue;
      const a = get(id);
      a.seen++;
      if (p.pickInPack === 1) a.firstChances++;
    }
    const chosen = get(p.printingId);
    chosen.taken++;
    chosen.positions.push(p.pickInPack);
    if (p.pickInPack === 1) chosen.firstPicks++;
  }
  const out: CardStat[] = [];
  for (const [printingId, a] of acc) {
    out.push({
      printingId,
      seen: a.seen,
      taken: a.taken,
      passed: Math.max(0, a.seen - a.positions.length),
      pickRate: a.seen > 0 ? a.positions.length / a.seen : null,
      avgPick: a.positions.length > 0 ? a.positions.reduce((s, n) => s + n, 0) / a.positions.length : null,
      firstPickChances: a.firstChances,
      firstPicks: a.firstPicks,
      firstPickRate: a.firstChances > 0 ? a.firstPicks / a.firstChances : null,
    });
  }
  return out.sort(byDesirability);
}

/** Most wanted first: highest pick rate, then earliest average pick; unseen cards last. */
export function byDesirability(a: CardStat, b: CardStat): number {
  return (b.pickRate ?? -1) - (a.pickRate ?? -1) || (a.avgPick ?? 99) - (b.avgPick ?? 99) || b.taken - a.taken || a.printingId.localeCompare(b.printingId);
}

/** Cards that keep going round: most often passed, ties broken by the lowest pick rate. */
export function mostPassed(stats: readonly CardStat[], limit = 10): CardStat[] {
  return [...stats].filter((s) => s.passed > 0).sort((a, b) => b.passed - a.passed || (a.pickRate ?? 0) - (b.pickRate ?? 0)).slice(0, limit);
}
