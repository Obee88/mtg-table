import type { CardPrinting } from './cards.js';
import type { CardStat } from './draft/stats.js';
import type { CardRecord } from './stats.js';
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
  ownerId: string;
  ownerName: string;
  /** Shared with the caller by its owner (read-only, but usable in drafts). */
  shared: boolean;
  latestVersion: number;
  /** Id of that version (null for a cube with no version yet), for starting a draft from the list. */
  latestVersionId: string | null;
  cardCount: number;
  updatedAt: string;
}

/** A cube with one version's contents (the latest unless a version was requested). */
export interface CubeResponse {
  cube: { id: string; name: string; ownerId: string; createdAt: string; updatedAt: string };
  /** Players the owner shares the cube with. */
  members: { id: string; displayName: string }[];
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

// ---- version diff ----

export interface CubeDiffSwap {
  oracleId: string;
  from: CardPrinting;
  to: CardPrinting;
  quantity: number;
}

export interface CubeDiffQuantity {
  printing: CardPrinting;
  from: number;
  to: number;
}

export interface CubeDiff {
  added: { printing: CardPrinting; quantity: number }[];
  removed: { printing: CardPrinting; quantity: number }[];
  /** Same card (oracle id), different printing. */
  swapped: CubeDiffSwap[];
  quantity: CubeDiffQuantity[];
}

export interface CubeDiffResponse extends CubeDiff {
  from: CubeVersionSummary;
  to: CubeVersionSummary;
}

/**
 * Compares two versions. Cards are matched by printing; leftovers on both
 * sides sharing an oracle id are reported as printing swaps.
 */
export function diffCubeVersions(from: CubeCard[], to: CubeCard[], printings: Map<string, CardPrinting>): CubeDiff {
  const a = new Map(from.map((c) => [c.printingId, c.quantity]));
  const b = new Map(to.map((c) => [c.printingId, c.quantity]));
  const quantity: CubeDiffQuantity[] = [];
  const gone: CubeCard[] = [];
  const fresh: CubeCard[] = [];
  for (const [id, q] of a) {
    const nq = b.get(id);
    if (nq === undefined) gone.push({ printingId: id, quantity: q });
    else if (nq !== q) quantity.push({ printing: printings.get(id)!, from: q, to: nq });
  }
  for (const [id, q] of b) if (!a.has(id)) fresh.push({ printingId: id, quantity: q });

  const swapped: CubeDiffSwap[] = [];
  const removed: CubeDiff['removed'] = [];
  const added: CubeDiff['added'] = [];
  const freshByOracle = new Map<string, CubeCard[]>();
  for (const c of fresh) {
    const o = printings.get(c.printingId)?.oracleId;
    if (o) freshByOracle.set(o, [...(freshByOracle.get(o) ?? []), c]);
  }
  for (const c of gone) {
    const p = printings.get(c.printingId)!;
    const match = p.oracleId ? freshByOracle.get(p.oracleId)?.shift() : undefined;
    if (match) {
      swapped.push({ oracleId: p.oracleId!, from: p, to: printings.get(match.printingId)!, quantity: match.quantity });
      if (match.quantity !== c.quantity) quantity.push({ printing: printings.get(match.printingId)!, from: c.quantity, to: match.quantity });
    } else removed.push({ printing: p, quantity: c.quantity });
  }
  const swappedIds = new Set(swapped.map((s) => s.to.id));
  for (const c of fresh) if (!swappedIds.has(c.printingId)) added.push({ printing: printings.get(c.printingId)!, quantity: c.quantity });

  const byName = (x: { printing: CardPrinting }, y: { printing: CardPrinting }) => x.printing.name.localeCompare(y.printing.name);
  return { added: added.sort(byName), removed: removed.sort(byName), swapped: swapped.sort((x, y) => x.from.name.localeCompare(y.from.name)), quantity: quantity.sort(byName) };
}

// ---- draft statistics ----

export interface CubeStatsResponse {
  cube: { id: string; name: string };
  /** Versions covered by the numbers (all of them, or the one requested). */
  versions: CubeVersionSummary[];
  /** Drafts (rooms) that dealt from those versions. */
  drafts: number;
  picks: number;
  /** The draft type the numbers cover ('all' mixes them, which only the totals survive). */
  type: string;
  /** Draft types this cube has been drafted with, with how many picks each. */
  types: { type: string; picks: number }[];
  stats: CardStat[];
  /** Win rate of decks that held each card, in games played from this cube's drafts. */
  records: CardRecord[];
  /** Reported games behind those records. */
  games: number;
  printings: CardPrinting[];
}

/** How many cards the house rules' first phase needs: 4 packs of 5. */
export const TRI_COLOUR_POOL_SIZE = 20;

/**
 * The house-rules pool from a cube: every card whose colour identity has
 * exactly `colours` colours (three by default: shards and wedges, tri-lands
 * included), with its cube quantity. Unknown printings are skipped.
 */
export function triColourPool(cards: CubeCard[], printings: Map<string, CardPrinting> | CardPrinting[], colours = 3): CubeCard[] {
  const byId = printings instanceof Map ? printings : new Map(printings.map((p) => [p.id, p]));
  return cards.filter((c) => byId.get(c.printingId)?.colorIdentity.length === colours);
}
