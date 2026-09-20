/** Card size (5:7) so that `n` cards fit a `w`×`h` area in a grid with `gap` between cards; picks the tightest packing. */
export function packLayout(n: number, w: number, h: number, gap = 8): { cardW: number; cardH: number; cols: number } {
  if (n <= 0 || w <= 0 || h <= 0) return { cardW: 0, cardH: 0, cols: 1 };
  let best = { cardW: 0, cardH: 0, cols: 1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const byWidth = (w - gap * (cols - 1)) / cols;
    const byHeight = ((h - gap * (rows - 1)) / rows) * (5 / 7);
    const cardW = Math.floor(Math.min(byWidth, byHeight));
    if (cardW > best.cardW) best = { cardW, cardH: Math.floor(cardW * (7 / 5)), cols };
  }
  return best;
}
