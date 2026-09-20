import { applyDraftIdentities, projectDraft, projectDraftEvent, visibleDraftCards } from '../draft/project.js';
import type { GameEvent, RoomEvent } from './events.js';
import { reduce } from './reduce.js';
import type { CardInstance, PlayerId, RoomState } from './types.js';

/** Whether `viewerId` may know the identity of `card`. */
export function canSee(state: RoomState, card: CardInstance, viewerId: PlayerId): boolean {
  if (card.visibleTo === 'all') return true;
  // "Play with the top card revealed": index 0 of that library is public.
  if (card.zone === 'library' && state.game?.players[card.ownerId]?.topRevealed && state.game.players[card.ownerId]?.zones.library[0] === card.id) return true;
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
  const draft = state.draft ? projectDraft(state.draft, viewerId) : (state.draft ?? null);
  if (!state.game) return { ...state, draft };
  const cards: Record<string, CardInstance> = {};
  for (const card of Object.values(state.game.cards)) {
    cards[card.id] = canSee(state, card, viewerId) ? card : { ...card, printingId: null, note: null };
  }
  return { ...state, game: { ...state.game, cards }, draft };
}

export interface Revealed {
  instanceId: string;
  printingId: string;
}

/**
 * Projects one stored event for a viewer. `before`/`after` are the full states
 * around the event. Identities inside the payload are stripped where the
 * viewer may not see them; identities that became visible are attached as
 * `revealed`, and cards that just became hidden as `hidden`, so the viewer's
 * client state always equals `projectState` of the full state.
 */
export function projectEvent(stored: RoomEvent, viewerId: PlayerId, before: RoomState, after: RoomState): RoomEvent {
  const event = projectPayload(stored.event, viewerId, after);
  const revealed: Revealed[] = [];
  const hidden: string[] = [];
  if (after.game) {
    for (const card of Object.values(after.game.cards)) {
      const prev = before.game?.cards[card.id];
      if (!prev) continue; // new cards carry their identity in the payload when visible
      const wasVisible = canSee(before, prev, viewerId);
      const isVisible = canSee(after, card, viewerId);
      if (!wasVisible && isVisible && card.printingId) revealed.push({ instanceId: card.id, printingId: card.printingId });
      if (wasVisible && !isVisible) hidden.push(card.id);
    }
  }
  const out: RoomEvent = { seq: stored.seq, actorId: stored.actorId, at: stored.at, event };
  if (revealed.length > 0) out.revealed = revealed;
  if (hidden.length > 0) out.hidden = hidden;
  if (after.draft) {
    const was = before.draft ? visibleDraftCards(before.draft, viewerId) : new Map<string, string>();
    const now = visibleDraftCards(after.draft, viewerId);
    const draftRevealed = [...now.values()].filter((c) => !was.has(c.id)).map((c) => (c.ability ? { cardId: c.id, printingId: c.printingId, ability: c.ability } : { cardId: c.id, printingId: c.printingId }));
    const draftHidden = [...was.keys()].filter((id) => !now.has(id));
    if (draftRevealed.length > 0) out.draftRevealed = draftRevealed;
    if (draftHidden.length > 0) out.draftHidden = draftHidden;
  }
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
    case 'libraryShuffled': {
      // Re-keyed cards are new to the viewer, so nothing in `revealed` covers them: keep the identity of
      // any the viewer may see afterwards (the top card when it is played revealed).
      const game = after.game;
      return {
        ...event,
        cards: event.cards.map((c) => {
          const card = game?.cards[c.id];
          return card && canSee(after, card, viewerId) ? { id: c.id, printingId: c.printingId, previousId: null } : { id: c.id, printingId: null, previousId: null };
        }),
      };
    }
    case 'actionUndone':
      return { ...event, state: projectState(event.state, viewerId) };
    case 'draftStarted':
    case 'draftPicked':
    case 'draftCardReturned':
    case 'draftDeckSubmitted':
    case 'winstonTaken':
    case 'winstonPassed':
    case 'gridTaken':
    case 'winchesterTaken':
    case 'rotisseriePicked':
      return projectDraftEvent(event, viewerId);
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

/** Client-side apply: reduce, then apply revealed/hidden identities. Skips already-applied seqs. */
export function applyRoomEvent(state: RoomState, e: RoomEvent): RoomState {
  if (e.seq <= state.seq) return state;
  let next = { ...reduce(state, e.event), seq: e.seq };
  if ((e.revealed || e.hidden) && next.game) {
    const cards = { ...next.game.cards };
    for (const r of e.revealed ?? []) {
      const card = cards[r.instanceId];
      if (card) cards[r.instanceId] = { ...card, printingId: r.printingId };
    }
    for (const id of e.hidden ?? []) {
      const card = cards[id];
      if (card) cards[id] = { ...card, printingId: null, note: null };
    }
    next = { ...next, game: { ...next.game, cards } };
  }
  if ((e.draftRevealed || e.draftHidden) && next.draft) {
    next = { ...next, draft: applyDraftIdentities(next.draft, e.draftRevealed ?? [], e.draftHidden ?? []) };
  }
  return next;
}
