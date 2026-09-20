import { describe, expect, it } from 'vitest';
import { packLayout } from './layout';

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
