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

export type DraftPhaseConfig = PickAndPassConfig;

export interface DraftConfig {
  name: string;
  seats: 2 | 4;
  /** Direction of the very first round when a phase alternates. */
  startDirection: PassDirection;
  phases: DraftPhaseConfig[];
}

export interface DraftCard {
  /** Instance id (unique within the draft). */
  id: string;
  printingId: string;
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
}

export type DraftStatus = 'running' | 'finished';

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
}

/** Direction for a given global round under the config's rule. */
export function directionFor(config: DraftConfig, phase: DraftPhaseConfig, globalRound: number): PassDirection {
  if (phase.direction !== 'alternate') return phase.direction;
  return globalRound % 2 === 0 ? config.startDirection : config.startDirection === 'left' ? 'right' : 'left';
}

/** The seat a pack goes to next. `left` = the next seat clockwise. */
export function nextSeat(seatCount: number, seat: number, direction: PassDirection): number {
  return direction === 'left' ? (seat + 1) % seatCount : (seat - 1 + seatCount) % seatCount;
}

/** Total cards a config draws from each phase's pool. */
export function cardsNeeded(config: DraftConfig, phase: DraftPhaseConfig): number {
  return phase.packSize * phase.packsPerPlayer * phase.rounds * config.seats;
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
