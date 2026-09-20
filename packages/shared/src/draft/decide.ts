import type { DraftCommand } from './commands.js';
import type { DraftEvent } from './events.js';
import { cardsNeeded, type DraftCard, type DraftConfig, type DraftState } from './types.js';

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
  if (!state || state.status !== 'running') return reject('Draft is not running');
  const player = state.players[actorId];
  if (!player) return reject('Not in the draft');
  switch (command.type) {
    case 'draftPick': {
      const packId = player.queue[0];
      if (!packId) return reject('No pack to pick from — waiting for the pack to be passed');
      const pack = state.packs[packId]!;
      const card = pack.cards.find((c) => c.id === command.cardId);
      if (!card) return reject('That card is not in your current pack');
      return { ok: true, events: [{ type: 'draftPicked', playerId: actorId, packId, cardId: card.id, printingId: card.printingId, faceUp: command.faceUp ?? false, double: false }] };
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
