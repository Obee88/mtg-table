import { reduceDraft } from '../draft/reduce.js';
import type { GameEvent } from './events.js';
import { emptyPlayerGameState, withRoomSeats, type CardInstance, type GameState, type PlayerGameState, type RoomState, type ZoneName } from './types.js';

/** Who may see a card's identity by default when it enters a zone. */
export function defaultVisibility(zone: ZoneName): CardInstance['visibleTo'] {
  if (PUBLIC_ZONES.has(zone)) return 'all';
  return zone === 'library' ? [] : 'owner';
}

/** Zones where every player may see card identities. */
export const PUBLIC_ZONES: ReadonlySet<string> = new Set(['battlefield', 'graveyard', 'exile', 'command', 'stack']);

export function initialRoomState(id: string): RoomState {
  return {
    id,
    ownerId: '',
    settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false },
    phase: 'lobby',
    players: {},
    game: null,
    draft: null,
    results: [],
    name: null,
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
      return { ...state, ownerId: event.ownerId, settings: withRoomSeats(event.settings) };

    case 'settingsChanged':
      return { ...state, settings: withRoomSeats(event.settings), players: mapPlayers(state, (p) => ({ ...p, ready: false })) };

    case 'playerJoined':
      return {
        ...state,
        players: {
          ...state.players,
          [event.playerId]: { id: event.playerId, displayName: event.displayName, seat: event.seat, team: event.team, deckId: null, ready: false },
        },
      };

    case 'seatChanged':
      return updatePlayer(state, event.playerId, (p) => ({ ...p, seat: event.seat, team: event.team, ready: false }));

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
              note: null, isToken: false, isCommander: zone === 'command', customName: null, visibleTo: defaultVisibility(zone), revealUntil: null, targetedBy: [], position: null,
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
        game: {
          cards, players, teamLife, firstPlayerId: event.firstPlayerId, openingRoll: event.openingRoll, stack: [], startedAt: '',
          sideboarding: Object.fromEntries(Object.keys(event.players).map((id) => [id, { done: false, changed: false }])),
          mulligans: Object.fromEntries(Object.keys(event.players).map((id) => [id, { taken: 0, kept: false }])),
          activePlayerId: event.firstPlayerId,
          turn: 1,
          gameNumber: (state.game?.gameNumber ?? 0) + 1,
          pendingResult: null,
        },
      };
    }

    case 'resultProposed':
      if (!state.game) return state;
      return { ...state, game: { ...state.game, pendingResult: { proposedBy: event.proposedBy, winners: event.winners, then: event.then, confirmed: [] } } };

    case 'resultConfirmed': {
      const pending = state.game?.pendingResult;
      if (!state.game || !pending || pending.confirmed.includes(event.playerId)) return state;
      return { ...state, game: { ...state.game, pendingResult: { ...pending, confirmed: [...pending.confirmed, event.playerId] } } };
    }

    case 'resultRejected':
      if (!state.game) return state;
      return { ...state, game: { ...state.game, pendingResult: null } };

    case 'resultReported': {
      const result = { gameNumber: event.gameNumber, reportedBy: event.reportedBy, winners: event.winners, note: event.note, at: event.at };
      const results = (state.results ?? []).filter((r) => r.gameNumber !== event.gameNumber);
      return { ...state, results: [...results, result].sort((a, b) => a.gameNumber - b.gameNumber) };
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
      // Into a library: the top, an index from the top, or the bottom.
      if (event.to === 'library' && event.libraryPosition === 'top') target.unshift(card.id);
      else if (event.to === 'library' && typeof event.libraryPosition === 'number') target.splice(Math.min(event.libraryPosition, target.length), 0, card.id);
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
              visibleTo: defaultVisibility(event.to),
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
      // Shared stack order: remove on leaving, push on entering (top = last).
      let stack = state.game.stack ?? [];
      if (event.from === 'stack' || event.to === 'stack') stack = stack.filter((id) => id !== card.id);
      if (event.to === 'stack') stack = [...stack, card.id];
      return { ...state, game: { ...state.game, cards, stack, players: { ...state.game.players, [card.ownerId]: { ...owner, zones } }, sideboarding: sideboardTouched(state.game, card.ownerId, event.from, event.to) } };
    }

    case 'cardTargeted': {
      const card = state.game?.cards[event.instanceId];
      if (!card) return state;
      const others = (card.targetedBy ?? []).filter((id) => id !== event.playerId);
      return patchCard(state, event.instanceId, { targetedBy: event.targeted ? [...others, event.playerId] : others });
    }

    case 'cardTapped': {
      const card = state.game?.cards[event.instanceId];
      if (!state.game || !card) return state;
      return { ...state, game: { ...state.game, cards: { ...state.game.cards, [card.id]: { ...card, tapped: event.tapped } } } };
    }

    case 'libraryShuffled': {
      if (!state.game) return state;
      const owner = state.game.players[event.playerId];
      if (!owner) return state;
      const cards = { ...state.game.cards };
      for (const id of owner.zones.library) delete cards[id];
      for (const c of event.cards) {
        cards[c.id] = {
          id: c.id, printingId: c.printingId, ownerId: event.playerId, controllerId: event.playerId, zone: 'library',
          tapped: false, transformed: false, flipped: false, faceDown: false, counters: {}, attachedTo: null,
          note: null, isToken: false, isCommander: false, customName: null, visibleTo: [], revealUntil: null, targetedBy: [], position: null,
        };
      }
      const zones = { ...owner.zones, library: event.cards.map((c) => c.id) };
      return { ...state, game: { ...state.game, cards, players: { ...state.game.players, [event.playerId]: { ...owner, zones } } } };
    }

    case 'cardTransformed':
      return patchCard(state, event.instanceId, { transformed: event.transformed });

    case 'cardFlipped':
      return patchCard(state, event.instanceId, { flipped: event.flipped });

    case 'cardFaceDownChanged': {
      const card = state.game?.cards[event.instanceId];
      if (!card) return state;
      return patchCard(state, event.instanceId, { faceDown: event.faceDown, visibleTo: event.faceDown ? 'owner' : defaultVisibility(card.zone) });
    }

    case 'counterChanged': {
      if (!state.game) return state;
      if (event.target.type === 'card') {
        const card = state.game.cards[event.target.instanceId];
        if (!card) return state;
        const counters = { ...card.counters };
        if (event.value === 0) delete counters[event.kind];
        else counters[event.kind] = event.value;
        return patchCard(state, card.id, { counters });
      }
      const pgs = state.game.players[event.target.playerId];
      if (!pgs) return state;
      const counters = { ...pgs.counters };
      if (event.value === 0) delete counters[event.kind];
      else counters[event.kind] = event.value;
      return { ...state, game: { ...state.game, players: { ...state.game.players, [event.target.playerId]: { ...pgs, counters } } } };
    }

    case 'cardAttached':
      return patchCard(state, event.instanceId, { attachedTo: event.to });

    case 'noteChanged':
      return patchCard(state, event.instanceId, { note: event.note });

    case 'tokenCreated': {
      if (!state.game) return state;
      const owner = state.game.players[event.controllerId];
      if (!owner) return state;
      const cards = { ...state.game.cards };
      for (const t of event.cards) {
        cards[t.id] = {
          id: t.id, printingId: t.printingId, ownerId: event.controllerId, controllerId: event.controllerId, zone: 'battlefield',
          tapped: false, transformed: false, flipped: false, faceDown: false, counters: {}, attachedTo: null, note: null,
          isToken: true, isCommander: false, customName: t.customName, visibleTo: 'all', revealUntil: null, targetedBy: [], position: event.position,
        };
      }
      const zones = { ...owner.zones, battlefield: [...owner.zones.battlefield, ...event.cards.map((t) => t.id)] };
      return { ...state, game: { ...state.game, cards, players: { ...state.game.players, [event.controllerId]: { ...owner, zones } } } };
    }

    case 'lifeChanged': {
      if (!state.game) return state;
      if (event.target.type === 'team') {
        return { ...state, game: { ...state.game, teamLife: { ...(state.game.teamLife ?? {}), [event.target.team]: event.value } } };
      }
      return patchPlayer(state, event.target.playerId, { life: event.value });
    }

    case 'poisonChanged':
      return patchPlayer(state, event.playerId, { poison: event.value });

    case 'manaChanged': {
      const pool = state.game?.players[event.playerId]?.mana ?? {};
      const mana = { ...pool, [event.symbol]: event.value };
      if (event.value <= 0) delete mana[event.symbol];
      return patchPlayer(state, event.playerId, { mana });
    }

    case 'manaPoolToggled':
      return patchPlayer(state, event.playerId, { manaOpen: event.open });

    case 'manaPoolEmptied':
      return patchPlayer(state, event.playerId, { mana: {} });

    case 'commanderTaxChanged':
      return patchPlayer(state, event.playerId, { commanderTax: event.value });

    case 'commanderDamageChanged': {
      const pgs = state.game?.players[event.playerId];
      if (!pgs) return state;
      const commanderDamage = { ...pgs.commanderDamage };
      if (event.value === 0) delete commanderDamage[event.fromPlayerId];
      else commanderDamage[event.fromPlayerId] = event.value;
      return patchPlayer(state, event.playerId, { commanderDamage });
    }

    case 'diceRolled':
    case 'coinFlipped':
      return state; // log-only facts

    case 'visibilityChanged':
      return patchCard(state, event.instanceId, { visibleTo: event.visibleTo, revealUntil: event.revealUntil });

    case 'handReordered': {
      const pgs = state.game?.players[event.playerId];
      if (!pgs) return state;
      return patchPlayer(state, event.playerId, { zones: { ...pgs.zones, hand: event.order } });
    }

    case 'libraryReordered': {
      const pgs = state.game?.players[event.playerId];
      if (!pgs) return state;
      const rest = pgs.zones.library.filter((id) => !event.top.includes(id));
      return patchPlayer(state, event.playerId, { zones: { ...pgs.zones, library: [...event.top, ...rest] } });
    }

    case 'topRevealedChanged':
      return patchPlayer(state, event.playerId, { topRevealed: event.enabled });

    case 'actionUndone':
      // Full restore; the caller sets `seq` from the envelope.
      return { ...event.state, id: state.id };

    case 'sideboardingDone': {
      if (!state.game) return state;
      const s = state.game.sideboarding?.[event.playerId] ?? { done: false, changed: false };
      return { ...state, game: { ...state.game, sideboarding: { ...(state.game.sideboarding ?? {}), [event.playerId]: { ...s, done: true } }, mulligans: { ...(state.game.mulligans ?? {}), [event.playerId]: { taken: 0, kept: false } } } };
    }

    case 'mulliganTaken': {
      if (!state.game) return state;
      const m = state.game.mulligans?.[event.playerId] ?? { taken: 0, kept: false };
      return { ...state, game: { ...state.game, mulligans: { ...(state.game.mulligans ?? {}), [event.playerId]: { ...m, taken: event.taken } } } };
    }

    case 'handKept': {
      if (!state.game) return state;
      const m = state.game.mulligans?.[event.playerId] ?? { taken: 0, kept: false };
      return { ...state, game: { ...state.game, mulligans: { ...(state.game.mulligans ?? {}), [event.playerId]: { ...m, kept: true } } } };
    }

    case 'turnEnded': {
      if (!state.game) return state;
      // Targets are for the turn that just ended.
      const cards = Object.fromEntries(Object.entries(state.game.cards).map(([id, c]) => [id, (c.targetedBy?.length ?? 0) > 0 ? { ...c, targetedBy: [] } : c]));
      return { ...state, game: { ...state.game, cards, activePlayerId: event.nextPlayerId, turn: event.turn } };
    }

    case 'roomClosed':
      return { ...state, phase: 'ended' };

    case 'roomRenamed':
      return { ...state, name: event.name || null };

    // The last game stays for reference (and to keep the numbering) while the room waits in the lobby.
    case 'gameEnded':
      return { ...state, phase: 'lobby' };

    // ---- draft: the draft state is its own reducer; the room only tracks the phase ----
    case 'draftStarted':
      return { ...state, phase: 'drafting', draft: reduceDraft(null, event) };

    case 'draftPicked':
    case 'draftCardReturned':
    case 'draftDeckSubmitted':
    case 'winstonTaken':
    case 'winstonPassed':
    case 'gridTaken':
    case 'winchesterTaken':
    case 'rotisseriePicked': {
      const draft = reduceDraft(state.draft ?? null, event);
      return { ...state, draft, phase: draft?.status === 'finished' ? 'deckbuilding' : state.phase };
    }
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

function patchCard(state: RoomState, instanceId: string, patch: Partial<CardInstance>): RoomState {
  const card = state.game?.cards[instanceId];
  if (!state.game || !card) return state;
  return { ...state, game: { ...state.game, cards: { ...state.game.cards, [instanceId]: { ...card, ...patch } } } };
}

function patchPlayer(state: RoomState, playerId: string, patch: Partial<PlayerGameState>): RoomState {
  const pgs = state.game?.players[playerId];
  if (!state.game || !pgs) return state;
  return { ...state, game: { ...state.game, players: { ...state.game.players, [playerId]: { ...pgs, ...patch } } } };
}

/** Marks a player's sideboarding as changed when a card crosses the sideboard line before they are done. */
function sideboardTouched(game: GameState, ownerId: string, from: ZoneName, to: ZoneName): GameState['sideboarding'] {
  const s = game.sideboarding?.[ownerId];
  if (!s || s.done || s.changed || (from !== 'sideboard' && to !== 'sideboard')) return game.sideboarding ?? {};
  return { ...game.sideboarding, [ownerId]: { ...s, changed: true } };
}
