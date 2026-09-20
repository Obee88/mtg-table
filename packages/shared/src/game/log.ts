import type { RoomEvent } from './events.js';
import type { RoomState } from './types.js';

export interface LogContext {
  /** Display name for a player id. */
  playerName: (playerId: string) => string;
  /** Name of a card instance as the viewer knows it (null when hidden). */
  cardName: (instanceId: string) => string | null;
  /** Name of a printing (draft picks name cards by printing, not instance). */
  printingName?: (printingId: string) => string | undefined;
}

const ZONE_LABEL: Record<string, string> = {
  library: 'the library', hand: 'hand', battlefield: 'the battlefield', graveyard: 'the graveyard', exile: 'exile', command: 'the command zone', sideboard: 'the sideboard', stack: 'the stack',
};

export function logContextFor(state: RoomState, printingName: (printingId: string) => string | undefined): LogContext {
  return {
    printingName,
    playerName: (id) => state.players[id]?.displayName ?? 'Someone',
    cardName: (id) => {
      const card = state.game?.cards[id];
      if (!card) return null;
      if (card.customName) return card.customName;
      return card.printingId ? (printingName(card.printingId) ?? null) : null;
    },
  };
}

/** One human-readable line per event, from the viewer's perspective (hidden cards stay "a card"). */
export function describeEvent(e: RoomEvent, ctx: LogContext): string | null {
  const actor = e.actorId ? ctx.playerName(e.actorId) : 'Someone';
  const card = (id: string) => ctx.cardName(id) ?? 'a card';
  const ev = e.event;
  switch (ev.type) {
    case 'roomCreated':
      return `${ctx.playerName(ev.ownerId)} created the room`;
    case 'settingsChanged':
      return `${actor} changed the room settings`;
    case 'playerJoined':
      return `${ev.displayName} took seat ${ev.seat + 1}`;
    case 'seatChanged':
      return `${ctx.playerName(ev.playerId)} moved to seat ${ev.seat + 1}`;
    case 'playerLeft':
      return `${ctx.playerName(ev.playerId)} left`;
    case 'deckSelected':
      return `${ctx.playerName(ev.playerId)} ${ev.deckId ? 'chose a deck' : 'removed their deck'}`;
    case 'readyChanged':
      return `${ctx.playerName(ev.playerId)} is ${ev.ready ? 'ready' : 'not ready'}`;
    case 'roomClosed':
      return `${actor} closed the room`;
    case 'gameStarted': {
      const rolls = Object.entries(ev.openingRoll).map(([id, n]) => `${ctx.playerName(id)} ${n}`).join(', ');
      return `Game started — rolls: ${rolls}. ${ctx.playerName(ev.firstPlayerId)} goes first`;
    }
    case 'cardMoved':
      if (ev.from === 'library' && ev.to === 'hand') return `${actor} drew ${card(ev.instanceId)}`;
      if (ev.to === 'stack') return `${actor} cast ${card(ev.instanceId)}`;
      if (ev.from === ev.to) return null; // repositioning is noise
      if (ev.to === 'library') return `${actor} put ${card(ev.instanceId)} on the ${ev.libraryPosition ?? 'top'} of ${ZONE_LABEL.library}`;
      return `${actor} moved ${card(ev.instanceId)} from ${ZONE_LABEL[ev.from]} to ${ZONE_LABEL[ev.to]}`;
    case 'cardTapped':
      return `${actor} ${ev.tapped ? 'tapped' : 'untapped'} ${card(ev.instanceId)}`;
    case 'cardTransformed':
      return `${actor} ${ev.transformed ? 'transformed' : 'transformed back'} ${card(ev.instanceId)}`;
    case 'cardFlipped':
      return `${actor} ${ev.flipped ? 'flipped' : 'unflipped'} ${card(ev.instanceId)}`;
    case 'cardFaceDownChanged':
      return `${actor} turned ${card(ev.instanceId)} face ${ev.faceDown ? 'down' : 'up'}`;
    case 'turnEnded':
      return `${ctx.playerName(ev.playerId)} ended the turn — ${ctx.playerName(ev.nextPlayerId)}'s turn (${ev.turn})`;
    case 'mulliganTaken':
      return `${ctx.playerName(ev.playerId)} took a mulligan (${ev.taken})`;
    case 'handKept':
      return `${ctx.playerName(ev.playerId)} kept their hand${ev.bottomed ? ` (${ev.bottomed} to the bottom)` : ''}`;
    case 'libraryShuffled':
      return `${ctx.playerName(ev.playerId)} shuffled their library`;
    case 'counterChanged': {
      const what = `${Math.abs(ev.delta)} ${ev.kind} counter${Math.abs(ev.delta) === 1 ? '' : 's'}`;
      const target = ev.target.type === 'card' ? card(ev.target.instanceId) : ctx.playerName(ev.target.playerId);
      return `${actor} ${ev.delta > 0 ? 'added' : 'removed'} ${what} ${ev.delta > 0 ? 'to' : 'from'} ${target} (now ${ev.value})`;
    }
    case 'cardAttached':
      return ev.to ? `${actor} attached ${card(ev.instanceId)} to ${card(ev.to)}` : `${actor} detached ${card(ev.instanceId)}`;
    case 'noteChanged':
      return ev.note ? `${actor} noted “${ev.note}” on ${card(ev.instanceId)}` : `${actor} cleared a note`;
    case 'tokenCreated': {
      const first = ev.cards[0];
      const name = first ? (first.customName ?? ctx.cardName(first.id) ?? 'token') : 'token';
      return `${actor} created ${ev.cards.length} × ${name}`;
    }
    case 'lifeChanged': {
      const who = ev.target.type === 'team' ? `team ${ev.target.team + 1}` : ctx.playerName(ev.target.playerId);
      return `${who} ${ev.delta > 0 ? 'gained' : 'lost'} ${Math.abs(ev.delta)} life (${ev.value})`;
    }
    case 'poisonChanged':
      return `${ctx.playerName(ev.playerId)} ${ev.delta > 0 ? 'got' : 'removed'} ${Math.abs(ev.delta)} poison (${ev.value})`;
    case 'commanderTaxChanged':
      return `${ctx.playerName(ev.playerId)}'s commander tax is now ${ev.value}`;
    case 'commanderDamageChanged':
      return `${ctx.playerName(ev.playerId)} has taken ${ev.value} commander damage from ${ctx.playerName(ev.fromPlayerId)}`;
    case 'visibilityChanged': {
      if (ev.revealUntil === null) return null; // dismissals are noise
      const to = ev.visibleTo === 'all' ? 'everyone' : ev.visibleTo === 'owner' ? 'themselves' : ev.visibleTo.filter((p) => p !== e.actorId).map(ctx.playerName).join(', ') || 'themselves';
      return to === 'themselves' ? `${actor} looked at ${card(ev.instanceId)}` : `${actor} revealed ${card(ev.instanceId)} to ${to}`;
    }
    case 'libraryReordered':
      return `${ctx.playerName(ev.playerId)} reordered the top ${ev.top.length} cards of their library`;
    case 'topRevealedChanged':
      return `${ctx.playerName(ev.playerId)} ${ev.enabled ? 'now plays with the top card revealed' : 'stopped revealing the top card'}`;
    case 'actionUndone':
      return `${actor} undid their last action (${ev.toSeq - ev.fromSeq + 1} step${ev.toSeq - ev.fromSeq === 0 ? '' : 's'})`;
    case 'diceRolled':
      return `${actor} rolled ${ev.results.length > 1 ? `${ev.results.length}d${ev.sides}` : `a d${ev.sides}`}: ${ev.results.join(', ')}${ev.results.length > 1 ? ` (total ${ev.results.reduce((a, b) => a + b, 0)})` : ''}`;
    case 'coinFlipped':
      return `${actor} flipped ${ev.results.length > 1 ? `${ev.results.length} coins` : 'a coin'}: ${ev.results.join(', ')}`;
    case 'draftStarted':
      return `Draft started: ${ev.config.name}, ${ev.packs.length} packs over ${ev.config.phases.length} phase${ev.config.phases.length === 1 ? '' : 's'}`;
    case 'draftPicked': {
      const name = ev.printingId ? (ctx.printingName?.(ev.printingId) ?? 'a card') : 'a card';
      return `${ctx.playerName(ev.playerId)} picked ${name}${ev.faceUp ? ' face up' : ''}${ev.double ? ' (extra pick)' : ''}`;
    }
    case 'draftCardReturned':
      return `${ctx.playerName(ev.playerId)} put ${ev.printingId ? (ctx.printingName?.(ev.printingId) ?? 'a card') : 'a card'} into the pack`;
  }
}
