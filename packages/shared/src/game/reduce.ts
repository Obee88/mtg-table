import type { GameEvent } from './events.js';
import { emptyPlayerGameState, type CardInstance, type GameState, type RoomState } from './types.js';

/** Zones where every player may see card identities. */
export const PUBLIC_ZONES: ReadonlySet<string> = new Set(['battlefield', 'graveyard', 'exile', 'command']);

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

    case 'gameStarted': {
      const { settings } = state;
      const cards: GameState['cards'] = {};
      const players: GameState['players'] = {};
      for (const [playerId, layout] of Object.entries(event.players)) {
        const pgs = emptyPlayerGameState(settings.startingLife);
        for (const zone of ['library', 'hand', 'command', 'sideboard'] as const) {
          for (const c of layout[zone]) {
            cards[c.id] = {
              id: c.id, printingId: c.printingId, ownerId: playerId, controllerId: playerId, zone,
              tapped: false, transformed: false, flipped: false, faceDown: false, counters: {}, attachedTo: null,
              note: null, isToken: false, visibleTo: zone === 'command' ? 'all' : 'owner', revealUntil: null, position: null,
            };
            pgs.zones[zone].push(c.id);
          }
        }
        players[playerId] = pgs;
      }
      const teamLife = settings.mode === '2v2'
        ? Object.fromEntries([...new Set(Object.values(state.players).map((p) => p.team))].map((t) => [t, settings.startingLife]))
        : null;
      return {
        ...state,
        phase: 'playing',
        game: { cards, players, teamLife, firstPlayerId: event.firstPlayerId, openingRoll: event.openingRoll, startedAt: '' },
      };
    }

    case 'cardMoved': {
      if (!state.game) return state;
      const card = state.game.cards[event.instanceId];
      if (!card) return state;
      const owner = state.game.players[card.ownerId];
      if (!owner) return state;

      const zones = { ...owner.zones, [event.from]: owner.zones[event.from].filter((id) => id !== event.instanceId) };
      const cards = { ...state.game.cards };

      // Tokens cease to exist when they leave the battlefield.
      if (card.isToken && event.from === 'battlefield' && event.to !== 'battlefield') {
        delete cards[card.id];
        return { ...state, game: { ...state.game, cards, players: { ...state.game.players, [card.ownerId]: { ...owner, zones } } } };
      }

      const target = zones[event.to].filter((id) => id !== event.instanceId);
      if (event.to === 'library' && event.libraryPosition === 'top') target.unshift(card.id);
      else target.push(card.id);
      zones[event.to] = target;

      const changedZone = event.from !== event.to;
      const moved: CardInstance = {
        ...card,
        zone: event.to,
        position: event.to === 'battlefield' ? (event.position ?? card.position) : null,
        ...(changedZone
          ? {
              tapped: false,
              transformed: false,
              flipped: false,
              faceDown: false,
              counters: {},
              attachedTo: null,
              visibleTo: PUBLIC_ZONES.has(event.to) ? 'all' : 'owner',
              revealUntil: null,
            }
          : {}),
      };
      cards[card.id] = moved;
      // Anything attached to a card that left the battlefield comes off.
      if (changedZone && event.from === 'battlefield') {
        for (const other of Object.values(cards)) {
          if (other.attachedTo === card.id) cards[other.id] = { ...other, attachedTo: null };
        }
      }
      return { ...state, game: { ...state.game, cards, players: { ...state.game.players, [card.ownerId]: { ...owner, zones } } } };
    }

    case 'cardTapped': {
      const card = state.game?.cards[event.instanceId];
      if (!state.game || !card) return state;
      return { ...state, game: { ...state.game, cards: { ...state.game.cards, [card.id]: { ...card, tapped: event.tapped } } } };
    }

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
