import { z } from 'zod';

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
export const gameEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('roomCreated'), ownerId: z.string(), settings: roomSettingsSchema }),
  z.object({ type: z.literal('settingsChanged'), settings: roomSettingsSchema }),
  z.object({ type: z.literal('playerJoined'), playerId: z.string(), displayName: z.string(), seat: z.number().int(), team: z.number().int() }),
  z.object({ type: z.literal('playerLeft'), playerId: z.string() }),
  z.object({ type: z.literal('deckSelected'), playerId: z.string(), deckId: z.string().nullable() }),
  z.object({ type: z.literal('readyChanged'), playerId: z.string(), ready: z.boolean() }),
  z.object({ type: z.literal('roomClosed') }),
]);

export type GameEvent = z.infer<typeof gameEventSchema>;
export type GameEventType = GameEvent['type'];

/** An event as stored and streamed: the fact plus who caused it and when. */
export interface RoomEvent {
  seq: number;
  actorId: string | null;
  at: string;
  event: GameEvent;
}
