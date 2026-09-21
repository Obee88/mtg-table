import { describe, expect, it } from 'vitest';
import { packLayout, scaledPackLayout } from './layout';

describe('packLayout', () => {
  it('fills the area with the largest cards that fit', () => {
    const one = packLayout(1, 1000, 500);
    expect(one).toEqual({ cardW: 357, cardH: 499, cols: 1 });
    const fifteen = packLayout(15, 1200, 600);
    expect(fifteen.cols * Math.ceil(15 / fifteen.cols)).toBeGreaterThanOrEqual(15);
    expect(fifteen.cardW * fifteen.cols + 8 * (fifteen.cols - 1)).toBeLessThanOrEqual(1200);
    const rows = Math.ceil(15 / fifteen.cols);
    expect(fifteen.cardH * rows + 8 * (rows - 1)).toBeLessThanOrEqual(600);
    expect(fifteen.cardW).toBeGreaterThan(100);
  });

  it('handles empty input', () => {
    expect(packLayout(0, 100, 100)).toEqual({ cardW: 0, cardH: 0, cols: 1 });
  });
});

describe('scaledPackLayout', () => {
  it('scales the best fit and re-flows the columns to the width', () => {
    const fit = { cardW: 200 };
    expect(scaledPackLayout(fit, 1, 1200)).toEqual({ cardW: 200, cardH: 280, cols: 5 });
    // Half size: twice as many columns fit.
    expect(scaledPackLayout(fit, 0.5, 1200)).toEqual({ cardW: 100, cardH: 140, cols: 11 });
    // Bigger than the fit: fewer columns, the grid scrolls.
    expect(scaledPackLayout(fit, 2, 1200)).toEqual({ cardW: 400, cardH: 560, cols: 2 });
    // Never wider than the area, never below the floor, always one column.
    expect(scaledPackLayout({ cardW: 900 }, 2, 500)).toEqual({ cardW: 500, cardH: 700, cols: 1 });
    expect(scaledPackLayout({ cardW: 50 }, 0.5, 500).cardW).toBe(40);
    expect(scaledPackLayout({ cardW: 0 }, 1, 500)).toEqual({ cardW: 0, cardH: 0, cols: 1 });
  });
});
