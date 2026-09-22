import { z } from 'zod';
import { draftCommandSchema } from '../draft/commands.js';
import { libraryPositionSchema, positionSchema, roomSettingsSchema } from './events.js';

export const revealTargetSchema = z.union([z.literal('all'), z.array(z.string()).min(1).max(8)]);
export type RevealTarget = z.infer<typeof revealTargetSchema>;
import { ZONES } from './types.js';

/** What a client may ask for. Validated by `decide` against the current state. */
export const gameCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('join') }),
  z.object({ type: z.literal('leave') }),
  /** Move to a free seat while in the lobby (arranges partners in 2v2). */
  z.object({ type: z.literal('takeSeat'), seat: z.number().int().min(0).max(3) }),
  z.object({ type: z.literal('selectDeck'), deckId: z.string().nullable() }),
  z.object({ type: z.literal('setReady'), ready: z.boolean() }),
  z.object({ type: z.literal('updateSettings'), settings: roomSettingsSchema }),
  z.object({ type: z.literal('closeRoom') }),
  /** Handled by the server (needs history); decide() always rejects it. */
  z.object({ type: z.literal('undo') }),
  /** Deal the game or draft; a draft may be named as it starts. */
  z.object({ type: z.literal('start'), name: z.string().trim().max(120).optional() }),
  /** Rename the session (the owner, any time). */
  z.object({ type: z.literal('renameRoom'), name: z.string().trim().max(120) }),
  // ---- game ----
  z.object({
    type: z.literal('moveCard'),
    instanceId: z.string(),
    to: z.enum(ZONES),
    position: positionSchema.optional(),
    libraryPosition: libraryPositionSchema.optional(),
  }),
  z.object({ type: z.literal('tapCard'), instanceId: z.string(), tapped: z.boolean() }),
  /** Point at a card to show what a spell or ability is aimed at; clicking again takes the mark back. */
  z.object({ type: z.literal('toggleTarget'), instanceId: z.string() }),
  /** Multi-select versions: one batch, one undo. `positions` gives battlefield spots per card. */
  z.object({
    type: z.literal('moveCards'),
    instanceIds: z.array(z.string()).min(1).max(200),
    to: z.enum(ZONES),
    positions: z.record(z.string(), positionSchema).optional(),
    libraryPosition: libraryPositionSchema.optional(),
  }),
  z.object({ type: z.literal('tapCards'), instanceIds: z.array(z.string()).min(1).max(200), tapped: z.boolean() }),
  z.object({ type: z.literal('draw'), count: z.number().int().min(1).max(20) }),
  z.object({ type: z.literal('untapAll') }),
  z.object({ type: z.literal('shuffleLibrary') }),
  /** Sideboarding (before the opening hands): copies to bring in from the sideboard and copies to send out, by printing. */
  z.object({
    type: z.literal('sideboardSwap'),
    toMain: z.array(z.object({ printingId: z.string(), quantity: z.number().int().min(1).max(60) })).max(60),
    toSide: z.array(z.object({ printingId: z.string(), quantity: z.number().int().min(1).max(60) })).max(60),
  }),
  /** Done sideboarding; the hand is redrawn if anything changed. */
  z.object({ type: z.literal('finishSideboarding') }),
  /** Opening-hand mulligan (London): hand back, shuffle, draw seven again. */
  z.object({ type: z.literal('mulligan') }),
  /** Keep the opening hand, putting exactly one card per mulligan taken on the bottom. */
  z.object({ type: z.literal('keepHand'), bottom: z.array(z.string()).max(7) }),
  /** Owner re-deals the game (new libraries, hands, roll for first). */
  z.object({ type: z.literal('restart') }),
  /** The active player passes the turn to the next seat. */
  z.object({ type: z.literal('endTurn') }),
  /** The play button: do what this step does and move to the next one (ending the turn after the end step). With `to`, keep pressing it until that later step of the same turn. */
  z.object({ type: z.literal('advanceStep'), to: z.enum(['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end']).optional() }),
  /** Mark a permanent as not untapping: 'always', for n untap steps, or null to clear. */
  z.object({ type: z.literal('setNoUntap'), instanceId: z.string(), value: z.union([z.literal('always'), z.number().int().min(1).max(20), z.null()]) }),
  z.object({ type: z.literal('transformCard'), instanceId: z.string(), transformed: z.boolean() }),
  z.object({ type: z.literal('flipCard'), instanceId: z.string(), flipped: z.boolean() }),
  z.object({ type: z.literal('setFaceDown'), instanceId: z.string(), faceDown: z.boolean() }),
  z.object({ type: z.literal('addCounter'), instanceId: z.string(), kind: z.string().trim().min(1).max(32), delta: z.number().int().min(-99).max(99) }),
  z.object({ type: z.literal('attachCard'), instanceId: z.string(), to: z.string().nullable() }),
  // ---- visibility ----
  /** Reveal specific own cards (hand, library, face-down) to everyone or to given players. */
  z.object({ type: z.literal('revealCards'), instanceIds: z.array(z.string()).min(1).max(200), to: revealTargetSchema, until: z.enum(['dismissed', 'zoneChange']) }),
  z.object({ type: z.literal('revealHand'), to: revealTargetSchema }),
  z.object({ type: z.literal('revealTop'), count: z.number().int().min(1).max(200), to: revealTargetSchema }),
  /** Look at the top N privately (scry, surveil, search = whole library). */
  z.object({ type: z.literal('lookAtTop'), count: z.number().int().min(1).max(500) }),
  /** New order for the top cards; must be a permutation of the current top N. */
  z.object({ type: z.literal('reorderLibraryTop'), instanceIds: z.array(z.string()).min(1).max(500) }),
  /** New order for the whole hand (dragging a card to another place in it). */
  z.object({ type: z.literal('reorderHand'), instanceIds: z.array(z.string()).min(1).max(200) }),
  z.object({ type: z.literal('setTopRevealed'), enabled: z.boolean() }),
  /** Ends 'until dismissed' reveals on own cards (all of them, or the given ones). */
  z.object({ type: z.literal('dismissReveal'), instanceIds: z.array(z.string()).max(500).optional() }),
  // ---- players ----
  /** Anyone may change anyone's life; without playerId, their own. */
  z.object({ type: z.literal('adjustLife'), delta: z.number().int().min(-999).max(999), playerId: z.string().optional() }),
  /** Every card in hand to the graveyard, as one undoable action. */
  z.object({ type: z.literal('discardHand') }),
  /** Time Walk and friends: the named player (default: the actor) takes an extra turn right after the current one. */
  z.object({ type: z.literal('queueExtraTurn'), playerId: z.string().optional() }),
  z.object({ type: z.literal('cancelExtraTurn'), playerId: z.string().optional() }),
  z.object({ type: z.literal('adjustPoison'), delta: z.number().int().min(-99).max(99) }),
  /** Floating mana in the own pool; opening it shows the pool to everyone. */
  z.object({ type: z.literal('adjustMana'), symbol: z.enum(['W', 'U', 'B', 'R', 'G', 'C']), delta: z.number().int().min(-99).max(99) }),
  z.object({ type: z.literal('setManaPool'), open: z.boolean() }),
  z.object({ type: z.literal('emptyManaPool') }),
  z.object({ type: z.literal('adjustPlayerCounter'), kind: z.string().trim().min(1).max(32), delta: z.number().int().min(-999).max(999) }),
  z.object({ type: z.literal('adjustCommanderTax'), delta: z.number().int().min(-99).max(99) }),
  z.object({ type: z.literal('adjustCommanderDamage'), fromPlayerId: z.string(), delta: z.number().int().min(-99).max(99) }),
  z.object({ type: z.literal('rollDice'), sides: z.number().int().min(2).max(1000), count: z.number().int().min(1).max(20).default(1) }),
  z.object({ type: z.literal('flipCoin'), count: z.number().int().min(1).max(20).default(1) }),
  z.object({ type: z.literal('setNote'), instanceId: z.string(), note: z.string().trim().max(80).nullable() }),
  z.object({
    type: z.literal('createToken'),
    printingId: z.string().nullable(),
    customName: z.string().trim().min(1).max(40).nullable(),
    count: z.number().int().min(1).max(20),
    position: positionSchema.optional(),
  }),
  /** End the game (or deal a new one) once everyone confirms the outcome; `winners: null` = nobody won, do not track. */
  z.object({ type: z.literal('proposeResult'), winners: z.array(z.string()).max(4).nullable(), then: z.enum(['end', 'restart']) }),
  z.object({ type: z.literal('confirmResult') }),
  /** Withdraw or dispute the pending outcome. */
  z.object({ type: z.literal('rejectResult') }),
  /** Report the outcome of the current game: the winning players (a whole team in 2v2), none for a draw. May be repeated to correct. */
  z.object({ type: z.literal('reportResult'), winners: z.array(z.string()).max(4), note: z.string().trim().max(200).optional() }),
  // ---- draft ----
  ...draftCommandSchema.options,
]);

export type GameCommand = z.infer<typeof gameCommandSchema>;
export type GameCommandType = GameCommand['type'];
