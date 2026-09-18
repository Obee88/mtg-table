import type { GameCommand } from './commands.js';
import type { GameEvent } from './events.js';
import { teamForSeat, type RoomState } from './types.js';

export interface CommandContext {
  actorId: string;
  actorDisplayName: string;
  now: Date;
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

    case 'closeRoom':
      if (!isOwner) return reject('Only the owner can close the room');
      return accept({ type: 'roomClosed' });
  }
}
