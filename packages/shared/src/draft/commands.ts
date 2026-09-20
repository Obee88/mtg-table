import { z } from 'zod';

export const draftCommandSchema = z.discriminatedUnion('type', [
  /** Take a card from the pack at hand. `faceUp` marks a draft-matters card everyone should see. */
  z.object({
    type: z.literal('draftPick'),
    cardId: z.string(),
    faceUp: z.boolean().optional(),
    /** Spend a face-up Cogwork Librarian: also take `secondCardId` and put the Librarian into the pack. */
    librarian: z.object({ cardId: z.string(), secondCardId: z.string() }).optional(),
  }),
  /** Winston: take the pile being looked at, or pass on it. */
  z.object({ type: z.literal('winstonDecide'), take: z.boolean() }),
  /** Grid: take a row or column of the current grid. */
  z.object({ type: z.literal('gridPick'), line: z.enum(['row', 'col']), index: z.number().int().min(0).max(3) }),
  /** Deckbuilding: main deck as draft card ids from the own pool, plus any number of free basic lands. May be re-submitted until the game starts. */
  z.object({
    type: z.literal('submitDraftDeck'),
    main: z.array(z.string()).max(500),
    basics: z.array(z.object({ printingId: z.string(), quantity: z.number().int().min(0).max(99) })).max(20),
  }),
]);
export type DraftCommand = z.infer<typeof draftCommandSchema>;
