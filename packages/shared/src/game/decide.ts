import type { GameCommand } from './commands.js';
import type { GameEvent } from './events.js';
import type { DeckContents } from '../decks.js';
import { shuffled, teamForSeat, type RoomState } from './types.js';

const HAND_SIZE = 7;
type StartedCard = { id: string; printingId: string };

export interface CommandContext {
  actorId: string;
  actorDisplayName: string;
  now: Date;
  /** Needed by `start`: each seated player's deck, a random source in [0, 1) and fresh ids. */
  decks?: Record<string, DeckContents>;
  random?: () => number;
  newId?: () => string;
}

export type Decision = { ok: true; events: GameEvent[] } | { ok: false; error: string };

const reject = (error: string): Decision => ({ ok: false, error });
const accept = (...events: GameEvent[]): Decision => ({ ok: true, events });

/**
 * Validates a command against the current state and turns it into events.
 * Pure: randomness or lookups the server must do (e.g. loading a deck) are
 * passed in via the context by the caller.
 */
export function decide(state: RoomState, command: GameCommand, ctx: CommandContext): Decision {
  const me = state.players[ctx.actorId];
  const isOwner = state.ownerId === ctx.actorId;
  if (state.phase === 'ended') return reject('Room is closed');

  switch (command.type) {
    case 'join': {
      if (me) return reject('Already in the room');
      if (state.phase !== 'lobby') return reject('Game already started');
      const taken = new Set(Object.values(state.players).map((p) => p.seat));
      const seat = [...Array(state.settings.playerCount).keys()].find((s) => !taken.has(s));
      if (seat === undefined) return reject('Room is full');
      return accept({ type: 'playerJoined', playerId: ctx.actorId, displayName: ctx.actorDisplayName, seat, team: teamForSeat(seat, state.settings.mode) });
    }

    case 'leave':
      if (!me) return reject('Not in the room');
      if (state.phase !== 'lobby') return reject('Cannot leave a running game');
      return accept({ type: 'playerLeft', playerId: ctx.actorId });

    case 'selectDeck':
      if (!me) return reject('Not in the room');
      if (state.phase !== 'lobby') return reject('Game already started');
      return accept({ type: 'deckSelected', playerId: ctx.actorId, deckId: command.deckId });

    case 'setReady':
      if (!me) return reject('Not in the room');
      if (state.phase !== 'lobby') return reject('Game already started');
      if (command.ready && !me.deckId) return reject('Choose a deck first');
      if (me.ready === command.ready) return accept();
      return accept({ type: 'readyChanged', playerId: ctx.actorId, ready: command.ready });

    case 'updateSettings': {
      if (!isOwner) return reject('Only the owner can change settings');
      if (state.phase !== 'lobby') return reject('Game already started');
      const seated = Object.keys(state.players).length;
      if (command.settings.playerCount < seated) return reject(`${seated} players are seated`);
      if (command.settings.mode === '2v2' && command.settings.playerCount !== 4) return reject('2v2 needs 4 players');
      if (command.settings.mode === '1v1' && command.settings.playerCount !== 2) return reject('1v1 needs 2 players');
      return accept({ type: 'settingsChanged', settings: command.settings });
    }

    case 'start': {
      if (!isOwner) return reject('Only the owner can start the game');
      if (state.phase !== 'lobby') return reject('Game already started');
      const players = Object.values(state.players);
      if (players.length !== state.settings.playerCount) return reject(`Waiting for ${state.settings.playerCount - players.length} more player(s)`);
      const notReady = players.filter((p) => !p.ready);
      if (notReady.length > 0) return reject(`Not ready: ${notReady.map((p) => p.displayName).join(', ')}`);
      if (!ctx.decks || !ctx.random || !ctx.newId) return reject('Decks unavailable');
      const layouts: Record<string, { library: StartedCard[]; hand: StartedCard[]; command: StartedCard[]; sideboard: StartedCard[] }> = {};
      for (const p of players) {
        const deck = ctx.decks[p.id];
        if (!deck || deck.main.length === 0) return reject(`${p.displayName} has no usable deck`);
        const expand = (cards: { printingId: string; quantity: number }[]) =>
          cards.flatMap((c) => Array.from({ length: c.quantity }, () => ({ id: ctx.newId!(), printingId: c.printingId })));
        const library = shuffled(expand(deck.main), ctx.random);
        const hand = library.splice(0, HAND_SIZE);
        layouts[p.id] = { library, hand, command: expand(deck.commander), sideboard: expand(deck.sideboard) };
      }
      const openingRoll = rollForFirst(players.map((p) => p.id), ctx.random);
      return accept({ type: 'gameStarted', firstPlayerId: openingRoll.winner, openingRoll: openingRoll.rolls, players: layouts });
    }

    case 'closeRoom':
      if (!isOwner) return reject('Only the owner can close the room');
      return accept({ type: 'roomClosed' });
  }
}

/** Everyone rolls a d20; the highest goes first, ties re-roll among the tied. */
function rollForFirst(playerIds: string[], random: () => number): { winner: string; rolls: Record<string, number> } {
  const rolls: Record<string, number> = {};
  let contenders = playerIds;
  for (;;) {
    for (const id of contenders) rolls[id] = 1 + Math.floor(random() * 20);
    const high = Math.max(...contenders.map((id) => rolls[id]!));
    const tied = contenders.filter((id) => rolls[id] === high);
    if (tied.length === 1) return { winner: tied[0]!, rolls };
    contenders = tied;
  }
}
