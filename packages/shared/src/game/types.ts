import type { DraftConfig, DraftState } from '../draft/types.js';

/** User id of a seated player. */
export type PlayerId = string;
/** Id of one physical card at the table (not the printing). */
export type InstanceId = string;

export const ZONES = ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'command', 'sideboard', 'stack'] as const;
export type ZoneName = (typeof ZONES)[number];

export type GameMode = '1v1' | 'ffa' | '2v2';

export interface RoomSettings {
  playerCount: 2 | 4;
  mode: GameMode;
  startingLife: number;
  commander: boolean;
  /** Present for draft rooms: the draft runs before the game, with fixed seats. */
  draft?: DraftConfig | null | undefined;
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
  /** Started the game in the command zone: may return there, and casting from there adds commander tax. */
  isCommander: boolean;
  /** Label for tokens without a printing (e.g. a custom 2/2 Zombie). */
  customName: string | null;
  visibleTo: Visibility;
  revealUntil: 'dismissed' | 'zoneChange' | null;
  /** Battlefield placement: row (0 = front, 1 = back/lands) and an order key within the row.
   *  Cards sharing (row, col) form a pile, later in the zone list = on top. */
  position: { row: number; col: number } | null;
}

export interface PlayerGameState {
  life: number;
  poison: number;
  counters: Record<string, number>;
  commanderTax: number;
  commanderDamage: Record<PlayerId, number>;
  /** Top card of the library is permanently revealed to everyone. */
  topRevealed: boolean;
  /** Ordered instance ids per zone; library index 0 is the top. */
  zones: Record<ZoneName, InstanceId[]>;
}

export interface GameState {
  cards: Record<InstanceId, CardInstance>;
  players: Record<PlayerId, PlayerGameState>;
  /** Shared life per team in 2v2 (keyed by team number). */
  teamLife: Record<number, number> | null;
  firstPlayerId: PlayerId;
  /** Shared stack of spells/abilities being cast, in cast order (last = top). Cards there are public. */
  stack: InstanceId[];
  /** Opening-hand decisions; play is blocked until every seated player has kept. */
  mulligans: Record<PlayerId, MulliganState>;
  /** Whose turn it is (starts with the roll winner) and the turn number (1-based). */
  activePlayerId: PlayerId;
  turn: number;
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

export type RoomPhase = 'lobby' | 'drafting' | 'deckbuilding' | 'playing' | 'ended';

export interface RoomState {
  id: string;
  ownerId: PlayerId;
  settings: RoomSettings;
  phase: RoomPhase;
  players: Record<PlayerId, RoomPlayer>;
  game: GameState | null;
  /** The draft of a draft room, from `draftStarted` on; null for pre-constructed rooms. */
  draft: DraftState | null;
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
    topRevealed: false,
    zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [], sideboard: [], stack: [] },
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

export interface MulliganState {
  /** Mulligans taken so far; the same number of cards goes to the bottom on keep. */
  taken: number;
  kept: boolean;
}

/** True while at least one seated player has not kept an opening hand (games from before this field count as kept). */
export function inMulligan(game: GameState): boolean {
  return Object.values(game.mulligans ?? {}).some((m) => !m.kept);
}

/** Active player, tolerating games recorded before turn tracking existed. */
export function activePlayer(game: GameState): PlayerId {
  return game.activePlayerId ?? game.firstPlayerId;
}

/** Whether it is `playerId`'s turn: their own in 1v1/FFA, their team's in 2v2 (partners share a turn). */
export function isActive(state: RoomState, playerId: PlayerId): boolean {
  if (!state.game) return false;
  const active = activePlayer(state.game);
  if (active === playerId) return true;
  if (state.settings.mode !== '2v2') return false;
  const a = state.players[active];
  const b = state.players[playerId];
  return !!a && !!b && a.team === b.team;
}

/** Team colour in 2v2 (partners share it), seat colour otherwise. Index into the seat palette. */
export function colorIndex(state: RoomState, player: RoomPlayer): number {
  return state.settings.mode === '2v2' ? player.team : player.seat;
}
