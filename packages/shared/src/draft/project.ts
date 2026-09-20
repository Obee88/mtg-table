import type { DraftEvent } from './events.js';
import type { DraftCard, DraftState } from './types.js';

/**
 * Draft cards `viewerId` may currently identify: the pack at their hand, their
 * own pool, and everyone's face-up picks. Everything else — packs queued
 * behind, packs at other seats, unopened packs, others' pools — is hidden.
 */
export function visibleDraftCards(state: DraftState, viewerId: string): Map<string, string> {
  const out = new Map<string, string>();
  const mine = state.players[viewerId];
  const atHand = mine?.queue[0] ? state.packs[mine.queue[0]] : undefined;
  for (const c of atHand?.cards ?? []) out.set(c.id, c.printingId);
  for (const c of mine?.pool ?? []) out.set(c.id, c.printingId);
  for (const p of Object.values(state.players)) for (const c of p.faceUp) out.set(c.id, c.printingId);
  return out;
}

/**
 * The draft as `viewerId` may see it: card identities outside
 * `visibleDraftCards` are blank. Others' pick records keep their numbering but
 * lose the card (unless face up) and the pack contents; the full log is served
 * separately once the draft is over.
 */
export function projectDraft(state: DraftState, viewerId: string): DraftState {
  const visible = visibleDraftCards(state, viewerId);
  const mask = (c: DraftCard): DraftCard => (visible.has(c.id) ? c : { id: c.id, printingId: '' });
  const packs = Object.fromEntries(Object.entries(state.packs).map(([id, p]) => [id, { ...p, cards: p.cards.map(mask) }]));
  const players = Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { ...p, pool: p.pool.map(mask), faceUp: p.faceUp.map(mask) }]));
  const picks = state.picks.map((r) => (r.playerId === viewerId ? r : { ...r, card: mask(r.card), packContents: r.packContents.map(() => '') }));
  return { ...state, packs, players, picks };
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

/** Client-side: sets or blanks card identities wherever those cards currently sit (packs, pools, face-up lists). */
export function applyDraftIdentities(state: DraftState, revealed: readonly { cardId: string; printingId: string }[], hidden: readonly string[]): DraftState {
  if (revealed.length === 0 && hidden.length === 0) return state;
  const ids = new Map<string, string>();
  for (const r of revealed) ids.set(r.cardId, r.printingId);
  for (const id of hidden) ids.set(id, '');
  const fix = (c: DraftCard): DraftCard => (ids.has(c.id) ? { id: c.id, printingId: ids.get(c.id)! } : c);
  const packs = Object.fromEntries(Object.entries(state.packs).map(([id, p]) => [id, { ...p, cards: p.cards.map(fix) }]));
  const players = Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, { ...p, pool: p.pool.map(fix), faceUp: p.faceUp.map(fix) }]));
  const picks = state.picks.map((r) => ({ ...r, card: fix(r.card) }));
  return { ...state, packs, players, picks };
}
