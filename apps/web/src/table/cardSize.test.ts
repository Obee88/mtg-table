import { describe, expect, it } from 'vitest';
import { cardSizeFor } from './cardSize';

describe('cardSizeFor', () => {
  it('grows with the area and keeps the 5:7 ratio', () => {
    const small = cardSizeFor(900, 400);
    const big = cardSizeFor(1800, 900);
    expect(big.w).toBeGreaterThan(small.w);
    expect(Math.abs(big.h / big.w - 1.4)).toBeLessThan(0.03);
  });
  it('is capped by width when the area is wide-but-short and by height otherwise', () => {
    expect(cardSizeFor(1200, 2000).w).toBeLessThanOrEqual((1200 - 96) / 12 + 1);
    expect(cardSizeFor(4000, 500).h).toBeLessThanOrEqual((500 - 48) / 3.35 + 1);
  });
  it('never goes below the minimum or above the maximum', () => {
    expect(cardSizeFor(100, 100).w).toBe(56);
    expect(cardSizeFor(9000, 9000).w).toBe(220);
  });
});
