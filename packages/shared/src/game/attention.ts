import { allDecksSubmitted } from '../draft/types.js';
import { inMulligan, inSideboarding, isActive, seatedPlayers, type RoomState } from './types.js';

/** What a room is waiting on from one player, if anything; shown on the Play home and used for attention cues. */
export type Attention =
  | 'choose a deck'
  | 'ready up'
  | 'start the game'
  | 'your pick'
  | 'build your deck'
  | 'start the draft game'
  | 'sideboard'
  | 'keep or mulligan'
  | 'confirm the result'
  | 'your turn';

export function attentionFor(state: RoomState, playerId: string): Attention | null {
  const me = state.players[playerId];
  if (!me) return null;
  const owner = state.ownerId === playerId;
  switch (state.phase) {
    case 'lobby': {
      if (!me.deckId && !state.settings.draft && state.draft?.status !== 'finished') return 'choose a deck';
      if (!me.ready) return 'ready up';
      const players = seatedPlayers(state);
      if (owner && players.length === state.settings.playerCount && players.every((p) => p.ready)) return 'start the game';
      return null;
    }
    case 'drafting': {
      const d = state.draft;
      if (!d) return null;
      const seat = d.seats.indexOf(playerId);
      const active = d.winston?.activeSeat ?? d.grid?.activeSeat ?? d.winchester?.activeSeat ?? d.rotisserie?.activeSeat;
      if (active !== undefined) return active === seat ? 'your pick' : null;
      return (d.players[playerId]?.queue.length ?? 0) > 0 ? 'your pick' : null;
    }
    case 'deckbuilding': {
      const d = state.draft;
      if (!d) return null;
      if (!d.decks?.[playerId]) return 'build your deck';
      return owner && allDecksSubmitted(d) ? 'start the draft game' : null;
    }
    case 'playing': {
      const g = state.game;
      if (!g) return null;
      // A proposed outcome pauses the game: it is either yours to confirm, or waiting for the others.
      if (g.pendingResult) return g.pendingResult.confirmed.includes(playerId) ? null : 'confirm the result';
      if (inSideboarding(g)) return g.sideboarding?.[playerId]?.done ? null : 'sideboard';
      if (inMulligan(g)) return g.mulligans[playerId]?.kept ? null : 'keep or mulligan';
      return isActive(state, playerId) ? 'your turn' : null;
    }
    default:
      return null;
  }
}

/** Why the host cannot start yet, in plain words; empty when everyone is seated and ready. */
export function startBlockers(state: RoomState): string[] {
  const out: string[] = [];
  const players = seatedPlayers(state);
  const missing = state.settings.playerCount - players.length;
  if (missing > 0) out.push(`${missing} seat${missing === 1 ? ' is' : 's are'} empty`);
  const needDeck = !state.settings.draft && state.draft?.status !== 'finished';
  for (const p of players) {
    if (needDeck && !p.deckId) out.push(`Waiting for ${p.displayName} to choose a deck`);
    else if (!p.ready) out.push(`Waiting for ${p.displayName} to be ready`);
  }
  return out;
}
