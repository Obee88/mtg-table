import type { Attention } from './attention.js';
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
  /** Reserved table: only these players (and the owner) may sit; everyone still sees the lobby. Empty or absent = open to the group. */
  reservedPlayerIds?: string[] | undefined;
}

export type Visibility = 'owner' | 'all' | PlayerId[];

/** The steps of a turn, in order. No rules engine: players walk through them with the play button. */
export const STEPS = ['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end'] as const;
export type Step = (typeof STEPS)[number];
export const STEP_LABELS: Record<Step, string> = { untap: 'Untap', upkeep: 'Upkeep', draw: 'Draw', main1: 'Main 1', combat: 'Combat', main2: 'Main 2', end: 'End' };

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
  /** Players pointing at this card this turn; cleared when the turn passes. */
  targetedBy: PlayerId[];
  /** Skips the untap step: 'always', or for that many more untap steps. */
  noUntap: 'always' | number | null;
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
  /** Floating mana, by symbol (W U B R G C). Public while the pool is open. */
  mana: Record<string, number>;
  /** The player opened their mana pool, so everyone can see it. */
  manaOpen: boolean;
  /** Top card of the library is permanently revealed to everyone. */
  topRevealed: boolean;
  /** Set while the player looks through their library. */
  libraryView?: LibraryView | null | undefined;
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
  /** Sideboarding before the opening hands: swaps between sideboard and deck until every seat is done. */
  sideboarding: Record<PlayerId, SideboardingState>;
  /** Opening-hand decisions; play is blocked until every seated player has kept. */
  mulligans: Record<PlayerId, MulliganState>;
  /** Whose turn it is (starts with the roll winner). */
  activePlayerId: PlayerId;
  /** The active player's own turn number: everyone counts their own turns. */
  turn: number;
  /** Turns each player has taken so far. */
  turns: Record<PlayerId, number>;
  /** Where in the turn the active player is. */
  step: Step;
  /** d20 each player rolled for first; ties were re-rolled. */
  openingRoll: Record<PlayerId, number>;
  startedAt: string;
  /** 1 for the first deal in the room, +1 per restart; results are reported per game number. */
  gameNumber: number;
  /** A proposed outcome waiting for every seat to confirm; null winners = nobody won, do not track. */
  pendingResult: PendingResult | null;
  /** Players owed an extra turn, in the order they were granted; the most recent is taken first, right after the current turn. */
  extraTurns?: PlayerId[] | undefined;
}

export interface PendingResult {
  proposedBy: PlayerId;
  winners: PlayerId[] | null;
  /** What happens once everyone agrees: the room ends, or a new game is dealt. */
  then: 'end' | 'restart';
  confirmed: PlayerId[];
}

/** Outcome of one game as reported by a seated player; empty winners = draw. Re-reporting replaces the earlier entry. */
export interface GameResult {
  gameNumber: number;
  reportedBy: PlayerId;
  winners: PlayerId[];
  note: string | null;
  at: string;
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
  /** Reported outcomes, one per game number. */
  results: GameResult[];
  /** What the players called this session; a draft gets one when it starts. */
  name: string | null;
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
    mana: {},
    manaOpen: false,
    commanderTax: 0,
    commanderDamage: {},
    topRevealed: false,
    zones: { library: [], hand: [], battlefield: [], graveyard: [], exile: [], command: [], sideboard: [], stack: [] },
  };
}

/** Summary row for room lists. */
export interface RoomListItem {
  id: string;
  name: string | null;
  phase: RoomPhase;
  settings: RoomSettings;
  ownerId: PlayerId;
  playerCount: number;
  createdAt: string;
  /** What the room waits on from the caller (only for rooms they sit in). */
  attention: Attention | null;
  /** Games played so far in the room, when a game has been dealt. */
  gameNumber: number | null;
  /** Whether the caller is seated. */
  seated: boolean;
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

export interface SideboardingState {
  done: boolean;
  /** Any card crossed the sideboard line: the hand is redrawn when the player finishes. */
  changed: boolean;
}

/** True while at least one seated player has not finished sideboarding (games from before this step count as done). */
export function inSideboarding(game: GameState): boolean {
  return Object.values(game.sideboarding ?? {}).some((s) => !s.done);
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

/**
 * Each player's deck as it sits in the game: every non-token card they own,
 * split by zone (sideboard → sideboard, command → commander, the rest main).
 * The source for deck history and card win rates.
 */
export function decksFromGame(state: RoomState): Record<PlayerId, { main: { printingId: string; quantity: number }[]; sideboard: { printingId: string; quantity: number }[]; commander: { printingId: string; quantity: number }[] }> {
  const out: ReturnType<typeof decksFromGame> = {};
  if (!state.game) return out;
  const tallies: Record<string, Record<'main' | 'sideboard' | 'commander', Map<string, number>>> = {};
  for (const card of Object.values(state.game.cards)) {
    if (card.isToken || !card.printingId) continue;
    const t = (tallies[card.ownerId] ??= { main: new Map(), sideboard: new Map(), commander: new Map() });
    const part = card.zone === 'sideboard' ? 'sideboard' : card.isCommander ? 'commander' : 'main';
    t[part].set(card.printingId, (t[part].get(card.printingId) ?? 0) + 1);
  }
  const list = (m: Map<string, number>) => [...m].map(([printingId, quantity]) => ({ printingId, quantity })).sort((a, b) => a.printingId.localeCompare(b.printingId));
  for (const [id, t] of Object.entries(tallies)) out[id] = { main: list(t.main), sideboard: list(t.sideboard), commander: list(t.commander) };
  return out;
}

/**
 * A draft format's seat count is only a default: the room decides how many
 * play, so the format adapts when it is attached to a room or the player
 * count changes. Applied by the reducer, so every replica agrees.
 */
export function withRoomSeats(settings: RoomSettings): RoomSettings {
  if (!settings.draft || settings.draft.seats === settings.playerCount) return settings;
  return { ...settings, draft: { ...settings.draft, seats: settings.playerCount } };
}

/** "House rules · 4 players · 2026-09-21 · Alice, Bob" — the name a draft is offered when it starts. */
export function defaultDraftName(state: RoomState, now: Date): string {
  const players = seatedPlayers(state).map((p) => p.displayName);
  const parts = [
    state.settings.draft?.name ?? 'Draft',
    `${players.length || state.settings.playerCount} players`,
    now.toISOString().slice(0, 10),
  ];
  if (players.length > 0) parts.push(players.join(', '));
  return parts.join(' · ');
}

/** Mana symbols a pool can hold, in the usual order. */
export const MANA_SYMBOLS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type ManaSymbol = (typeof MANA_SYMBOLS)[number];

/** Total floating mana in a pool. */
export function manaTotal(pool: Record<string, number>): number {
  return Object.values(pool).reduce((n, v) => n + Math.max(0, v), 0);
}

/** The step after `step`, or null at the end of the turn. */
export function nextStep(step: Step): Step | null {
  const i = STEPS.indexOf(step);
  return i < 0 || i === STEPS.length - 1 ? null : STEPS[i + 1]!;
}

/** Whether a card untaps in its controller's untap step. */
export function untapsNormally(card: CardInstance): boolean {
  return card.noUntap === null || card.noUntap === undefined;
}

/** Whether a player may take a seat: any seat at an open table, only a named one (or the owner) at a reserved table. */
export function canSit(state: RoomState, playerId: PlayerId): boolean {
  const reserved = state.settings.reservedPlayerIds ?? [];
  return reserved.length === 0 || state.ownerId === playerId || reserved.includes(playerId);
}

/** "Alice won game 2", "Alice & Bob won game 3", "Game 4 was a draw" — for the end-of-game card and the room's history. */
export function describeResult(result: GameResult, state: RoomState): string {
  const names = result.winners.map((id) => state.players[id]?.displayName ?? 'someone').join(' & ');
  return result.winners.length === 0 ? `Game ${result.gameNumber} was a draw` : `${names} won game ${result.gameNumber}`;
}

/**
 * A player looking through their library: the top n cards, or the whole
 * library (a search). While it is open the owner sees those cards; the others
 * see that it is happening, which cards were revealed, and where each acted-on
 * card went. Closing hides the cards again (and may shuffle).
 */
export interface LibraryView {
  kind: 'top' | 'search';
  /** Cards on view when it opened (top: that many from the top; search: the whole library), in library order. */
  cards: InstanceId[];
  /** Where a card went while the view was open: a zone, or top / bottom of the library. */
  placed: Record<InstanceId, ZoneName | 'top' | 'bottom'>;
  /** Cards revealed to everyone while the view was open. */
  revealed: InstanceId[];
}
