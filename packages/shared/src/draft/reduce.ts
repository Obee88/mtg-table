import type { DraftEvent } from './events.js';
import { directionFor, nextSeat, type DraftAbility, type DraftCard, type DraftPlayer, type DraftState } from './types.js';

/** A card as carried in events (identity possibly stripped) into the state shape. */
function cardFrom(c: { id: string; printingId: string | null; ability?: DraftAbility | undefined }): DraftCard {
  return c.ability ? { id: c.id, printingId: c.printingId ?? '', ability: c.ability } : { id: c.id, printingId: c.printingId ?? '' };
}

/** Applies a draft event. Rounds and phases advance deterministically from the dealt layout. */
export function reduceDraft(state: DraftState | null, event: DraftEvent): DraftState | null {
  switch (event.type) {
    case 'draftStarted': {
      const packs = Object.fromEntries(event.packs.map((p) => [p.id, { ...p, cards: p.cards.map((c) => cardFrom(c)), taken: 0 }]));
      const players: Record<string, DraftPlayer> = Object.fromEntries(event.seats.map((id) => [id, { queue: [], pool: [], faceUp: [], picks: 0 }]));
      const s: DraftState = { config: event.config, seats: event.seats, phase: 0, round: 0, globalRound: 0, direction: event.config.startDirection, packs, dealt: event.dealt, players, picks: [], status: 'running', decks: {} };
      return openRound(s);
    }
    case 'draftPicked': {
      if (!state) return state;
      const pack = state.packs[event.packId];
      const player = state.players[event.playerId];
      if (!pack || !player) return state;
      const card = pack.cards.find((c) => c.id === event.cardId);
      if (!card) return state;
      const picked = cardFrom({ id: card.id, printingId: event.printingId ?? card.printingId, ability: event.ability ?? card.ability });
      // Librarians are always drafted face up; the projection may have blanked the ability for others.
      const faceUp = event.faceUp || picked.ability === 'librarian';
      const remaining = pack.cards.filter((c) => c.id !== event.cardId);
      const packs = { ...state.packs, [pack.id]: { ...pack, cards: remaining, taken: pack.taken + 1 } };
      const picks = [...state.picks, {
        n: state.picks.length + 1,
        phase: pack.phase,
        round: pack.round,
        packId: pack.id,
        playerId: event.playerId,
        card: picked,
        pickInPack: pack.taken + 1,
        packContents: pack.cards.map((c) => c.printingId),
        double: event.double,
        faceUp,
      }];
      const players = { ...state.players, [event.playerId]: { ...player, pool: [...player.pool, picked], faceUp: faceUp ? [...player.faceUp, picked] : player.faceUp, picks: player.picks + 1 } };
      const s: DraftState = { ...state, packs, players, picks };
      // The pack stays while the action continues (second pick, card returned); otherwise it passes on.
      return event.holdPack ? s : advance(passPack(s, event.playerId, pack.id));
    }
    case 'draftCardReturned': {
      if (!state) return state;
      const pack = state.packs[event.packId];
      const player = state.players[event.playerId];
      if (!pack || !player) return state;
      const known = player.pool.find((c) => c.id === event.cardId);
      const card = cardFrom({ id: event.cardId, printingId: event.printingId ?? known?.printingId ?? null, ability: event.ability ?? known?.ability });
      const packs = { ...state.packs, [pack.id]: { ...pack, cards: [...pack.cards, card] } };
      const players = { ...state.players, [event.playerId]: { ...player, pool: player.pool.filter((c) => c.id !== event.cardId), faceUp: player.faceUp.filter((c) => c.id !== event.cardId) } };
      return advance(passPack({ ...state, packs, players }, event.playerId, pack.id));
    }
    case 'draftDeckSubmitted':
      if (!state) return state;
      return { ...state, decks: { ...(state.decks ?? {}), [event.playerId]: { main: event.main, basics: event.basics } } };
  }
}

/** Removes the pack from the player's queue and hands it to the next seat (or retires it when empty). */
function passPack(s: DraftState, playerId: string, packId: string): DraftState {
  const seat = s.seats.indexOf(playerId);
  const player = s.players[playerId]!;
  const players = { ...s.players, [playerId]: { ...player, queue: player.queue.filter((id) => id !== packId) } };
  const pack = s.packs[packId]!;
  if (pack.cards.length === 0) return { ...s, players };
  const target = s.seats[nextSeat(s.seats.length, seat, s.direction)]!;
  const receiver = players[target]!;
  return { ...s, players: { ...players, [target]: { ...receiver, queue: [...receiver.queue, packId] } } };
}

/** When no pack with cards remains in play, open the next round (or phase), or finish. */
function advance(s: DraftState): DraftState {
  const live = Object.values(s.players).some((p) => p.queue.some((id) => (s.packs[id]?.cards.length ?? 0) > 0));
  if (live) return s;
  const phaseCfg = s.config.phases[s.phase]!;
  let phase = s.phase;
  let round = s.round + 1;
  if (round >= phaseCfg.rounds) {
    phase += 1;
    round = 0;
  }
  if (phase >= s.config.phases.length) return { ...s, status: 'finished', players: clearQueues(s.players) };
  return openRound({ ...s, phase, round, globalRound: s.globalRound + 1, players: clearQueues(s.players) });
}

function clearQueues(players: Record<string, DraftPlayer>): Record<string, DraftPlayer> {
  return Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { ...p, queue: [] }]));
}

/** Hands every seat its dealt packs for the current phase/round and sets the direction. */
function openRound(s: DraftState): DraftState {
  const phaseCfg = s.config.phases[s.phase]!;
  const direction = directionFor(s.config, phaseCfg, s.globalRound);
  const seatsPacks = s.dealt[s.phase]?.[s.round] ?? [];
  const players = { ...s.players };
  s.seats.forEach((id, seat) => {
    players[id] = { ...players[id]!, queue: [...(seatsPacks[seat] ?? [])] };
  });
  return { ...s, direction, players };
}
