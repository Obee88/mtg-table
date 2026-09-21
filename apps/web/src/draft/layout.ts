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

/**
 * The pack grid at a user-chosen scale: the best-fit card width times the
 * scale, re-flowed into as many columns as still fit the width. Larger than
 * the fit means the grid scrolls; smaller shows the pack in fewer rows.
 */
export function scaledPackLayout(fit: { cardW: number }, scale: number, w: number, gap = 8): { cardW: number; cardH: number; cols: number } {
  if (fit.cardW <= 0 || w <= 0) return { cardW: 0, cardH: 0, cols: 1 };
  const cardW = Math.max(40, Math.min(Math.round(fit.cardW * scale), Math.floor(w)));
  const cols = Math.max(1, Math.floor((w + gap) / (cardW + gap)));
  return { cardW, cardH: Math.floor(cardW * (7 / 5)), cols };
}
