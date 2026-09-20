import { z } from 'zod';

export const draftCommandSchema = z.discriminatedUnion('type', [
  /** Take a card from the pack at hand. `faceUp` marks a draft-matters card everyone should see. */
  z.object({ type: z.literal('draftPick'), cardId: z.string(), faceUp: z.boolean().optional() }),
]);
export type DraftCommand = z.infer<typeof draftCommandSchema>;
