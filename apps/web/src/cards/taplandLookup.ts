import type { TaplandFace } from '@mtg/shared';

/**
 * Tapland faces of printings seen so far, fed by the printing cache and read
 * by command prediction. Kept apart from the cache so code that runs outside
 * the browser (the connection and its tests) needs no window.
 */
const known = new Map<string, TaplandFace | null>();

export function rememberTapland(printingId: string, face: TaplandFace | null | undefined): void {
  known.set(printingId, face ?? null);
}

export const taplandOf = (printingId: string): TaplandFace | null => known.get(printingId) ?? null;
