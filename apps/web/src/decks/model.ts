import type { CardPrinting, DeckContents, DeckImportResponse, DeckInput, DeckResponse } from '@mtg/shared';

export type Section = keyof DeckContents;
export const SECTIONS: readonly Section[] = ['commander', 'main', 'sideboard'];
export const SECTION_LABEL: Record<Section, string> = { main: 'Main deck', sideboard: 'Sideboard', commander: 'Commander' };

export interface EditableCard {
  printing: CardPrinting;
  quantity: number;
}

export interface EditableDeck {
  name: string;
  sections: Record<Section, EditableCard[]>;
}

export const emptyDeck = (name = ''): EditableDeck => ({ name, sections: { main: [], sideboard: [], commander: [] } });

/** Merges cards with the same printing so a section never lists a printing twice. */
export function mergeCards(cards: EditableCard[]): EditableCard[] {
  const out: EditableCard[] = [];
  for (const c of cards) {
    const existing = out.find((o) => o.printing.id === c.printing.id);
    if (existing) existing.quantity += c.quantity;
    else out.push({ printing: c.printing, quantity: c.quantity });
  }
  return out;
}

export function fromImport(name: string, res: DeckImportResponse): EditableDeck {
  const deck = emptyDeck(name);
  for (const s of SECTIONS) deck.sections[s] = mergeCards(res.resolved[s].map((r) => ({ printing: r.printing, quantity: r.quantity })));
  return deck;
}

export function fromDeckResponse(res: DeckResponse): EditableDeck {
  const byId = new Map(res.cards.map((c) => [c.id, c]));
  const deck = emptyDeck(res.deck.name);
  for (const s of SECTIONS) {
    deck.sections[s] = res.deck.contents[s].flatMap((c) => {
      const printing = byId.get(c.printingId);
      return printing ? [{ printing, quantity: c.quantity }] : [];
    });
  }
  return deck;
}

export function toDeckInput(deck: EditableDeck): DeckInput {
  const contents: DeckContents = { main: [], sideboard: [], commander: [] };
  for (const s of SECTIONS) contents[s] = mergeCards(deck.sections[s]).map((c) => ({ printingId: c.printing.id, quantity: c.quantity }));
  return { name: deck.name.trim(), contents };
}

export const countSection = (cards: readonly EditableCard[]): number => cards.reduce((n, c) => n + c.quantity, 0);

/** Arena/Moxfield style text: `4 Lightning Bolt (M11) 149`. */
export function toText(deck: EditableDeck): string {
  const line = (c: EditableCard) => `${c.quantity} ${c.printing.name} (${c.printing.setCode.toUpperCase()}) ${c.printing.collectorNumber}`;
  const blocks: string[] = [];
  if (deck.sections.commander.length) blocks.push(['Commander', ...deck.sections.commander.map(line)].join('\n'));
  blocks.push(['Deck', ...deck.sections.main.map(line)].join('\n'));
  if (deck.sections.sideboard.length) blocks.push(['Sideboard', ...deck.sections.sideboard.map(line)].join('\n'));
  return blocks.join('\n\n') + '\n';
}

// ---- immutable edits ----

export function setQuantity(deck: EditableDeck, section: Section, printingId: string, quantity: number): EditableDeck {
  const cards = deck.sections[section]
    .map((c) => (c.printing.id === printingId ? { ...c, quantity } : c))
    .filter((c) => c.quantity > 0);
  return { ...deck, sections: { ...deck.sections, [section]: cards } };
}

export function replacePrinting(deck: EditableDeck, section: Section, printingId: string, printing: CardPrinting): EditableDeck {
  const cards = mergeCards(deck.sections[section].map((c) => (c.printing.id === printingId ? { ...c, printing } : c)));
  return { ...deck, sections: { ...deck.sections, [section]: cards } };
}

export function moveCard(deck: EditableDeck, from: Section, to: Section, printingId: string): EditableDeck {
  const card = deck.sections[from].find((c) => c.printing.id === printingId);
  if (!card || from === to) return deck;
  return {
    ...deck,
    sections: {
      ...deck.sections,
      [from]: deck.sections[from].filter((c) => c.printing.id !== printingId),
      [to]: mergeCards([...deck.sections[to], card]),
    },
  };
}
