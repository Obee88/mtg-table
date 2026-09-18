import type { GameEvent } from './events.js';
import type { RoomState } from './types.js';

export function initialRoomState(id: string): RoomState {
  return {
    id,
    ownerId: '',
    settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false },
    phase: 'lobby',
    players: {},
    game: null,
    seq: 0,
  };
}

/**
 * Pure state transition. Never throws on well-formed events; unknown players
 * etc. are ignored so that replaying a log is always possible.
 */
export function reduce(state: RoomState, event: GameEvent): RoomState {
  switch (event.type) {
    case 'roomCreated':
      return { ...state, ownerId: event.ownerId, settings: event.settings };

    case 'settingsChanged':
      return { ...state, settings: event.settings, players: mapPlayers(state, (p) => ({ ...p, ready: false })) };

    case 'playerJoined':
      return {
        ...state,
        players: {
          ...state.players,
          [event.playerId]: { id: event.playerId, displayName: event.displayName, seat: event.seat, team: event.team, deckId: null, ready: false },
        },
      };

    case 'playerLeft': {
      const players = { ...state.players };
      delete players[event.playerId];
      return { ...state, players };
    }

    case 'deckSelected':
      return updatePlayer(state, event.playerId, (p) => ({ ...p, deckId: event.deckId, ready: false }));

    case 'readyChanged':
      return updatePlayer(state, event.playerId, (p) => ({ ...p, ready: event.ready }));

    case 'roomClosed':
      return { ...state, phase: 'ended' };
  }
}

export function reduceAll(state: RoomState, events: readonly GameEvent[]): RoomState {
  return events.reduce(reduce, state);
}

function updatePlayer(state: RoomState, playerId: string, fn: (p: RoomState['players'][string]) => RoomState['players'][string]): RoomState {
  const player = state.players[playerId];
  if (!player) return state;
  return { ...state, players: { ...state.players, [playerId]: fn(player) } };
}

function mapPlayers(state: RoomState, fn: (p: RoomState['players'][string]) => RoomState['players'][string]): RoomState['players'] {
  return Object.fromEntries(Object.entries(state.players).map(([id, p]) => [id, fn(p)]));
}
