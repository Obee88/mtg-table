/** User id of a seated player. */
export type PlayerId = string;
/** Id of one physical card at the table (not the printing). */
export type InstanceId = string;

export const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command', 'sideboard'] as const;
export type ZoneName = (typeof ZONES)[number];

export type GameMode = '1v1' | 'ffa' | '2v2';

export interface RoomSettings {
  playerCount: 2 | 4;
  mode: GameMode;
  startingLife: number;
  commander: boolean;
}

export type Visibility = 'owner' | 'all' | PlayerId[];

export interface CardInstance {
  id: InstanceId;
  /** Null when the viewer is not allowed to know the identity. */
  printingId: string | null;
  ownerId: PlayerId;
  controllerId: PlayerId;
  zone: ZoneName;
  tapped: boolean;
  transformed: boolean;
  flipped: boolean;
  faceDown: boolean;
  counters: Record<string, number>;
  attachedTo: InstanceId | null;
  note: string | null;
  isToken: boolean;
  visibleTo: Visibility;
  revealUntil: 'dismissed' | 'zoneChange' | null;
  /** Battlefield placement, in table units. */
  position: { x: number; y: number } | null;
}

export interface PlayerGameState {
  life: number;
  poison: number;
  counters: Record<string, number>;
  commanderTax: number;
  commanderDamage: Record<PlayerId, number>;
  /** Ordered instance ids per zone; library index 0 is the top. */
  zones: Record<ZoneName, InstanceId[]>;
}

export interface GameState {
  cards: Record<InstanceId, CardInstance>;
  players: Record<PlayerId, PlayerGameState>;
  /** Shared life per team in 2v2 (keyed by team number). */
  teamLife: Record<number, number> | null;
  firstPlayerId: PlayerId;
  /** d20 each player rolled for first; ties were re-rolled. */
  openingRoll: Record<PlayerId, number>;
  startedAt: string;
}

export interface RoomPlayer {
  id: PlayerId;
  displayName: string;
  seat: number;
  team: number;
  deckId: string | null;
  ready: boolean;
}

export type RoomPhase = 'lobby' | 'playing' | 'ended';

export interface RoomState {
  id: string;
  ownerId: PlayerId;
  settings: RoomSettings;
  phase: RoomPhase;
  players: Record<PlayerId, RoomPlayer>;
  game: GameState | null;
  /** Sequence number of the last event applied. */
  seq: number;
}

/** Diagonal teammates in 2v2: seats 0 & 2 vs 1 & 3. Otherwise every seat is its own team. */
export function teamForSeat(seat: number, mode: GameMode): number {
  return mode === '2v2' ? seat % 2 : seat;
}

export function seatedPlayers(state: RoomState): RoomPlayer[] {
  return Object.values(state.players).sort((a, b) => a.seat - b.seat);
}

export function emptyPlayerGameState(startingLife: number): PlayerGameState {
  return {
    life: startingLife,
    poison: 0,
    counters: {},
    commanderTax: 0,
    commanderDamage: {},
    zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [], sideboard: [] },
  };
}

/** Summary row for room lists. */
export interface RoomListItem {
  id: string;
  phase: RoomPhase;
  settings: RoomSettings;
  ownerId: PlayerId;
  playerCount: number;
  createdAt: string;
}

/** Fisher–Yates with an injected random source, so shuffles are reproducible in tests. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
