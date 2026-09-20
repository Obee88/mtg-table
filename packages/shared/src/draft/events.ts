import { z } from 'zod';

export const passDirectionSchema = z.enum(['left', 'right']);

export const pickAndPassConfigSchema = z.object({
  type: z.literal('pickAndPass'),
  name: z.string().trim().min(1).max(60),
  poolCubeVersionId: z.string(),
  packSize: z.number().int().min(1).max(30),
  packsPerPlayer: z.number().int().min(1).max(4),
  rounds: z.number().int().min(1).max(10),
  direction: z.enum(['alternate', 'left', 'right']),
});

export const winstonConfigSchema = z.object({
  type: z.literal('winston'),
  name: z.string().trim().min(1).max(60),
  poolCubeVersionId: z.string(),
  stackSize: z.number().int().min(6).max(600),
  piles: z.number().int().min(2).max(5),
});

export const gridConfigSchema = z.object({
  type: z.literal('grid'),
  name: z.string().trim().min(1).max(60),
  poolCubeVersionId: z.string(),
  grids: z.number().int().min(1).max(60),
  size: z.number().int().min(2).max(4),
});

export const winchesterConfigSchema = z.object({
  type: z.literal('winchester'),
  name: z.string().trim().min(1).max(60),
  poolCubeVersionId: z.string(),
  stackSize: z.number().int().min(6).max(600),
  piles: z.number().int().min(2).max(6),
});

export const draftPhaseConfigSchema = z.discriminatedUnion('type', [pickAndPassConfigSchema, winstonConfigSchema, gridConfigSchema, winchesterConfigSchema]);

export const draftConfigSchema = z.object({
  name: z.string().trim().min(1).max(60),
  seats: z.union([z.literal(2), z.literal(4)]),
  startDirection: passDirectionSchema,
  phases: z.array(draftPhaseConfigSchema).min(1).max(6),
});

export const draftAbilitySchema = z.enum(['librarian']);
const draftCardSchema = z.object({ id: z.string(), printingId: z.string().nullable(), ability: draftAbilitySchema.optional() });
const packSchema = z.object({ id: z.string(), phase: z.number().int(), round: z.number().int(), cards: z.array(draftCardSchema) });

/** Facts about a draft. `draftStarted` carries every pack dealt for every phase and round. */
export const draftEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('draftStarted'),
    config: draftConfigSchema,
    seats: z.array(z.string()),
    packs: z.array(packSchema),
    /** dealt[phase][round][seat] = pack ids */
    dealt: z.array(z.array(z.array(z.array(z.string())))),
  }),
  z.object({
    type: z.literal('draftPicked'),
    playerId: z.string(),
    packId: z.string(),
    cardId: z.string(),
    /** Printing may be null in a projection for viewers who may not see it. */
    printingId: z.string().nullable(),
    faceUp: z.boolean(),
    ability: draftAbilitySchema.optional(),
    /** An extra pick granted by a draft ability (kept out of pick-position statistics). */
    double: z.boolean(),
    /** The pack stays in hand: more of this action follows (a second pick, a card returned). */
    holdPack: z.boolean().optional(),
  }),
  /** A drafted card goes from the player's pool back into the pack at hand, which is then passed (Cogwork Librarian). */
  z.object({
    type: z.literal('draftCardReturned'),
    playerId: z.string(),
    packId: z.string(),
    cardId: z.string(),
    printingId: z.string().nullable(),
    ability: draftAbilitySchema.optional(),
  }),
  /** Winston: the active player took a pile (`pileIndex` -1 = the top card of the stack, blind). */
  z.object({ type: z.literal('winstonTaken'), playerId: z.string(), packId: z.string(), pileIndex: z.number().int(), cards: z.array(draftCardSchema) }),
  /** Winston: the active player passed on a pile; the top card of the stack (if any) joined it face down. */
  z.object({ type: z.literal('winstonPassed'), playerId: z.string(), packId: z.string(), pileIndex: z.number().int(), addedCardId: z.string().nullable() }),
  /** Grid: the active player took a row or column of the current grid (public). */
  z.object({ type: z.literal('gridTaken'), playerId: z.string(), packId: z.string(), line: z.enum(['row', 'col']), index: z.number().int(), cards: z.array(draftCardSchema) }),
  /** Winchester: the active player took a pile (public); `added` are the stack cards that then joined each pile, in pile order. */
  z.object({ type: z.literal('winchesterTaken'), playerId: z.string(), packId: z.string(), index: z.number().int(), cards: z.array(draftCardSchema), added: z.array(z.string()) }),
  /** A drafter's deck for the table; others only learn that it was submitted. */
  z.object({
    type: z.literal('draftDeckSubmitted'),
    playerId: z.string(),
    main: z.array(z.string()),
    basics: z.array(z.object({ printingId: z.string(), quantity: z.number().int().min(0).max(99) })),
  }),
]);
export type DraftEvent = z.infer<typeof draftEventSchema>;
