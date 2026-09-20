import type { DraftEvent } from './events.js';
import { directionFor, nextPile, nextSeat, roundsOf, type DraftAbility, type DraftCard, type DraftPlayer, type DraftState, type PickRecord } from './types.js';

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
      const s: DraftState = { config: event.config, seats: event.seats, phase: 0, round: 0, globalRound: 0, direction: event.config.startDirection, packs, dealt: event.dealt, players, picks: [], status: 'running', winston: null, decks: {} };
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
    case 'winstonTaken': {
      if (!state?.winston) return state;
      const w = state.winston;
      const pack = state.packs[event.packId];
      const player = state.players[event.playerId];
      if (!pack || !player) return state;
      const known = new Map([...(w.piles[event.pileIndex] ?? []), ...pack.cards].map((c) => [c.id, c]));
      const cards = event.cards.map((c) => cardFrom({ id: c.id, printingId: c.printingId ?? known.get(c.id)?.printingId ?? null, ability: c.ability ?? known.get(c.id)?.ability }));
      const taken = new Set(cards.map((c) => c.id));
      let stack = pack.cards.filter((c) => !taken.has(c.id));
      const piles = w.piles.map((p) => p.filter((c) => !taken.has(c.id)));
      // A taken pile is re-seeded from the stack while it lasts.
      if (event.pileIndex >= 0 && event.pileIndex < piles.length && stack.length > 0) {
        piles[event.pileIndex] = [stack[0]!];
        stack = stack.slice(1);
      }
      const contents = cards.map((c) => c.printingId);
      const records: PickRecord[] = cards.map((card, i) => ({
        n: state.picks.length + 1 + i, phase: pack.phase, round: pack.round, packId: pack.id, playerId: event.playerId, card,
        pickInPack: 1, packContents: contents, double: i > 0, faceUp: false,
      }));
      const players = { ...state.players, [event.playerId]: { ...player, pool: [...player.pool, ...cards], picks: player.picks + cards.length } };
      const packs = { ...state.packs, [pack.id]: { ...pack, cards: stack, taken: pack.taken + cards.length } };
      const activeSeat = nextSeat(state.seats.length, state.seats.indexOf(event.playerId), 'left');
      return advance({ ...state, packs, players, picks: [...state.picks, ...records], winston: { ...w, piles, activeSeat, pileIndex: Math.max(0, nextPile(piles, 0)) } });
    }
    case 'winstonPassed': {
      if (!state?.winston) return state;
      const w = state.winston;
      const pack = state.packs[event.packId];
      if (!pack) return state;
      let stack = pack.cards;
      const piles = w.piles.map((p) => [...p]);
      if (event.addedCardId && event.pileIndex >= 0 && event.pileIndex < piles.length) {
        const added = stack.find((c) => c.id === event.addedCardId);
        if (added) {
          piles[event.pileIndex]!.push(added);
          stack = stack.filter((c) => c.id !== added.id);
        }
      }
      let pileIndex = nextPile(piles, event.pileIndex + 1);
      let activeSeat = w.activeSeat;
      if (pileIndex < 0) {
        // Nothing left to look at: the turn passes (a blind take from the stack, if any, follows as its own event).
        activeSeat = nextSeat(state.seats.length, state.seats.indexOf(event.playerId), 'left');
        pileIndex = Math.max(0, nextPile(piles, 0));
      }
      return { ...state, packs: { ...state.packs, [pack.id]: { ...pack, cards: stack } }, winston: { ...w, piles, activeSeat, pileIndex } };
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

/** When nothing is left to draft in the current round, open the next round (or phase), or finish. */
function advance(s: DraftState): DraftState {
  const phaseCfg = s.config.phases[s.phase]!;
  const live = phaseCfg.type === 'winston'
    ? (s.packs[s.winston?.packId ?? '']?.cards.length ?? 0) > 0 || (s.winston?.piles.some((p) => p.length > 0) ?? false)
    : Object.values(s.players).some((p) => p.queue.some((id) => (s.packs[id]?.cards.length ?? 0) > 0));
  if (live) return s;
  let phase = s.phase;
  let round = s.round + 1;
  if (round >= roundsOf(phaseCfg)) {
    phase += 1;
    round = 0;
  }
  if (phase >= s.config.phases.length) return { ...s, status: 'finished', winston: null, players: clearQueues(s.players) };
  return openRound({ ...s, phase, round, globalRound: s.globalRound + 1, players: clearQueues(s.players) });
}

function clearQueues(players: Record<string, DraftPlayer>): Record<string, DraftPlayer> {
  return Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { ...p, queue: [] }]));
}

/** Opens the current phase/round: packs to every seat (pick and pass) or the stack and seeded piles (Winston). */
function openRound(s: DraftState): DraftState {
  const phaseCfg = s.config.phases[s.phase]!;
  const direction = directionFor(s.config, phaseCfg, s.globalRound);
  if (phaseCfg.type === 'winston') {
    const packId = s.dealt[s.phase]?.[0]?.[0]?.[0];
    const pack = packId ? s.packs[packId] : undefined;
    if (!packId || !pack) return { ...s, direction, winston: null };
    const piles = Array.from({ length: phaseCfg.piles }, (_, i) => (pack.cards[i] ? [pack.cards[i]!] : []));
    const stack = pack.cards.slice(phaseCfg.piles);
    // The first Winston phase starts with seat 0; later ones with whoever did not start the previous.
    const activeSeat = s.globalRound % s.seats.length;
    return { ...s, direction, packs: { ...s.packs, [packId]: { ...pack, cards: stack } }, winston: { packId, piles, activeSeat, pileIndex: Math.max(0, nextPile(piles, 0)) } };
  }
  const seatsPacks = s.dealt[s.phase]?.[s.round] ?? [];
  const players = { ...s.players };
  s.seats.forEach((id, seat) => {
    players[id] = { ...players[id]!, queue: [...(seatsPacks[seat] ?? [])] };
  });
  return { ...s, direction, players, winston: null };
}
