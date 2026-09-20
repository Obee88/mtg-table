import type { DraftEvent } from './events.js';
import type { DraftState } from './types.js';

/**
 * The draft as `viewerId` may see it: only the pack at their hand is readable;
 * every other pack (queued behind it, at other seats, or unopened) has its
 * card identities stripped; pools are private except face-up picks; the pick
 * log is withheld until the draft finishes.
 */
export function projectDraft(state: DraftState, viewerId: string): DraftState {
  const mine = state.players[viewerId];
  const readable = new Set<string>(mine?.queue[0] ? [mine.queue[0]] : []);
  const packs = Object.fromEntries(
    Object.entries(state.packs).map(([id, p]) => [id, readable.has(id) ? p : { ...p, cards: p.cards.map((c) => ({ id: c.id, printingId: '' })) }]),
  );
  const players = Object.fromEntries(
    Object.entries(state.players).map(([id, p]) => [id, id === viewerId ? p : { ...p, pool: p.pool.map((c) => ({ id: c.id, printingId: '' })) }]),
  );
  return { ...state, packs, players, picks: state.status === 'finished' ? state.picks : state.picks.filter((r) => r.playerId === viewerId) };
}

/** Projects one draft event: `draftStarted` strips every pack; `draftPicked` hides the identity from non-owners unless face up. */
export function projectDraftEvent(event: DraftEvent, viewerId: string): DraftEvent {
  switch (event.type) {
    case 'draftStarted':
      return { ...event, packs: event.packs.map((p) => ({ ...p, cards: p.cards.map((c) => ({ id: c.id, printingId: null })) })) };
    case 'draftPicked':
      return event.playerId === viewerId || event.faceUp ? event : { ...event, printingId: null };
  }
}
