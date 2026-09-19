import { createContext, useContext, type ReactNode } from 'react';

export interface CardSize {
  w: number;
  h: number;
}

/** Fallback when rendered outside a measured table (dialogs, previews). */
export const DEFAULT_CARD_SIZE: CardSize = { w: 80, h: 112 };

const CardSizeContext = createContext<CardSize>(DEFAULT_CARD_SIZE);

export function CardSizeProvider({ size, children }: { size: CardSize; children: ReactNode }) {
  return <CardSizeContext.Provider value={size}>{children}</CardSizeContext.Provider>;
}

export function useCardSize(): CardSize {
  return useContext(CardSizeContext);
}

/**
 * Card size that fills a player area: tall enough that the battlefield keeps
 * room for ~2 rows above the hand row, and narrow enough that piles plus a
 * full opening hand fit the width without overlap.
 */
export function cardSizeFor(areaWidth: number, areaHeight: number): CardSize {
  const HEADER_PX = 48; // strip + tray padding
  const h1 = (areaHeight - HEADER_PX) / 2.9;
  const w1 = h1 * (5 / 7);
  const w2 = (areaWidth - 12 * 8) / 12; // 4 piles + 7 cards + a spare, with gaps
  const w = Math.max(56, Math.min(w1, w2, 220));
  return { w: Math.round(w), h: Math.round(w * (7 / 5)) };
}
