import type { CardPrinting } from '@mtg/shared';

/** Oldest first: the first English paper non-promo printing is the default choice. */
export function orderPrintings(printings: CardPrinting[]): CardPrinting[] {
  return [...printings].sort((a, b) => a.releasedAt.localeCompare(b.releasedAt) || a.setCode.localeCompare(b.setCode) || a.collectorNumber.localeCompare(b.collectorNumber, undefined, { numeric: true }));
}

export function defaultPrinting(printings: CardPrinting[]): CardPrinting | undefined {
  const ordered = orderPrintings(printings);
  return ordered.find((p) => p.lang === 'en' && !p.isDigital && !p.isPromo) ?? ordered[0];
}
