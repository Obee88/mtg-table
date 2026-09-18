import type { CardPrinting } from './cards.js';
import type { DecklistError, DecklistSection } from './decklist.js';

export interface DeckCard {
  printingId: string;
  quantity: number;
}

export interface DeckContents {
  main: DeckCard[];
  sideboard: DeckCard[];
  commander: DeckCard[];
}

export interface Deck {
  id: string;
  name: string;
  contents: DeckContents;
  createdAt: string;
  updatedAt: string;
}

export interface DeckSummary {
  id: string;
  name: string;
  mainCount: number;
  sideboardCount: number;
  commanderCount: number;
  updatedAt: string;
}

/** Full deck plus every printing it references, for display. */
export interface DeckResponse {
  deck: Deck;
  cards: CardPrinting[];
}

export interface DeckInput {
  name: string;
  contents: DeckContents;
}

// ---- import (resolve a decklist text against card data) ----

export interface DeckImportRequest {
  text: string;
}

export interface ResolvedCard {
  line: number;
  quantity: number;
  /** What the decklist asked for. */
  requested: { name: string; set?: string; collectorNumber?: string };
  printing: CardPrinting;
}

export interface UnknownCard {
  line: number;
  quantity: number;
  name: string;
  set?: string;
  collectorNumber?: string;
}

export interface DeckImportWarning {
  line: number;
  message: string;
}

export interface DeckImportResponse {
  resolved: Record<Exclude<DecklistSection, 'maybeboard'>, ResolvedCard[]>;
  unknown: UnknownCard[];
  /** Printing hints that could not be honoured (a default printing was used instead). */
  warnings: DeckImportWarning[];
  /** Lines the parser could not read at all. */
  errors: DecklistError[];
}
