/** Splits a card's counters into what the badges show. */
export interface CounterView {
  /** Net power/toughness modification from ±X/±Y counters, or null when none. */
  pt: { power: number; toughness: number } | null;
  loyalty: number | null;
  /** Everything else, e.g. charge, -1/-1 that could not be parsed, custom kinds. */
  other: [kind: string, value: number][];
}

const PT_RE = /^([+-])(\d+)\/([+-])(\d+)$/;

export function counterView(counters: Record<string, number>): CounterView {
  let power = 0;
  let toughness = 0;
  let hasPT = false;
  let loyalty: number | null = null;
  const other: [string, number][] = [];
  for (const [kind, value] of Object.entries(counters)) {
    if (value === 0) continue;
    const m = PT_RE.exec(kind.replace(/\s+/g, ''));
    if (m) {
      hasPT = true;
      power += (m[1] === '-' ? -1 : 1) * Number(m[2]) * value;
      toughness += (m[3] === '-' ? -1 : 1) * Number(m[4]) * value;
    } else if (kind.toLowerCase() === 'loyalty') {
      loyalty = value;
    } else {
      other.push([kind, value]);
    }
  }
  return { pt: hasPT ? { power, toughness } : null, loyalty, other };
}

/** The one non-specific card counter kind; shown as a bare number. */
export const GENERAL_COUNTER = 'counter';

export const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
