import { z } from 'zod';
import { ZONES, type RoomState } from './types.js';

export const positionSchema = z.object({ row: z.number().int().min(0).max(3), col: z.number() });
export const visibilitySchema = z.union([z.literal('owner'), z.literal('all'), z.array(z.string())]);

export const counterTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('card'), instanceId: z.string() }),
  z.object({ type: z.literal('player'), playerId: z.string() }),
]);
export type CounterTarget = z.infer<typeof counterTargetSchema>;

export const lifeTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('player'), playerId: z.string() }),
  z.object({ type: z.literal('team'), team: z.number().int() }),
]);

export const roomSettingsSchema = z.object({
  playerCount: z.union([z.literal(2), z.literal(4)]),
  mode: z.enum(['1v1', 'ffa', '2v2']),
  startingLife: z.number().int().min(1).max(999),
  commander: z.boolean(),
});

/**
 * Every change to a room is one of these. Events are facts: the reducer
 * applies them without validation. Later milestones add game events here.
 */
const startedCard = z.object({ id: z.string(), printingId: z.string().nullable() });
const startedPlayer = z.object({
  library: z.array(startedCard),
  hand: z.array(startedCard),
  command: z.array(startedCard),
  sideboard: z.array(startedCard),
});

export const gameEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('roomCreated'), ownerId: z.string(), settings: roomSettingsSchema }),
  z.object({ type: z.literal('settingsChanged'), settings: roomSettingsSchema }),
  z.object({ type: z.literal('playerJoined'), playerId: z.string(), displayName: z.string(), seat: z.number().int(), team: z.number().int() }),
  z.object({ type: z.literal('playerLeft'), playerId: z.string() }),
  z.object({ type: z.literal('deckSelected'), playerId: z.string(), deckId: z.string().nullable() }),
  z.object({ type: z.literal('readyChanged'), playerId: z.string(), ready: z.boolean() }),
  z.object({ type: z.literal('roomClosed') }),
  /** Compensating event for undo: restores the full state from before the undone batch. */
  z.object({ type: z.literal('actionUndone'), fromSeq: z.number().int(), toSeq: z.number().int(), state: z.custom<RoomState>((v) => typeof v === 'object' && v !== null) }),
  // ---- game ----
  z.object({
    type: z.literal('cardMoved'),
    instanceId: z.string(),
    from: z.enum(ZONES),
    to: z.enum(ZONES),
    position: positionSchema.nullable(),
    libraryPosition: z.enum(['top', 'bottom']).nullable(),
  }),
  z.object({ type: z.literal('cardTapped'), instanceId: z.string(), tapped: z.boolean() }),
  z.object({ type: z.literal('cardTransformed'), instanceId: z.string(), transformed: z.boolean() }),
  z.object({ type: z.literal('cardFlipped'), instanceId: z.string(), flipped: z.boolean() }),
  z.object({ type: z.literal('cardFaceDownChanged'), instanceId: z.string(), faceDown: z.boolean() }),
  /** One mechanism for card and player counters. `value` is the resulting total. */
  z.object({ type: z.literal('counterChanged'), target: counterTargetSchema, kind: z.string(), delta: z.number().int(), value: z.number().int() }),
  z.object({ type: z.literal('cardAttached'), instanceId: z.string(), to: z.string().nullable() }),
  // ---- visibility ----
  z.object({ type: z.literal('visibilityChanged'), instanceId: z.string(), visibleTo: visibilitySchema, revealUntil: z.enum(['dismissed', 'zoneChange']).nullable() }),
  z.object({ type: z.literal('libraryReordered'), playerId: z.string(), top: z.array(z.string()) }),
  z.object({ type: z.literal('topRevealedChanged'), playerId: z.string(), enabled: z.boolean() }),
  // ---- players ----
  z.object({ type: z.literal('lifeChanged'), target: lifeTargetSchema, delta: z.number().int(), value: z.number().int() }),
  z.object({ type: z.literal('poisonChanged'), playerId: z.string(), delta: z.number().int(), value: z.number().int() }),
  z.object({ type: z.literal('commanderTaxChanged'), playerId: z.string(), delta: z.number().int(), value: z.number().int() }),
  /** Commander damage dealt to `playerId` by `fromPlayerId`'s commander. */
  z.object({ type: z.literal('commanderDamageChanged'), playerId: z.string(), fromPlayerId: z.string(), delta: z.number().int(), value: z.number().int() }),
  z.object({ type: z.literal('diceRolled'), playerId: z.string(), sides: z.number().int(), results: z.array(z.number().int()) }),
  z.object({ type: z.literal('coinFlipped'), playerId: z.string(), results: z.array(z.enum(['heads', 'tails'])) }),
  z.object({ type: z.literal('noteChanged'), instanceId: z.string(), note: z.string().nullable() }),
  z.object({
    type: z.literal('tokenCreated'),
    controllerId: z.string(),
    cards: z.array(z.object({ id: z.string(), printingId: z.string().nullable(), customName: z.string().nullable() })),
    position: positionSchema,
  }),
  z.object({ type: z.literal('mulliganTaken'), playerId: z.string(), taken: z.number().int() }),
  z.object({ type: z.literal('handKept'), playerId: z.string(), bottomed: z.number().int() }),
  z.object({ type: z.literal('turnEnded'), playerId: z.string(), nextPlayerId: z.string(), turn: z.number().int() }),
  /** Library re-keyed: every card gets a fresh id so nobody can track one through the shuffle. Identities are stripped by projection. */
  z.object({
    type: z.literal('libraryShuffled'),
    playerId: z.string(),
    cards: z.array(z.object({ id: z.string(), printingId: z.string().nullable(), previousId: z.string().nullable() })),
  }),
  z.object({
    type: z.literal('gameStarted'),
    firstPlayerId: z.string(),
    openingRoll: z.record(z.string(), z.number().int()),
    players: z.record(z.string(), startedPlayer),
  }),
]);

export type GameEvent = z.infer<typeof gameEventSchema>;
export type GameEventType = GameEvent['type'];

/** An event as stored and streamed: the fact plus who caused it and when. */
export interface RoomEvent {
  seq: number;
  actorId: string | null;
  at: string;
  event: GameEvent;
  /** Groups the events produced by one command; undo works per batch. */
  batchId?: string;
  /** Identities the receiving viewer just became allowed to see (projection only). */
  revealed?: { instanceId: string; printingId: string }[];
  /** Cards whose identity the viewer may no longer see (projection only). */
  hidden?: string[];
}
