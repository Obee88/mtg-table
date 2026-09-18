import { describe, expect, it } from 'vitest';
import { decide, type CommandContext } from './decide.js';
import type { RoomEvent } from './events.js';
import { initialRoomState, reduce, reduceAll } from './reduce.js';
import type { RoomSettings, RoomState } from './types.js';
import { applyRoomEvent, canSee, projectEvents, projectState } from './visibility.js';

const ctx = (actorId: string): CommandContext => ({ actorId, actorDisplayName: actorId, now: new Date(0) });
let n = 0;
let r = 0;
const startCtx = (actorId: string, decks: NonNullable<CommandContext['decks']>): CommandContext => ({ ...ctx(actorId), decks, random: () => ((r += 7) % 11) / 11, newId: () => `c${++n}` });

function game(settings: RoomSettings, ids: string[]): { state: RoomState; log: RoomEvent[] } {
  let state = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: ids[0]!, settings });
  const log: RoomEvent[] = [{ seq: 1, actorId: null, at: '', event: { type: 'roomCreated', ownerId: ids[0]!, settings } }];
  const step = (actor: string, command: Parameters<typeof decide>[1], c = ctx(actor)) => {
    const d = decide(state, command, c);
    if (!d.ok) throw new Error(d.error);
    for (const event of d.events) log.push({ seq: log.length + 1, actorId: actor, at: '', event });
    state = { ...reduceAll(state, d.events), seq: log.length };
  };
  const decks = Object.fromEntries(ids.map((id) => [id, { main: [{ printingId: `card-of-${id}`, quantity: 9 }], sideboard: [{ printingId: `sb-${id}`, quantity: 1 }], commander: [{ printingId: `cmd-${id}`, quantity: 1 }] }]));
  for (const id of ids) {
    step(id, { type: 'join' });
    step(id, { type: 'selectDeck', deckId: 'd' });
    step(id, { type: 'setReady', ready: true });
  }
  step(ids[0]!, { type: 'start' }, startCtx(ids[0]!, decks));
  return { state, log };
}

/** Every identity present in a projected state must be one the viewer may see in the full state. */
function assertNoLeak(full: RoomState, viewer: string) {
  const projected = projectState(full, viewer);
  for (const card of Object.values(projected.game!.cards)) {
    const real = full.game!.cards[card.id]!;
    if (card.printingId !== null) expect(canSee(full, real, viewer)).toBe(true);
    if (!canSee(full, real, viewer)) expect(card).toMatchObject({ printingId: null, note: null });
  }
}

const twoPlayer: RoomSettings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };

describe('projectState', () => {
  it('hides every library card from everyone, opponents’ hands, and shows public zones', () => {
    const { state } = game(twoPlayer, ['a', 'b']);
    const forA = projectState(state, 'a');
    const g = state.game!;
    const idsOf = (p: string, zone: 'library' | 'hand' | 'command' | 'sideboard') => g.players[p]!.zones[zone];
    for (const id of [...idsOf('a', 'library'), ...idsOf('b', 'library'), ...idsOf('b', 'hand'), ...idsOf('b', 'sideboard')]) expect(forA.game!.cards[id]!.printingId).toBeNull();
    for (const id of [...idsOf('a', 'hand'), ...idsOf('a', 'sideboard'), ...idsOf('a', 'command'), ...idsOf('b', 'command')]) expect(forA.game!.cards[id]!.printingId).not.toBeNull();
    assertNoLeak(state, 'a');
    assertNoLeak(state, 'b');
  });

  it('lets 2v2 teammates see each other’s hands but not opponents’', () => {
    const { state } = game({ playerCount: 4, mode: '2v2', startingLife: 30, commander: false }, ['a', 'b', 'c', 'd']);
    // seats 0 & 2 (a, c) are a team
    const g = state.game!;
    const forA = projectState(state, 'a');
    expect(forA.game!.cards[g.players.c!.zones.hand[0]!]!.printingId).not.toBeNull();
    expect(forA.game!.cards[g.players.b!.zones.hand[0]!]!.printingId).toBeNull();
    for (const v of ['a', 'b', 'c', 'd']) assertNoLeak(state, v);
  });

  it('never leaks across a random sequence of moves', () => {
    let { state } = game(twoPlayer, ['a', 'b']);
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const zones = ['hand', 'battlefield', 'graveyard', 'exile', 'library'] as const;
    for (let i = 0; i < 200; i++) {
      const actor = rnd() < 0.5 ? 'a' : 'b';
      const mine = Object.values(state.game!.cards).filter((c) => c.controllerId === actor);
      const card = mine[Math.floor(rnd() * mine.length)]!;
      const to = zones[Math.floor(rnd() * zones.length)]!;
      const d = decide(state, { type: 'moveCard', instanceId: card.id, to, libraryPosition: rnd() < 0.5 ? 'top' : 'bottom' }, ctx(actor));
      if (d.ok) state = reduceAll(state, d.events);
      assertNoLeak(state, 'a');
      assertNoLeak(state, 'b');
    }
  });
});

describe('projectEvents + applyRoomEvent', () => {
  it('a client that only ever receives projected data ends up with exactly the projected state', () => {
    const { state, log } = game(twoPlayer, ['a', 'b']);
    // Play a card from a's hand, then b draws.
    const hand = state.game!.players.a!.zones.hand[0]!;
    const d1 = decide(state, { type: 'moveCard', instanceId: hand, to: 'battlefield', position: { x: 1, y: 1 } }, ctx('a'));
    const s1 = reduceAll(state, d1.ok ? d1.events : []);
    const d2 = decide(s1, { type: 'draw', count: 1 }, ctx('b'));
    const s2 = reduceAll(s1, d2.ok ? d2.events : []);
    const extra: RoomEvent[] = [...(d1.ok ? d1.events : []), ...(d2.ok ? d2.events : [])].map((event, i) => ({ seq: log.length + i + 1, actorId: 'x', at: '', event }));
    const full = { ...s2, seq: log.length + extra.length };

    for (const viewer of ['a', 'b']) {
      const projected = projectEvents([...log, ...extra], viewer, initialRoomState('r'));
      const clientState = projected.reduce(applyRoomEvent, initialRoomState('r'));
      expect(clientState).toEqual(projectState(full, viewer));
    }
  });

  it('reveals identities on hand→battlefield to the opponent, and draws only to the drawer', () => {
    const { state, log } = game(twoPlayer, ['a', 'b']);
    const hand = state.game!.players.a!.zones.hand[0]!;
    const d1 = decide(state, { type: 'moveCard', instanceId: hand, to: 'battlefield' }, ctx('a'));
    const d2 = decide(reduceAll(state, d1.ok ? d1.events : []), { type: 'draw', count: 1 }, ctx('b'));
    const events: RoomEvent[] = [...(d1.ok ? d1.events : []), ...(d2.ok ? d2.events : [])].map((event, i) => ({ seq: log.length + i + 1, actorId: 'x', at: '', event }));
    const forA = projectEvents(events, 'a', state);
    const forB = projectEvents(events, 'b', state);
    expect(forB[0]?.revealed).toEqual([{ instanceId: hand, printingId: 'card-of-a' }]);
    expect(forA[0]?.revealed).toBeUndefined(); // a already knew it
    expect(forB[1]?.revealed).toEqual([{ instanceId: expect.any(String), printingId: 'card-of-b' }]);
    expect(forA[1]?.revealed).toBeUndefined();
  });

  it('strips gameStarted identities the viewer may not see', () => {
    const { state, log } = game(twoPlayer, ['a', 'b']);
    const started = projectEvents(log, 'a', initialRoomState('r')).at(-1)!;
    if (started.event.type !== 'gameStarted') throw new Error('expected gameStarted');
    const layout = started.event.players;
    expect(layout.a!.hand.every((c) => c.printingId === 'card-of-a')).toBe(true);
    expect(layout.a!.library.every((c) => c.printingId === null)).toBe(true);
    expect(layout.b!.hand.every((c) => c.printingId === null)).toBe(true);
    expect(layout.b!.command.every((c) => c.printingId === 'cmd-b')).toBe(true);
    expect(JSON.stringify(started)).not.toContain('card-of-b');
    expect(state.game).not.toBeNull();
  });
});

describe('shuffle projection', () => {
  it('hides identities and the old→new mapping from everyone, including the owner', () => {
    const { state, log } = game(twoPlayer, ['a', 'b']);
    let k = 0;
    const d = decide(state, { type: 'shuffleLibrary' }, { ...ctx('a'), random: () => ((k += 3) % 7) / 7, newId: () => `s${++k}` });
    if (!d.ok) throw new Error(d.error);
    const stored: RoomEvent = { seq: log.length + 1, actorId: 'a', at: '', event: d.events[0]! };
    for (const viewer of ['a', 'b']) {
      const [p] = projectEvents([stored], viewer, state);
      if (p!.event.type !== 'libraryShuffled') throw new Error('expected libraryShuffled');
      expect(p!.event.cards.every((c) => c.printingId === null && c.previousId === null)).toBe(true);
      expect(p!.revealed).toBeUndefined();
      const after = applyRoomEvent(projectState(state, viewer), p!);
      const full = reduceAll(state, d.events);
      expect(after).toEqual(projectState({ ...full, seq: stored.seq }, viewer));
    }
  });
});
