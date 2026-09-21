import type { GameCommand } from './commands.js';
import type { GameEvent } from './events.js';
import type { DeckContents } from '../decks.js';
import { dealDraft, decideDraft } from '../draft/decide.js';
import { allDecksSubmitted, draftAbilityFor, draftDeckContents, type DraftCard } from '../draft/types.js';
import { defaultVisibility } from './reduce.js';
import { activePlayer, inMulligan, inSideboarding, isActive, manaTotal, seatedPlayers, shuffled, teamForSeat, type CardInstance, type GameState, type PlayerGameState, type RoomState } from './types.js';

const HAND_SIZE = 7;
const MAX_TIE_BREAK_ROUNDS = 20;
type StartedCard = { id: string; printingId: string };

export interface CommandContext {
  actorId: string;
  actorDisplayName: string;
  now: Date;
  /** Needed by `start`: each seated player's deck, a random source in [0, 1) and fresh ids. */
  decks?: Record<string, DeckContents>;
  /** Needed by `start` in a draft room: printing ids per cube version id, one entry per copy. */
  draftPools?: Record<string, { printingId: string; name: string }[]>;
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

    case 'takeSeat': {
      if (!me) return reject('Not in the room');
      if (state.phase !== 'lobby') return reject('Game already started');
      if (command.seat >= state.settings.playerCount) return reject('No such seat');
      if (me.seat === command.seat) return accept();
      if (Object.values(state.players).some((p) => p.seat === command.seat)) return reject('That seat is taken');
      return accept({ type: 'seatChanged', playerId: ctx.actorId, seat: command.seat, team: teamForSeat(command.seat, state.settings.mode) });
    }

    case 'selectDeck':
      if (!me) return reject('Not in the room');
      if (state.phase !== 'lobby') return reject('Game already started');
      return accept({ type: 'deckSelected', playerId: ctx.actorId, deckId: command.deckId });

    case 'setReady':
      if (!me) return reject('Not in the room');
      if (state.phase !== 'lobby') return reject('Game already started');
      if (command.ready && !me.deckId && !state.settings.draft) return reject('Choose a deck first');
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
      if (state.phase === 'deckbuilding') {
        if (!state.draft || !allDecksSubmitted(state.draft)) return reject('Waiting for everyone to submit a deck');
        return deal(state, { ...ctx, decks: draftDecks(state) });
      }
      if (state.phase !== 'lobby') return reject('Game already started');
      const players = Object.values(state.players);
      if (players.length !== state.settings.playerCount) return reject(`Waiting for ${state.settings.playerCount - players.length} more player(s)`);
      const notReady = players.filter((p) => !p.ready);
      if (notReady.length > 0) return reject(`Not ready: ${notReady.map((p) => p.displayName).join(', ')}`);
      // A draft that already happened deals its decks again; a fresh draft room drafts first.
      const drafted = state.draft?.status === 'finished';
      const dealt = drafted ? deal(state, { ...ctx, decks: draftDecks(state) }) : state.settings.draft ? startDraft(state, ctx) : deal(state, ctx);
      // A name given at the start belongs to the same batch, so undo and replay keep them together.
      const named = command.name?.trim();
      return dealt.ok && named ? { ok: true, events: [{ type: 'roomRenamed', name: named }, ...dealt.events] } : dealt;
    }

    case 'draftPick':
    case 'winstonDecide':
    case 'gridPick':
    case 'winchesterTake':
    case 'rotisseriePick': {
      if (state.phase !== 'drafting') return reject('No draft running');
      return decideDraft(state.draft ?? null, command, ctx.actorId);
    }

    case 'submitDraftDeck': {
      if (state.phase !== 'deckbuilding') return reject('Not in deckbuilding');
      return decideDraft(state.draft ?? null, command, ctx.actorId);
    }

    case 'restart': {
      if (!isOwner) return reject('Only the owner can restart the game');
      if (state.phase !== 'playing') return reject('Game not running');
      return deal(state, state.draft ? { ...ctx, decks: draftDecks(state) } : ctx);
    }

    case 'moveCard': {
      const found = ownCard(state, ctx.actorId, command.instanceId);
      let card: CardInstance;
      if ('error' in found) {
        // A revealed hand card may be taken by whoever it was revealed to (e.g. discard effects).
        const other = state.game?.cards[command.instanceId];
        const allowed = other && other.zone === 'hand' && ['graveyard', 'exile', 'library'].includes(command.to) && Array.isArray(other.visibleTo) && other.visibleTo.includes(ctx.actorId);
        if (!allowed || state.phase !== 'playing') return reject(found.error);
        card = other;
      } else {
        card = found.card;
      }
      return accept(
        {
          type: 'cardMoved',
          instanceId: card.id,
          from: card.zone,
          to: command.to,
          position: command.to === 'battlefield' ? (command.position ?? card.position ?? nextSlot(state, card.controllerId, 0)) : null,
          libraryPosition: command.to === 'library' ? (command.libraryPosition ?? 'top') : null,
        },
        ...commanderTaxOnCast(state, card, command.to),
      );
    }

    case 'tapCard': {
      const found = ownCard(state, ctx.actorId, command.instanceId);
      if ('error' in found) return reject(found.error);
      if (found.card.zone !== 'battlefield') return reject('Only permanents can be tapped');
      if (found.card.tapped === command.tapped) return accept();
      return accept({ type: 'cardTapped', instanceId: found.card.id, tapped: command.tapped });
    }

    case 'draw': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const top = pgs.zones.library.slice(0, command.count);
      if (top.length === 0) return reject('Library is empty');
      return accept(...top.map((instanceId): GameEvent => ({ type: 'cardMoved', instanceId, from: 'library', to: 'hand', position: null, libraryPosition: null })));
    }

    case 'untapAll': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const tapped = pgs.zones.battlefield.filter((id) => state.game!.cards[id]?.tapped);
      return accept(...tapped.map((instanceId): GameEvent => ({ type: 'cardTapped', instanceId, tapped: false })));
    }

    case 'shuffleLibrary': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      if (!ctx.random || !ctx.newId) return reject('Randomness unavailable');
      return accept(shuffleEvent(state, ctx.actorId, pgs.zones.library, ctx.random, ctx.newId));
    }

    case 'sideboardSwap': {
      const pgs = ownGame(state, ctx.actorId, { duringMulligan: true });
      if ('error' in pgs) return reject(pgs.error);
      const sb = state.game!.sideboarding?.[ctx.actorId];
      if (!sb || sb.done) return reject('Sideboarding is over');
      const cards = state.game!.cards;
      const events: GameEvent[] = [];
      const used = new Set<string>();
      const take = (pool: readonly string[], printingId: string, quantity: number): string[] | null => {
        const ids = pool.filter((id) => !used.has(id) && cards[id]?.printingId === printingId).slice(0, quantity);
        if (ids.length < quantity) return null;
        ids.forEach((id) => used.add(id));
        return ids;
      };
      for (const c of command.toMain) {
        const ids = take(pgs.zones.sideboard, c.printingId, c.quantity);
        if (!ids) return reject('Not that many copies in the sideboard');
        for (const instanceId of ids) events.push({ type: 'cardMoved', instanceId, from: 'sideboard', to: 'library', position: null, libraryPosition: 'top' });
      }
      for (const c of command.toSide) {
        const ids = take([...pgs.zones.hand, ...pgs.zones.library], c.printingId, c.quantity);
        if (!ids) return reject('Not that many copies in the deck');
        for (const instanceId of ids) events.push({ type: 'cardMoved', instanceId, from: cards[instanceId]!.zone, to: 'sideboard', position: null, libraryPosition: null });
      }
      return accept(...events);
    }

    case 'finishSideboarding': {
      const pgs = ownGame(state, ctx.actorId, { duringMulligan: true });
      if ('error' in pgs) return reject(pgs.error);
      const sb = state.game!.sideboarding?.[ctx.actorId];
      if (!sb || sb.done) return reject('Sideboarding is over');
      const events: GameEvent[] = [];
      if (sb.changed) {
        // The deck changed: hand back, shuffle everything, draw a fresh seven.
        if (!ctx.random || !ctx.newId) return reject('Randomness unavailable');
        events.push(...pgs.zones.hand.map((instanceId): GameEvent => ({ type: 'cardMoved', instanceId, from: 'hand', to: 'library', position: null, libraryPosition: 'top' })));
        const shuffle = shuffleEvent(state, ctx.actorId, [...pgs.zones.hand, ...pgs.zones.library], ctx.random, ctx.newId);
        events.push(shuffle);
        for (const c of shuffle.cards.slice(0, HAND_SIZE)) events.push({ type: 'cardMoved', instanceId: c.id, from: 'library', to: 'hand', position: null, libraryPosition: null });
      }
      events.push({ type: 'sideboardingDone', playerId: ctx.actorId });
      return accept(...events);
    }

    case 'mulligan': {
      const pgs = ownGame(state, ctx.actorId, { duringMulligan: true });
      if ('error' in pgs) return reject(pgs.error);
      if (inSideboarding(state.game!)) return reject(SIDEBOARD_WAIT);
      const m = state.game!.mulligans?.[ctx.actorId];
      if (!m || m.kept) return reject('You have already kept your hand');
      if (!ctx.random || !ctx.newId) return reject('Randomness unavailable');
      const events: GameEvent[] = pgs.zones.hand.map((instanceId) => ({ type: 'cardMoved', instanceId, from: 'hand', to: 'library', position: null, libraryPosition: 'top' }));
      const shuffle = shuffleEvent(state, ctx.actorId, [...pgs.zones.hand, ...pgs.zones.library], ctx.random, ctx.newId);
      events.push(shuffle);
      for (const c of shuffle.cards.slice(0, HAND_SIZE)) {
        events.push({ type: 'cardMoved', instanceId: c.id, from: 'library', to: 'hand', position: null, libraryPosition: null });
      }
      events.push({ type: 'mulliganTaken', playerId: ctx.actorId, taken: m.taken + 1 });
      return accept(...events);
    }

    case 'keepHand': {
      const pgs = ownGame(state, ctx.actorId, { duringMulligan: true });
      if ('error' in pgs) return reject(pgs.error);
      if (inSideboarding(state.game!)) return reject(SIDEBOARD_WAIT);
      const m = state.game!.mulligans?.[ctx.actorId];
      if (!m || m.kept) return reject('You have already kept your hand');
      const bottom = [...new Set(command.bottom)];
      if (bottom.length !== m.taken) return reject(`Choose ${m.taken} card${m.taken === 1 ? '' : 's'} to put on the bottom`);
      if (bottom.some((id) => !pgs.zones.hand.includes(id))) return reject('Those cards are not in your hand');
      const events: GameEvent[] = bottom.map((instanceId) => ({ type: 'cardMoved', instanceId, from: 'hand', to: 'library', position: null, libraryPosition: 'bottom' }));
      events.push({ type: 'handKept', playerId: ctx.actorId, bottomed: bottom.length });
      return accept(...events);
    }

    case 'transformCard': {
      const f = ownCard(state, ctx.actorId, command.instanceId);
      if ('error' in f) return reject(f.error);
      if (f.card.transformed === command.transformed) return accept();
      return accept({ type: 'cardTransformed', instanceId: f.card.id, transformed: command.transformed });
    }

    case 'flipCard': {
      const f = ownCard(state, ctx.actorId, command.instanceId);
      if ('error' in f) return reject(f.error);
      if (f.card.flipped === command.flipped) return accept();
      return accept({ type: 'cardFlipped', instanceId: f.card.id, flipped: command.flipped });
    }

    case 'setFaceDown': {
      const f = ownCard(state, ctx.actorId, command.instanceId);
      if ('error' in f) return reject(f.error);
      if (f.card.zone !== 'battlefield' && f.card.zone !== 'exile') return reject('Only battlefield or exiled cards can be face down');
      if (f.card.faceDown === command.faceDown) return accept();
      return accept({ type: 'cardFaceDownChanged', instanceId: f.card.id, faceDown: command.faceDown });
    }

    case 'addCounter': {
      const f = ownCard(state, ctx.actorId, command.instanceId);
      if ('error' in f) return reject(f.error);
      if (f.card.zone !== 'battlefield') return reject('Only permanents can have counters');
      const value = Math.max(0, (f.card.counters[command.kind] ?? 0) + command.delta);
      if (value === (f.card.counters[command.kind] ?? 0)) return accept();
      return accept({ type: 'counterChanged', target: { type: 'card', instanceId: f.card.id }, kind: command.kind, delta: command.delta, value });
    }

    case 'attachCard': {
      const f = ownCard(state, ctx.actorId, command.instanceId);
      if ('error' in f) return reject(f.error);
      if (f.card.zone !== 'battlefield') return reject('Only permanents can be attached');
      if (command.to !== null) {
        if (command.to === f.card.id) return reject('Cannot attach a card to itself');
        const host = state.game!.cards[command.to];
        if (!host || host.zone !== 'battlefield') return reject('Target is not on the battlefield');
        // No cycles: walk up from the host.
        for (let cur: CardInstance | undefined = host; cur; cur = cur.attachedTo ? state.game!.cards[cur.attachedTo] : undefined) {
          if (cur.id === f.card.id) return reject('Cannot create an attachment loop');
        }
      }
      if (f.card.attachedTo === command.to) return accept();
      return accept({ type: 'cardAttached', instanceId: f.card.id, to: command.to });
    }

    case 'setNote': {
      const f = ownCard(state, ctx.actorId, command.instanceId);
      if ('error' in f) return reject(f.error);
      const note = command.note === '' ? null : command.note;
      if (f.card.note === note) return accept();
      return accept({ type: 'noteChanged', instanceId: f.card.id, note });
    }

    case 'createToken': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      if (!command.printingId && !command.customName) return reject('A token needs a printing or a name');
      if (!ctx.newId) return reject('Ids unavailable');
      const cards = Array.from({ length: command.count }, () => ({ id: ctx.newId!(), printingId: command.printingId, customName: command.customName }));
      return accept({ type: 'tokenCreated', controllerId: ctx.actorId, cards, position: command.position ?? nextSlot(state, ctx.actorId, 0) });
    }

    case 'adjustLife': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      if (command.delta === 0) return accept();
      if (state.settings.mode === '2v2' && state.game!.teamLife) {
        const team = me!.team;
        const value = (state.game!.teamLife[team] ?? state.settings.startingLife) + command.delta;
        return accept({ type: 'lifeChanged', target: { type: 'team', team }, delta: command.delta, value });
      }
      return accept({ type: 'lifeChanged', target: { type: 'player', playerId: ctx.actorId }, delta: command.delta, value: pgs.life + command.delta });
    }

    case 'adjustPoison': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const value = Math.max(0, pgs.poison + command.delta);
      if (value === pgs.poison) return accept();
      return accept({ type: 'poisonChanged', playerId: ctx.actorId, delta: value - pgs.poison, value });
    }

    case 'adjustMana': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const had = pgs.mana?.[command.symbol] ?? 0;
      const value = Math.max(0, had + command.delta);
      if (value === had) return accept();
      // Adding mana opens the pool, so the table can see what is floating.
      const open: GameEvent[] = value > 0 && !pgs.manaOpen ? [{ type: 'manaPoolToggled', playerId: ctx.actorId, open: true }] : [];
      return accept(...open, { type: 'manaChanged', playerId: ctx.actorId, symbol: command.symbol, delta: value - had, value });
    }

    case 'setManaPool': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      if ((pgs.manaOpen ?? false) === command.open) return accept();
      return accept({ type: 'manaPoolToggled', playerId: ctx.actorId, open: command.open });
    }

    case 'emptyManaPool': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      if (manaTotal(pgs.mana ?? {}) === 0) return accept();
      return accept({ type: 'manaPoolEmptied', playerId: ctx.actorId });
    }

    case 'adjustPlayerCounter': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const value = Math.max(0, (pgs.counters[command.kind] ?? 0) + command.delta);
      if (value === (pgs.counters[command.kind] ?? 0)) return accept();
      return accept({ type: 'counterChanged', target: { type: 'player', playerId: ctx.actorId }, kind: command.kind, delta: command.delta, value });
    }

    case 'adjustCommanderTax': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const value = Math.max(0, pgs.commanderTax + command.delta);
      if (value === pgs.commanderTax) return accept();
      return accept({ type: 'commanderTaxChanged', playerId: ctx.actorId, delta: value - pgs.commanderTax, value });
    }

    case 'adjustCommanderDamage': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      if (!state.players[command.fromPlayerId]) return reject('Unknown player');
      const current = pgs.commanderDamage[command.fromPlayerId] ?? 0;
      const value = Math.max(0, current + command.delta);
      if (value === current) return accept();
      return accept({ type: 'commanderDamageChanged', playerId: ctx.actorId, fromPlayerId: command.fromPlayerId, delta: value - current, value });
    }

    case 'rollDice': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      if (!ctx.random) return reject('Randomness unavailable');
      const results = Array.from({ length: command.count }, () => 1 + Math.floor(ctx.random!() * command.sides));
      return accept({ type: 'diceRolled', playerId: ctx.actorId, sides: command.sides, results });
    }

    case 'flipCoin': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      if (!ctx.random) return reject('Randomness unavailable');
      const results = Array.from({ length: command.count }, () => (ctx.random!() < 0.5 ? 'heads' : 'tails') as 'heads' | 'tails');
      return accept({ type: 'coinFlipped', playerId: ctx.actorId, results });
    }

    case 'revealCards': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const events: GameEvent[] = [];
      for (const id of command.instanceIds) {
        const card = state.game!.cards[id];
        if (!card || card.ownerId !== ctx.actorId) return reject('Not your card');
        events.push(revealEvent(card, ctx.actorId, command.to, command.until));
      }
      return accept(...events);
    }

    case 'revealHand': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      return accept(...pgs.zones.hand.map((id) => revealEvent(state.game!.cards[id]!, ctx.actorId, command.to, 'zoneChange')));
    }

    case 'revealTop': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const top = pgs.zones.library.slice(0, command.count);
      if (top.length === 0) return reject('Library is empty');
      return accept(...top.map((id) => revealEvent(state.game!.cards[id]!, ctx.actorId, command.to, 'dismissed')));
    }

    case 'lookAtTop': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const top = pgs.zones.library.slice(0, command.count);
      if (top.length === 0) return reject('Library is empty');
      return accept(...top.map((id) => revealEvent(state.game!.cards[id]!, ctx.actorId, [], 'dismissed')));
    }

    case 'reorderHand': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const order = [...new Set(command.instanceIds)];
      const hand = pgs.zones.hand;
      if (order.length !== hand.length || order.some((id) => !hand.includes(id))) return reject('That is not your hand');
      if (order.every((id, i) => hand[i] === id)) return accept();
      return accept({ type: 'handReordered', playerId: ctx.actorId, order });
    }

    case 'reorderLibraryTop': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const current = pgs.zones.library.slice(0, command.instanceIds.length);
      const same = current.length === command.instanceIds.length && [...current].sort().join() === [...command.instanceIds].sort().join();
      if (!same) return reject('Can only reorder the top cards of the library');
      if (current.join() === command.instanceIds.join()) return accept();
      return accept({ type: 'libraryReordered', playerId: ctx.actorId, top: command.instanceIds });
    }

    case 'setTopRevealed': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      if (pgs.topRevealed === command.enabled) return accept();
      return accept({ type: 'topRevealedChanged', playerId: ctx.actorId, enabled: command.enabled });
    }

    case 'dismissReveal': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const ids = command.instanceIds ?? Object.values(state.game!.cards).filter((c) => c.ownerId === ctx.actorId && c.revealUntil === 'dismissed').map((c) => c.id);
      const events: GameEvent[] = [];
      for (const id of ids) {
        const card = state.game!.cards[id];
        if (!card || card.ownerId !== ctx.actorId) return reject('Not your card');
        if (card.revealUntil !== 'dismissed') continue;
        events.push({ type: 'visibilityChanged', instanceId: id, visibleTo: card.faceDown ? 'owner' : defaultVisibility(card.zone), revealUntil: null });
      }
      return accept(...events);
    }

    case 'undo':
      return reject('Undo is handled by the server');

    case 'moveCards': {
      const events: GameEvent[] = [];
      for (const id of new Set(command.instanceIds)) {
        const found = ownCard(state, ctx.actorId, id);
        if ('error' in found) return reject(found.error);
        const { card } = found;
        events.push({
          type: 'cardMoved',
          instanceId: card.id,
          from: card.zone,
          to: command.to,
          position: command.to === 'battlefield' ? (command.positions?.[card.id] ?? card.position ?? nextSlot(state, card.controllerId, 0, events.length)) : null,
          libraryPosition: command.to === 'library' ? (command.libraryPosition ?? 'top') : null,
        });
        events.push(...commanderTaxOnCast(state, card, command.to));
      }
      return accept(...events);
    }

    case 'tapCards': {
      const events: GameEvent[] = [];
      for (const id of new Set(command.instanceIds)) {
        const found = ownCard(state, ctx.actorId, id);
        if ('error' in found) return reject(found.error);
        if (found.card.zone !== 'battlefield') continue;
        if (found.card.tapped !== command.tapped) events.push({ type: 'cardTapped', instanceId: found.card.id, tapped: command.tapped });
      }
      return accept(...events);
    }

    case 'endTurn': {
      const pgs = ownGame(state, ctx.actorId);
      if ('error' in pgs) return reject(pgs.error);
      const game = state.game!;
      if (!isActive(state, ctx.actorId)) return reject("It is not your turn");
      const order = seatedPlayers(state).map((p) => p.id);
      const idx = order.indexOf(activePlayer(game));
      const next = order[(idx + 1) % order.length]!;
      return accept({ type: 'turnEnded', playerId: ctx.actorId, nextPlayerId: next, turn: (game.turn ?? 1) + 1 });
    }

    case 'reportResult': {
      if (!me) return reject('Not in the room');
      if (state.phase !== 'playing' || !state.game) return reject('Game not running');
      const winners = normalizeWinners(state, command.winners);
      if (winners === undefined) return reject('Winners must be seated players');
      return accept({ type: 'resultReported', gameNumber: state.game.gameNumber ?? 1, reportedBy: ctx.actorId, winners, note: command.note?.trim() || null, at: ctx.now.toISOString() });
    }

    case 'proposeResult': {
      if (!me) return reject('Not in the room');
      if (state.phase !== 'playing' || !state.game) return reject('Game not running');
      if (state.game.pendingResult) return reject('An outcome is already waiting for confirmation');
      const winners = command.winners === null ? null : normalizeWinners(state, command.winners);
      if (winners === undefined) return reject('Winners must be seated players');
      const events: GameEvent[] = [{ type: 'resultProposed', proposedBy: ctx.actorId, winners, then: command.then }, { type: 'resultConfirmed', playerId: ctx.actorId }];
      // Alone at the table: nobody else to ask.
      if (Object.keys(state.players).length === 1) events.push(...settle(state, { proposedBy: ctx.actorId, winners, then: command.then, confirmed: [ctx.actorId] }, ctx));
      return accept(...events);
    }

    case 'confirmResult': {
      if (!me) return reject('Not in the room');
      const pending = state.game?.pendingResult;
      if (state.phase !== 'playing' || !pending) return reject('Nothing to confirm');
      if (pending.confirmed.includes(ctx.actorId)) return reject('Already confirmed');
      const confirmed = [...pending.confirmed, ctx.actorId];
      const events: GameEvent[] = [{ type: 'resultConfirmed', playerId: ctx.actorId }];
      if (Object.keys(state.players).every((id) => confirmed.includes(id))) events.push(...settle(state, { ...pending, confirmed }, ctx));
      return accept(...events);
    }

    case 'rejectResult':
      if (!me) return reject('Not in the room');
      if (state.phase !== 'playing' || !state.game?.pendingResult) return reject('Nothing to dispute');
      return accept({ type: 'resultRejected', playerId: ctx.actorId });

    case 'renameRoom':
      if (!isOwner) return reject('Only the owner can rename this room');
      if (state.name === (command.name || null)) return accept();
      return accept({ type: 'roomRenamed', name: command.name });

    case 'closeRoom':
      if (!isOwner) return reject('Only the owner can close the room');
      return accept({ type: 'roomClosed' });
  }
}

/** Everyone rolls a d20; the highest goes first, ties re-roll among the tied (bounded; then seat order decides). */
function rollForFirst(playerIds: string[], random: () => number): { winner: string; rolls: Record<string, number> } {
  const rolls: Record<string, number> = {};
  let contenders = playerIds;
  for (let round = 0; round < MAX_TIE_BREAK_ROUNDS; round++) {
    for (const id of contenders) rolls[id] = 1 + Math.floor(random() * 20);
    const high = Math.max(...contenders.map((id) => rolls[id]!));
    const tied = contenders.filter((id) => rolls[id] === high);
    if (tied.length === 1) return { winner: tied[0]!, rolls };
    contenders = tied;
  }
  return { winner: contenders[0]!, rolls };
}

/** A card the actor controls, in a running game. */
/** Deals a fresh game for every seated player: shuffled libraries, seven-card hands, roll for first. */
function deal(state: RoomState, ctx: CommandContext): Decision {
  const players = Object.values(state.players);
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

/** Deals every pack of the configured draft from the cube-version pools the server loaded. Seats are fixed from here on. */
function startDraft(state: RoomState, ctx: CommandContext): Decision {
  const config = state.settings.draft;
  if (!config || !ctx.draftPools || !ctx.random || !ctx.newId) return reject('Draft pools unavailable');
  const pools: DraftCard[][] = config.phases.map((phase) =>
    (ctx.draftPools![phase.poolCubeVersionId] ?? []).map((c) => {
      const ability = draftAbilityFor(c.name);
      return ability ? { id: ctx.newId!(), printingId: c.printingId, ability } : { id: ctx.newId!(), printingId: c.printingId };
    }),
  );
  return dealDraft(config, seatedPlayers(state).map((p) => p.id), { pools, random: ctx.random, newId: ctx.newId });
}

const MULLIGAN_WAIT = 'Waiting for everyone to keep their opening hand';
const SIDEBOARD_WAIT = 'Waiting for everyone to finish sideboarding';

function ownCard(state: RoomState, actorId: string, instanceId: string): { card: CardInstance } | { error: string } {
  if (state.phase !== 'playing' || !state.game) return { error: 'Game not running' };
  if (inMulligan(state.game)) return { error: MULLIGAN_WAIT };
  const card = state.game.cards[instanceId];
  if (!card) return { error: 'No such card' };
  if (card.controllerId !== actorId) return { error: 'Not your card' };
  return { card };
}

/** The actor's own game-side state, in a running game (blocked during the mulligan phase unless allowed). */
function ownGame(state: RoomState, actorId: string, opts: { duringMulligan?: boolean } = {}): PlayerGameState | { error: string } {
  if (state.phase !== 'playing' || !state.game) return { error: 'Game not running' };
  if (!opts.duringMulligan && inMulligan(state.game)) return { error: MULLIGAN_WAIT };
  const pgs = state.game.players[actorId];
  if (!pgs) return { error: 'Not in the game' };
  return pgs;
}

/** A `libraryShuffled` event for the given cards (ids currently in the library, plus any about to join it). */
function shuffleEvent(state: RoomState, playerId: string, ids: readonly string[], random: () => number, newId: () => string): Extract<GameEvent, { type: 'libraryShuffled' }> {
  const cards = shuffled(ids, random).map((previousId) => ({
    id: newId(),
    printingId: state.game?.cards[previousId]?.printingId ?? null,
    previousId,
  }));
  return { type: 'libraryShuffled', playerId, cards };
}

/** Visibility after revealing `card` to `to`: the owner always keeps (or gains) sight. */
function revealEvent(card: CardInstance, ownerId: string, to: 'all' | string[], until: 'dismissed' | 'zoneChange'): GameEvent {
  let visibleTo: CardInstance['visibleTo'];
  if (card.visibleTo === 'all' || to === 'all') visibleTo = 'all';
  else {
    const current = card.visibleTo === 'owner' ? [ownerId] : card.visibleTo;
    visibleTo = [...new Set([ownerId, ...current, ...to])];
  }
  return { type: 'visibilityChanged', instanceId: card.id, visibleTo, revealUntil: until };
}

/** Casting a commander from the command zone adds 2 to its owner's commander tax (commander games only). */
function commanderTaxOnCast(state: RoomState, card: CardInstance, to: string): GameEvent[] {
  if (!state.settings.commander || !card.isCommander || card.zone !== 'command' || (to !== 'stack' && to !== 'battlefield')) return [];
  const pgs = state.game?.players[card.ownerId];
  if (!pgs) return [];
  return [{ type: 'commanderTaxChanged', playerId: card.ownerId, delta: 2, value: pgs.commanderTax + 2 }];
}

/** The slot after the last occupied column of `row` on `playerId`'s battlefield (+ offset for batches). */
function nextSlot(state: RoomState, playerId: string, row: number, offset = 0): { row: number; col: number } {
  const cols = (state.game?.players[playerId]?.zones.battlefield ?? [])
    .map((id) => state.game!.cards[id])
    .filter((c): c is CardInstance => !!c && c.position?.row === row && !c.attachedTo)
    .map((c) => c.position!.col);
  return { row, col: (cols.length ? Math.max(...cols) : -1) + 1 + offset };
}

/** Table decks built from the submitted draft decks (seats stay as drafted). */
function draftDecks(state: RoomState): Record<string, DeckContents> {
  const decks: Record<string, DeckContents> = {};
  if (!state.draft) return decks;
  for (const id of state.draft.seats) {
    const contents = draftDeckContents(state.draft, id);
    if (contents) decks[id] = contents;
  }
  return decks;
}

/** Seated winners, sorted; in 2v2 a team wins together. Undefined when someone is not seated. */
function normalizeWinners(state: RoomState, winners: string[]): string[] | undefined {
  if (winners.some((id) => !state.players[id])) return undefined;
  const ids = state.settings.mode === '2v2'
    ? Object.values(state.players).filter((p) => winners.some((w) => state.players[w]?.team === p.team)).map((p) => p.id)
    : [...new Set(winners)];
  return ids.sort();
}

/** Everyone agreed: record the result (unless untracked), then end the room or deal the next game. */
function settle(state: RoomState, pending: NonNullable<GameState['pendingResult']>, ctx: CommandContext): GameEvent[] {
  const events: GameEvent[] = [];
  if (pending.winners !== null) events.push({ type: 'resultReported', gameNumber: state.game?.gameNumber ?? 1, reportedBy: pending.proposedBy, winners: pending.winners, note: null, at: ctx.now.toISOString() });
  // Ending a game does not end the room: the table clears and everyone waits in the lobby.
  if (pending.then === 'end') {
    events.push({ type: 'gameEnded' });
    return events;
  }
  const dealt = deal(state, state.draft ? { ...ctx, decks: draftDecks(state) } : ctx);
  if (dealt.ok) events.push(...dealt.events);
  else events.push({ type: 'resultRejected', playerId: pending.proposedBy });
  return events;
}
