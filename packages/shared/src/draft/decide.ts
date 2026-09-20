import type { DraftCommand } from './commands.js';
import type { DraftEvent } from './events.js';
import { cardsNeeded, gridLine, nextPile, usableLibrarians, type DraftCard, type DraftConfig, type DraftState } from './types.js';

export type DraftDecision = { ok: true; events: DraftEvent[] } | { ok: false; error: string };
const reject = (error: string): DraftDecision => ({ ok: false, error });

export interface DealContext {
  /** Pool per phase (already expanded to one entry per copy), in the phase order of the config. */
  pools: DraftCard[][];
  random: () => number;
  newId: () => string;
}

/** Deals every phase and round up front; the resulting event starts the draft. */
export function dealDraft(config: DraftConfig, seats: string[], ctx: DealContext): DraftDecision {
  if (seats.length !== config.seats) return reject(`This draft needs ${config.seats} players`);
  const packs: { id: string; phase: number; round: number; cards: DraftCard[] }[] = [];
  const dealt: string[][][][] = [];
  for (const [pi, phase] of config.phases.entries()) {
    const pool = shuffle(ctx.pools[pi] ?? [], ctx.random);
    const needed = cardsNeeded(config, phase);
    if (pool.length < needed) return reject(`Phase ${pi + 1} (${phase.name}) needs ${needed} cards but the pool has ${pool.length}`);
    if (phase.type === 'grid') {
      // One pack per grid, at seat 0 of its round.
      const rounds: string[][][] = [];
      for (let g = 0; g < phase.grids; g++) {
        const id = ctx.newId();
        const n = phase.size * phase.size;
        packs.push({ id, phase: pi, round: g, cards: pool.slice(g * n, (g + 1) * n) });
        rounds.push([[id], ...Array.from({ length: config.seats - 1 }, () => [] as string[])]);
      }
      dealt.push(rounds);
      continue;
    }
    if (phase.type === 'rotisserie') {
      // The whole table as one public pack at seat 0.
      const id = ctx.newId();
      packs.push({ id, phase: pi, round: 0, cards: pool.slice(0, phase.poolSize) });
      dealt.push([[[id], ...Array.from({ length: config.seats - 1 }, () => [] as string[])]]);
      continue;
    }
    if (phase.type === 'winston' || phase.type === 'winchester') {
      // One face-down stack, kept as a pack at seat 0; piles are seeded when the phase opens.
      const id = ctx.newId();
      packs.push({ id, phase: pi, round: 0, cards: pool.slice(0, phase.stackSize) });
      dealt.push([[[id], ...Array.from({ length: config.seats - 1 }, () => [] as string[])]]);
      continue;
    }
    let cursor = 0;
    const rounds: string[][][] = [];
    for (let r = 0; r < phase.rounds; r++) {
      const perSeat: string[][] = [];
      for (let s = 0; s < config.seats; s++) {
        const ids: string[] = [];
        for (let k = 0; k < phase.packsPerPlayer; k++) {
          const cards = pool.slice(cursor, cursor + phase.packSize);
          cursor += phase.packSize;
          const id = ctx.newId();
          packs.push({ id, phase: pi, round: r, cards });
          ids.push(id);
        }
        perSeat.push(ids);
      }
      rounds.push(perSeat);
    }
    dealt.push(rounds);
  }
  return { ok: true, events: [{ type: 'draftStarted', config, seats, packs, dealt }] };
}

/** Validates a draft command against the state. */
export function decideDraft(state: DraftState | null, command: DraftCommand, actorId: string): DraftDecision {
  if (!state) return reject('Draft is not running');
  const player = state.players[actorId];
  if (!player) return reject('Not in the draft');
  switch (command.type) {
    case 'submitDraftDeck': {
      if (state.status !== 'finished') return reject('The draft is still running');
      const pool = new Set(player.pool.map((c) => c.id));
      const main = [...new Set(command.main)];
      if (main.length === 0) return reject('Put at least one card in your main deck');
      if (main.some((id) => !pool.has(id))) return reject('Only cards from your own pool can go in the deck');
      const basics = command.basics.filter((b) => b.quantity > 0);
      return { ok: true, events: [{ type: 'draftDeckSubmitted', playerId: actorId, main, basics }] };
    }
    case 'winstonDecide': {
      if (state.status !== 'running') return reject('Draft is not running');
      const w = state.winston;
      const pack = w ? state.packs[w.packId] : undefined;
      if (!w || !pack) return reject('This is not a Winston phase');
      if (state.seats[w.activeSeat] !== actorId) return reject('Not your turn');
      const pile = w.piles[w.pileIndex] ?? [];
      if (pile.length === 0) return reject('Nothing to look at');
      if (command.take) return { ok: true, events: [{ type: 'winstonTaken', playerId: actorId, packId: pack.id, pileIndex: w.pileIndex, cards: pile.map(withIdentity) }] };
      const added = pack.cards[0] ?? null;
      const events: DraftEvent[] = [{ type: 'winstonPassed', playerId: actorId, packId: pack.id, pileIndex: w.pileIndex, addedCardId: added?.id ?? null }];
      // Passing on the last pile takes the next card of the stack blind, when there is one.
      const blind = pack.cards[1];
      if (nextPile(w.piles, w.pileIndex + 1) < 0 && blind) events.push({ type: 'winstonTaken', playerId: actorId, packId: pack.id, pileIndex: -1, cards: [withIdentity(blind)] });
      return { ok: true, events };
    }
    case 'rotisseriePick': {
      if (state.status !== 'running') return reject('Draft is not running');
      const r = state.rotisserie;
      const pack = r ? state.packs[r.packId] : undefined;
      if (!r || !pack) return reject('This is not a Rotisserie phase');
      if (state.seats[r.activeSeat] !== actorId) return reject('Not your turn');
      const card = pack.cards.find((c) => c.id === command.cardId);
      if (!card) return reject('That card is not on the table');
      return { ok: true, events: [{ type: 'rotisseriePicked', playerId: actorId, packId: pack.id, cardId: card.id, printingId: card.printingId, ...abilityOf(card) }] };
    }
    case 'winchesterTake': {
      if (state.status !== 'running') return reject('Draft is not running');
      const w = state.winchester;
      const pack = w ? state.packs[w.packId] : undefined;
      if (!w || !pack) return reject('This is not a Winchester phase');
      if (state.seats[w.activeSeat] !== actorId) return reject('Not your turn');
      const pile = w.piles[command.index];
      if (!pile) return reject('No such pile');
      if (pile.length === 0) return reject('That pile is empty');
      const added = pack.cards.slice(0, w.piles.length).map((c) => c.id);
      return { ok: true, events: [{ type: 'winchesterTaken', playerId: actorId, packId: pack.id, index: command.index, cards: pile.map(withIdentity), added }] };
    }
    case 'gridPick': {
      if (state.status !== 'running') return reject('Draft is not running');
      const g = state.grid;
      if (!g) return reject('This is not a Grid phase');
      if (state.seats[g.activeSeat] !== actorId) return reject('Not your turn');
      if (command.index >= g.size) return reject('No such line');
      const cards = gridLine(g.size, command.line, command.index).map((i) => g.cells[i]).filter((c): c is DraftCard => !!c);
      if (cards.length === 0) return reject('That line is empty');
      return { ok: true, events: [{ type: 'gridTaken', playerId: actorId, packId: g.packId, line: command.line, index: command.index, cards: cards.map(withIdentity) }] };
    }
    case 'draftPick': {
      if (state.status !== 'running') return reject('Draft is not running');
      const packId = player.queue[0];
      if (!packId) return reject('No pack to pick from — waiting for the pack to be passed');
      const pack = state.packs[packId]!;
      const card = pack.cards.find((c) => c.id === command.cardId);
      if (!card) return reject('That card is not in your current pack');
      const faceUp = (command.faceUp ?? false) || card.ability === 'librarian';
      if (!command.librarian) return { ok: true, events: [{ type: 'draftPicked', playerId: actorId, packId, cardId: card.id, printingId: card.printingId, ...abilityOf(card), faceUp, double: false }] };
      // Cogwork Librarian: take a second card from the same pack, and the Librarian goes into the pack instead.
      const librarian = usableLibrarians(state, actorId).find((c) => c.id === command.librarian!.cardId);
      if (!librarian) return reject('You have no Cogwork Librarian to spend on this pack');
      const second = pack.cards.find((c) => c.id === command.librarian!.secondCardId);
      if (!second || second.id === card.id) return reject('Choose a second, different card from the same pack');
      return {
        ok: true,
        events: [
          { type: 'draftPicked', playerId: actorId, packId, cardId: card.id, printingId: card.printingId, ...abilityOf(card), faceUp, double: false, holdPack: true },
          { type: 'draftPicked', playerId: actorId, packId, cardId: second.id, printingId: second.printingId, ...abilityOf(second), faceUp: second.ability === 'librarian', double: true, holdPack: true },
          { type: 'draftCardReturned', playerId: actorId, packId, cardId: librarian.id, printingId: librarian.printingId, ability: 'librarian' },
        ],
      };
    }
  }
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Spread into an event so the ability travels with the identity (absent keys keep the schema optional). */
function abilityOf(card: DraftCard): { ability?: DraftCard['ability'] } {
  return card.ability ? { ability: card.ability } : {};
}

/** A card as an event carries it (ability only when present, so the schema's optional key stays absent otherwise). */
function withIdentity(card: DraftCard): { id: string; printingId: string; ability?: DraftCard['ability'] } {
  return card.ability ? { id: card.id, printingId: card.printingId, ability: card.ability } : { id: card.id, printingId: card.printingId };
}
