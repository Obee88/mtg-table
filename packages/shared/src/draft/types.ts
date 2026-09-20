import type { DeckContents } from '../decks.js';
import type { PlayerId } from '../game/types.js';

export type PassDirection = 'left' | 'right';

/** Pick-and-pass: everyone opens a pack, takes a card, passes the rest. */
export interface PickAndPassConfig {
  type: 'pickAndPass';
  name: string;
  /** Cube version the packs are dealt from. */
  poolCubeVersionId: string;
  packSize: number;
  packsPerPlayer: number;
  rounds: number;
  /** `alternate` flips every round (counting across phases); fixed directions never flip. */
  direction: 'alternate' | PassDirection;
}

/** Winston: a face-down stack and a few face-down piles; the active player takes a pile or passes (adding a card to it) until the stack and piles are gone. */
export interface WinstonConfig {
  type: 'winston';
  name: string;
  poolCubeVersionId: string;
  /** Cards dealt into the stack (piles are seeded from it). */
  stackSize: number;
  piles: number;
}

export type DraftPhaseConfig = PickAndPassConfig | WinstonConfig;

/** Live state of a Winston phase. The stack lives in `packs[packId].cards` (top first). */
export interface WinstonState {
  packId: string;
  piles: DraftCard[][];
  /** Seat whose turn it is, and the pile they are looking at. */
  activeSeat: number;
  pileIndex: number;
}

export interface DraftConfig {
  name: string;
  seats: 2 | 4;
  /** Direction of the very first round when a phase alternates. */
  startDirection: PassDirection;
  phases: DraftPhaseConfig[];
}

/** Draft-matters abilities the engine knows how to run. */
export type DraftAbility = 'librarian';

/** Cards with draft abilities, by card name. */
const ABILITIES: Record<string, DraftAbility> = { 'Cogwork Librarian': 'librarian' };

export function draftAbilityFor(name: string): DraftAbility | undefined {
  return ABILITIES[name];
}

export interface DraftCard {
  /** Instance id (unique within the draft). */
  id: string;
  printingId: string;
  /** Set on cards with a draft ability; stripped together with the identity when hidden. */
  ability?: DraftAbility | undefined;
}

export interface Pack {
  id: string;
  phase: number;
  round: number;
  cards: DraftCard[];
  /** Cards taken from this pack so far (pick numbers count per pack). */
  taken: number;
}

export interface DraftPlayer {
  /** Packs waiting at this seat; the first is the one being picked from. */
  queue: string[];
  pool: DraftCard[];
  /** Cards drafted face up (draft-matters cards); visible to everyone. */
  faceUp: DraftCard[];
  /** Overall picks made by this player. */
  picks: number;
}

export interface PickRecord {
  n: number;
  phase: number;
  round: number;
  packId: string;
  playerId: PlayerId;
  card: DraftCard;
  /** 1-based position within the pack (how many cards had already left it + 1). */
  pickInPack: number;
  /** Cards the pack held when the pick was made (including the chosen one). */
  packContents: string[];
  /** Extra pick made in the same action (draft abilities); excluded from pick-position stats. */
  double: boolean;
  /** Picked face up: the card is public history for everyone. */
  faceUp: boolean;
}

export type DraftStatus = 'running' | 'finished';

/** A drafter's submitted deck: main deck as draft card ids (the rest of the pool is the sideboard) plus free basic lands. */
export interface DraftDeck {
  main: string[];
  basics: { printingId: string; quantity: number }[];
}

export interface DraftState {
  config: DraftConfig;
  /** Player ids by seat, clockwise. */
  seats: PlayerId[];
  phase: number;
  round: number;
  /** Rounds completed across all phases; drives the alternating direction. */
  globalRound: number;
  direction: PassDirection;
  packs: Record<string, Pack>;
  /** Packs dealt for every phase and round up front: dealt[phase][round][seat] = pack ids. */
  dealt: string[][][][];
  players: Record<PlayerId, DraftPlayer>;
  picks: PickRecord[];
  status: DraftStatus;
  /** Set while the current phase is a Winston phase. */
  winston: WinstonState | null;
  /** Decks submitted during deckbuilding, by player. */
  decks: Record<PlayerId, DraftDeck>;
}

/** Direction for a given global round under the config's rule. */
export function directionFor(config: DraftConfig, phase: DraftPhaseConfig, globalRound: number): PassDirection {
  if (phase.type !== 'pickAndPass') return config.startDirection;
  if (phase.direction !== 'alternate') return phase.direction;
  return globalRound % 2 === 0 ? config.startDirection : config.startDirection === 'left' ? 'right' : 'left';
}

/** The seat a pack goes to next. `left` = the next seat clockwise. */
export function nextSeat(seatCount: number, seat: number, direction: PassDirection): number {
  return direction === 'left' ? (seat + 1) % seatCount : (seat - 1 + seatCount) % seatCount;
}

/** Total cards a config draws from each phase's pool. */
export function cardsNeeded(config: DraftConfig, phase: DraftPhaseConfig): number {
  if (phase.type === 'winston') return phase.stackSize;
  return phase.packSize * phase.packsPerPlayer * phase.rounds * config.seats;
}

/** Rounds a phase runs; Winston is a single continuous round. */
export function roundsOf(phase: DraftPhaseConfig): number {
  return phase.type === 'pickAndPass' ? phase.rounds : 1;
}

/** Index of the first non-empty pile at or after `from`, or -1. */
export function nextPile(piles: readonly DraftCard[][], from: number): number {
  for (let i = Math.max(0, from); i < piles.length; i++) if (piles[i]!.length > 0) return i;
  return -1;
}

/** One row of a finished draft's pick log, as served by the API. */
export interface DraftPickSummary {
  n: number;
  playerId: PlayerId;
  printingId: string;
  phase: number;
  round: number;
  packId: string;
  pickInPack: number;
  packContents: string[];
  double: boolean;
}

/**
 * Cogwork Librarians the player drafted face up and may now spend: draft two
 * cards from the pack at hand and put the Librarian into that pack instead.
 * Needs a pack with at least two cards.
 */
export function usableLibrarians(state: DraftState, playerId: PlayerId): DraftCard[] {
  const player = state.players[playerId];
  if (!player || state.status !== 'running') return [];
  const pack = player.queue[0] ? state.packs[player.queue[0]] : undefined;
  if (!pack || pack.cards.length < 2) return [];
  return player.faceUp.filter((c) => c.ability === 'librarian');
}

/** The submitted deck as table-ready contents: main (drafted + basics), sideboard (the rest of the pool). */
export function draftDeckContents(state: DraftState, playerId: PlayerId): DeckContents | null {
  const player = state.players[playerId];
  const deck = state.decks?.[playerId];
  if (!player || !deck) return null;
  const inMain = new Set(deck.main);
  const tally = (cards: DraftCard[]) => {
    const counts = new Map<string, number>();
    for (const c of cards) counts.set(c.printingId, (counts.get(c.printingId) ?? 0) + 1);
    return [...counts].map(([printingId, quantity]) => ({ printingId, quantity }));
  };
  const main = tally(player.pool.filter((c) => inMain.has(c.id)));
  for (const b of deck.basics) if (b.quantity > 0) main.push({ printingId: b.printingId, quantity: b.quantity });
  return { main, sideboard: tally(player.pool.filter((c) => !inMain.has(c.id))), commander: [] };
}

/** Whether every seat has submitted a deck. */
export function allDecksSubmitted(state: DraftState): boolean {
  return state.seats.every((id) => !!state.decks?.[id]);
}
