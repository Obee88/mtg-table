import type { RoomEvent } from '@mtg/shared';

/** Merges backfilled history with the live buffer: unique by seq, ascending. */
export function mergeEvents(history: readonly RoomEvent[], live: readonly RoomEvent[]): RoomEvent[] {
  const bySeq = new Map<number, RoomEvent>();
  for (const e of history) bySeq.set(e.seq, e);
  for (const e of live) bySeq.set(e.seq, e);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** Players whose area an event touches, for change highlights. */
export function touchedPlayers(e: RoomEvent, cardOwner: (instanceId: string) => string | undefined): string[] {
  const ev = e.event;
  const out = new Set<string>();
  if (e.actorId) out.add(e.actorId);
  switch (ev.type) {
    case 'cardMoved':
    case 'cardTapped':
    case 'cardTransformed':
    case 'cardFlipped':
    case 'cardFaceDownChanged':
    case 'cardAttached':
    case 'noteChanged':
    case 'visibilityChanged': {
      const owner = cardOwner(ev.instanceId);
      if (owner) out.add(owner);
      break;
    }
    case 'counterChanged':
      if (ev.target.type === 'player') out.add(ev.target.playerId);
      else {
        const owner = cardOwner(ev.target.instanceId);
        if (owner) out.add(owner);
      }
      break;
    case 'lifeChanged':
      if (ev.target.type === 'player') out.add(ev.target.playerId);
      break;
    case 'poisonChanged':
    case 'commanderTaxChanged':
    case 'commanderDamageChanged':
    case 'libraryShuffled':
    case 'libraryReordered':
    case 'topRevealedChanged':
    case 'diceRolled':
    case 'coinFlipped':
      out.add(ev.playerId);
      break;
    case 'tokenCreated':
      out.add(ev.controllerId);
      break;
  }
  return [...out];
}
