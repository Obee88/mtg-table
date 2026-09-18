import { z } from 'zod';
import { positionSchema, roomSettingsSchema } from './events.js';
import { ZONES } from './types.js';

/** What a client may ask for. Validated by `decide` against the current state. */
export const gameCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join') }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('selectDeck'), deckId: z.string().nullable() }),
  z.object({ type: z.literal('setReady'), ready: z.boolean() }),
  z.object({ type: z.literal('updateSettings'), settings: roomSettingsSchema }),
  z.object({ type: z.literal('closeRoom') }),
  z.object({ type: z.literal('start') }),
  // ---- game ----
  z.object({
    type: z.literal('moveCard'),
    instanceId: z.string(),
    to: z.enum(ZONES),
    position: positionSchema.optional(),
    libraryPosition: z.enum(['top', 'bottom']).optional(),
  }),
  z.object({ type: z.literal('tapCard'), instanceId: z.string(), tapped: z.boolean() }),
  z.object({ type: z.literal('draw'), count: z.number().int().min(1).max(20) }),
  z.object({ type: z.literal('untapAll') }),
  z.object({ type: z.literal('shuffleLibrary') }),
  z.object({ type: z.literal('mulligan'), count: z.number().int().min(0).max(7).default(7) }),
  z.object({ type: z.literal('transformCard'), instanceId: z.string(), transformed: z.boolean() }),
  z.object({ type: z.literal('flipCard'), instanceId: z.string(), flipped: z.boolean() }),
  z.object({ type: z.literal('setFaceDown'), instanceId: z.string(), faceDown: z.boolean() }),
  z.object({ type: z.literal('addCounter'), instanceId: z.string(), kind: z.string().trim().min(1).max(32), delta: z.number().int().min(-99).max(99) }),
  z.object({ type: z.literal('attachCard'), instanceId: z.string(), to: z.string().nullable() }),
  z.object({ type: z.literal('setNote'), instanceId: z.string(), note: z.string().trim().max(80).nullable() }),
  z.object({
    type: z.literal('createToken'),
    printingId: z.string().nullable(),
    customName: z.string().trim().min(1).max(40).nullable(),
    count: z.number().int().min(1).max(20),
    position: positionSchema,
  }),
]);

export type GameCommand = z.infer<typeof gameCommandSchema>;
export type GameCommandType = GameCommand['type'];
