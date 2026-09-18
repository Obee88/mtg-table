import type { GameEvent, RoomEvent } from './events.js';
import { reduce } from './reduce.js';
import type { CardInstance, PlayerId, RoomState } from './types.js';

/** Whether `viewerId` may know the identity of `card`. */
export function canSee(state: RoomState, card: CardInstance, viewerId: PlayerId): boolean {
  if (card.visibleTo === 'all') return true;
  if (card.visibleTo === 'owner') return viewerId === card.ownerId || isTeammate(state, viewerId, card.ownerId);
  return card.visibleTo.includes(viewerId);
}

function isTeammate(state: RoomState, a: PlayerId, b: PlayerId): boolean {
  if (state.settings.mode !== '2v2' || a === b) return false;
  const pa = state.players[a];
  const pb = state.players[b];
  return !!pa && !!pb && pa.team === pb.team;
}

/** The state as `viewerId` is allowed to see it: hidden cards lose their identity and note. */
export function projectState(state: RoomState, viewerId: PlayerId): RoomState {
  if (!state.game) return state;
  const cards: RoomState['game'] extends null ? never : Record<string, CardInstance> = {};
  for (const card of Object.values(state.game.cards)) {
    cards[card.id] = canSee(state, card, viewerId) ? card : { ...card, printingId: null, note: null };
  }
  return { ...state, game: { ...state.game, cards } };
}

export interface Revealed {
  instanceId: string;
  printingId: string;
}

/**
 * Projects one stored event for a viewer. `before`/`after` are the full states
 * around the event. Identities inside the payload are stripped where the
 * viewer may not see them; identities that became visible are attached as
 * `revealed` so the viewer's client can fill them in.
 */
export function projectEvent(stored: RoomEvent, viewerId: PlayerId, before: RoomState, after: RoomState): RoomEvent {
  const event = projectPayload(stored.event, viewerId, after);
  const revealed: Revealed[] = [];
  if (after.game) {
    for (const card of Object.values(after.game.cards)) {
      if (!card.printingId || !canSee(after, card, viewerId)) continue;
      const prev = before.game?.cards[card.id];
      const wasVisible = prev ? canSee(before, prev, viewerId) : false;
      // Newly created cards carry their identity in the payload when visible; only report transitions.
      if (prev && !wasVisible) revealed.push({ instanceId: card.id, printingId: card.printingId });
    }
  }
  const out: RoomEvent = { seq: stored.seq, actorId: stored.actorId, at: stored.at, event };
  if (revealed.length > 0) out.revealed = revealed;
  return out;
}

function projectPayload(event: GameEvent, viewerId: PlayerId, after: RoomState): GameEvent {
  switch (event.type) {
    case 'gameStarted': {
      if (!after.game) return event;
      const game = after.game;
      const strip = (cards: { id: string; printingId: string | null }[]) =>
        cards.map((c) => {
          const card = game.cards[c.id];
          return card && canSee(after, card, viewerId) ? c : { id: c.id, printingId: null };
        });
      return {
        ...event,
        players: Object.fromEntries(
          Object.entries(event.players).map(([pid, layout]) => [
            pid,
            { library: strip(layout.library), hand: strip(layout.hand), command: strip(layout.command), sideboard: strip(layout.sideboard) },
          ]),
        ),
      };
    }
    case 'libraryShuffled':
      return { ...event, cards: event.cards.map((c) => ({ id: c.id, printingId: null, previousId: null })) };
    default:
      return event;
  }
}

/** Projects a batch of consecutive events, threading the full state through them. */
export function projectEvents(events: readonly RoomEvent[], viewerId: PlayerId, stateBefore: RoomState): RoomEvent[] {
  let before = stateBefore;
  const out: RoomEvent[] = [];
  for (const e of events) {
    const after = { ...reduce(before, e.event), seq: e.seq };
    out.push(projectEvent(e, viewerId, before, after));
    before = after;
  }
  return out;
}

/** Client-side apply: reduce, then fill in identities the server revealed. Skips already-applied seqs. */
export function applyRoomEvent(state: RoomState, e: RoomEvent): RoomState {
  if (e.seq <= state.seq) return state;
  let next = { ...reduce(state, e.event), seq: e.seq };
  if (e.revealed && next.game) {
    const cards = { ...next.game.cards };
    for (const r of e.revealed) {
      const card = cards[r.instanceId];
      if (card) cards[r.instanceId] = { ...card, printingId: r.printingId };
    }
    next = { ...next, game: { ...next.game, cards } };
  }
  return next;
}
