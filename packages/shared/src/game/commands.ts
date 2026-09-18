import { z } from 'zod';
import { roomSettingsSchema } from './events.js';

/** What a client may ask for. Validated by `decide` against the current state. */
export const gameCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join') }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('selectDeck'), deckId: z.string().nullable() }),
  z.object({ type: z.literal('setReady'), ready: z.boolean() }),
  z.object({ type: z.literal('updateSettings'), settings: roomSettingsSchema }),
  z.object({ type: z.literal('closeRoom') }),
]);

export type GameCommand = z.infer<typeof gameCommandSchema>;
export type GameCommandType = GameCommand['type'];
