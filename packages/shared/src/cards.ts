import type { TaplandFace } from './taplands.js';
export interface CardIngestStatus {
  cardCount: number;
  latest: {
    id: string;
    status: 'running' | 'success' | 'failed';
    bulkUpdatedAt: string | null;
    processed: number;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
  } | null;
}

/** Image URLs as provided by Scryfall (small, normal, large, png, art_crop, border_crop). */
export type ImageUris = Record<string, string>;

export interface CardFace {
  name: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  imageUris: ImageUris | null;
}

/** One printing of a card, as stored from Scryfall. */
export interface CardPrinting {
  id: string;
  oracleId: string | null;
  name: string;
  lang: string;
  layout: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  releasedAt: string;
  rarity: string;
  typeLine: string | null;
  manaCost: string | null;
  cmc: number | null;
  colors: string[] | null;
  colorIdentity: string[];
  oracleText: string | null;
  imageUris: ImageUris | null;
  faces: CardFace[];
  isToken: boolean;
  isDigital: boolean;
  isPromo: boolean;
  /** Marked by the group as a land that always enters tapped (which face). */
  entersTapped?: TaplandFace | null;
}

export interface CardSearchResponse {
  /** One representative printing per distinct card (oracle id). */
  results: CardPrinting[];
}

export interface CardPrintingsResponse {
  printings: CardPrinting[];
}

/** A token a player has made before, offered again in the token dialog. */
export interface TokenSuggestion {
  printing: CardPrinting | null;
  customName: string | null;
  uses: number;
  /** Made with the deck being asked about, rather than any deck. */
  thisDeck: boolean;
}
