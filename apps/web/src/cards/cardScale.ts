import { useCallback, useEffect, useState } from 'react';

const EVENT = 'mtg-table:card-scale';
const storageKey = (key: string) => `${EVENT}:${key}`;
export const CARD_SCALE_MIN = 0.5;
export const CARD_SCALE_MAX = 2;

function read(key: string): number {
  const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey(key));
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, n)) : 1;
}

/**
 * A card image size multiplier remembered per screen (`key`), shared by every
 * component using the same key: setting it anywhere updates them all.
 */
export function useCardScale(key: string): [number, (scale: number) => void] {
  const [scale, setScale] = useState(() => read(key));
  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === key && setScale(read(key));
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [key]);
  const set = useCallback((n: number) => {
    localStorage.setItem(storageKey(key), String(Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, n))));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
  }, [key]);
  return [scale, set];
}
