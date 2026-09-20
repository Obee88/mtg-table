import type { CardPrinting } from './cards.js';
import type { DeckImportResponse } from './decks.js';

export interface CubeCard {
  printingId: string;
  quantity: number;
}

export interface CubeVersionSummary {
  id: string;
  number: number;
  note: string | null;
  createdBy: string;
  createdByName: string;
  cardCount: number;
  createdAt: string;
}

export interface CubeSummary {
  id: string;
  name: string;
  latestVersion: number;
  cardCount: number;
  updatedAt: string;
}

/** A cube with one version's contents (the latest unless a version was requested). */
export interface CubeResponse {
  cube: { id: string; name: string; ownerId: string; createdAt: string; updatedAt: string };
  version: CubeVersionSummary & { cards: CubeCard[] };
  versions: CubeVersionSummary[];
  /** Every printing referenced by the shown version. */
  printings: CardPrinting[];
}

export interface CubeCreateInput {
  name: string;
  cards: CubeCard[];
  note?: string;
}

export interface CubeVersionInput {
  cards: CubeCard[];
  note?: string;
}

/** Result of importing a Cube Cobra cube: the same review shape as a pasted list, plus its name. */
export interface CubeCobraImportResponse extends DeckImportResponse {
  name: string;
  /** Cube Cobra short id that was fetched. */
  cubeCobraId: string;
  /** Cards matched by exact Scryfall id (the rest were resolved by name). */
  exactMatches: number;
}
