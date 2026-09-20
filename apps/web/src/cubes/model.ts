import type { CardPrinting, CubeCard, CubeResponse, DeckImportResponse } from '@mtg/shared';

export interface EditableCubeCard {
  printing: CardPrinting;
  quantity: number;
}

/** Merges by printing so a list never holds a printing twice. */
export function mergeCubeCards(cards: EditableCubeCard[]): EditableCubeCard[] {
  const out: EditableCubeCard[] = [];
  for (const c of cards) {
    const existing = out.find((o) => o.printing.id === c.printing.id);
    if (existing) existing.quantity += c.quantity;
    else out.push({ printing: c.printing, quantity: c.quantity });
  }
  return out;
}

/** A cube list is flat: every section of an import counts. */
export function fromImport(res: DeckImportResponse): EditableCubeCard[] {
  return mergeCubeCards([...res.resolved.main, ...res.resolved.sideboard, ...res.resolved.commander].map((r) => ({ printing: r.printing, quantity: r.quantity })));
}

export function fromCubeResponse(res: CubeResponse): EditableCubeCard[] {
  const byId = new Map(res.printings.map((p) => [p.id, p]));
  return res.version.cards.flatMap((c) => {
    const printing = byId.get(c.printingId);
    return printing ? [{ printing, quantity: c.quantity }] : [];
  });
}

export function toCubeCards(cards: EditableCubeCard[]): CubeCard[] {
  return mergeCubeCards(cards).map((c) => ({ printingId: c.printing.id, quantity: c.quantity }));
}

export const countCubeCards = (cards: readonly EditableCubeCard[]) => cards.reduce((n, c) => n + c.quantity, 0);

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'];

/** Cube-style sort: colour (W U B R G, multi, colourless, lands), then name. */
export function sortForCube(cards: EditableCubeCard[]): EditableCubeCard[] {
  const group = (p: CardPrinting) => {
    if (p.typeLine?.includes('Land')) return 7;
    const c = p.colors ?? [];
    if (c.length === 0) return 6;
    if (c.length > 1) return 5;
    return COLOR_ORDER.indexOf(c[0]!);
  };
  return [...cards].sort((a, b) => group(a.printing) - group(b.printing) || (a.printing.cmc ?? 0) - (b.printing.cmc ?? 0) || a.printing.name.localeCompare(b.printing.name));
}

/** Arena-style text export. */
export function cubeToText(cards: EditableCubeCard[]): string {
  return sortForCube(cards).map((c) => `${c.quantity} ${c.printing.name} (${c.printing.setCode.toUpperCase()}) ${c.printing.collectorNumber}`).join('\n') + '\n';
}
