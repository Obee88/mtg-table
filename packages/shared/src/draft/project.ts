import type { DraftEvent } from './events.js';
import type { DraftCard, DraftState } from './types.js';

/**
 * Draft cards `viewerId` may currently identify: the pack at their hand, their
 * own pool, and everyone's face-up picks. Everything else — packs queued
 * behind, packs at other seats, unopened packs, others' pools — is hidden.
 */
export function visibleDraftCards(state: DraftState, viewerId: string): Map<string, DraftCard> {
  const out = new Map<string, DraftCard>();
  const mine = state.players[viewerId];
  const atHand = mine?.queue[0] ? state.packs[mine.queue[0]] : undefined;
  for (const c of atHand?.cards ?? []) out.set(c.id, c);
  for (const c of mine?.pool ?? []) out.set(c.id, c);
  for (const p of Object.values(state.players)) for (const c of p.faceUp) out.set(c.id, c);
  return out;
}

const blank = (c: DraftCard): DraftCard => ({ id: c.id, printingId: '' });

/**
 * The draft as `viewerId` may see it: card identities (and abilities) outside
 * `visibleDraftCards` are blank. Others' pick records keep their numbering but
 * lose the card (unless picked face up) and the pack contents; the full log is served
 * separately once the draft is over.
 */
export function projectDraft(state: DraftState, viewerId: string): DraftState {
  const visible = visibleDraftCards(state, viewerId);
  const mask = (c: DraftCard): DraftCard => (visible.has(c.id) ? c : blank(c));
  const packs = Object.fromEntries(Object.entries(state.packs).map(([id, p]) => [id, { ...p, cards: p.cards.map(mask) }]));
  const players = Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { ...p, pool: p.pool.map(mask), faceUp: p.faceUp.map(mask) }]));
  const picks = state.picks.map((r) => (r.playerId === viewerId ? r : { ...r, card: r.faceUp ? r.card : blank(r.card), packContents: r.packContents.map(() => '') }));
  // Others' decks: only the fact that they were submitted.
  const decks = Object.fromEntries(Object.entries(state.decks ?? {}).map(([id, d]) => [id, id === viewerId ? d : { main: [], basics: [] }]));
  return { ...state, packs, players, picks, decks };
}

/**
 * Projects one draft event: `draftStarted` strips every pack; a pick or a
 * returned card keeps its identity for the actor and when face up (a returned
 * Librarian is public: it was face up and goes into a pack face up).
 */
export function projectDraftEvent(event: DraftEvent, viewerId: string): DraftEvent {
  switch (event.type) {
    case 'draftStarted':
      return { ...event, packs: event.packs.map((p) => ({ ...p, cards: p.cards.map((c) => ({ id: c.id, printingId: null })) })) };
    case 'draftPicked':
      if (event.playerId === viewerId || event.faceUp) return event;
      return stripAbility({ ...event, printingId: null });
    case 'draftCardReturned':
      return event;
    case 'draftDeckSubmitted':
      return event.playerId === viewerId ? event : { ...event, main: [], basics: [] };
  }
}

export interface DraftReveal {
  cardId: string;
  printingId: string;
  ability?: DraftCard['ability'];
}

/** Client-side: sets or blanks card identities wherever those cards currently sit (packs, pools, face-up lists). Pick records are history and keep what their events carried. */
export function applyDraftIdentities(state: DraftState, revealed: readonly DraftReveal[], hidden: readonly string[]): DraftState {
  if (revealed.length === 0 && hidden.length === 0) return state;
  const ids = new Map<string, DraftCard | null>();
  for (const r of revealed) ids.set(r.cardId, r.ability ? { id: r.cardId, printingId: r.printingId, ability: r.ability } : { id: r.cardId, printingId: r.printingId });
  for (const id of hidden) ids.set(id, null);
  const fix = (c: DraftCard): DraftCard => (ids.has(c.id) ? (ids.get(c.id) ?? blank(c)) : c);
  const packs = Object.fromEntries(Object.entries(state.packs).map(([id, p]) => [id, { ...p, cards: p.cards.map(fix) }]));
  const players = Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { ...p, pool: p.pool.map(fix), faceUp: p.faceUp.map(fix) }]));
  return { ...state, packs, players };
}

function stripAbility<T extends { ability?: DraftCard['ability'] }>(event: T): T {
  const { ability: _ability, ...rest } = event;
  return rest as T;
}
