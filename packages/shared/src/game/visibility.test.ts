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
  for (const id of ids) step(id, { type: 'finishSideboarding' });
  for (const id of ids) step(id, { type: 'keepHand', bottom: [] });
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
    const d1 = decide(state, { type: 'moveCard', instanceId: hand, to: 'battlefield', position: { row: 0, col: 1 } }, ctx('a'));
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
    const started = projectEvents(log, 'a', initialRoomState('r')).find((e) => e.event.type === 'gameStarted')!;
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

describe('face-down projection', () => {
  it('opponents lose the identity while face down and get it back via revealed on face up', () => {
    const { state, log } = game(twoPlayer, ['a', 'b']);
    const id = state.game!.players.a!.zones.hand[0]!;
    const steps: Parameters<typeof decide>[1][] = [
      { type: 'moveCard', instanceId: id, to: 'battlefield' },
      { type: 'setFaceDown', instanceId: id, faceDown: true },
      { type: 'setFaceDown', instanceId: id, faceDown: false },
    ];
    let s = state;
    const events: RoomEvent[] = [];
    for (const c of steps) {
      const d = decide(s, c, ctx('a'));
      if (!d.ok) throw new Error(d.error);
      for (const event of d.events) events.push({ seq: log.length + events.length + 1, actorId: 'a', at: '', event });
      s = reduceAll(s, d.events);
    }
    const forB = projectEvents(events, 'b', state);
    expect(forB[0]?.revealed?.[0]?.instanceId).toBe(id); // played face up
    expect(forB[1]?.revealed).toBeUndefined();
    expect(forB[2]?.revealed?.[0]?.instanceId).toBe(id); // turned face up again
    const midway = projectState({ ...reduceAll(state, events.slice(0, 2).map((e) => e.event)), seq: 0 }, 'b');
    expect(midway.game!.cards[id]!.printingId).toBeNull();
    expect(projectState({ ...reduceAll(state, events.slice(0, 2).map((e) => e.event)), seq: 0 }, 'a').game!.cards[id]!.printingId).toBe('card-of-a');
  });
});

describe('reveals', () => {
  const setup = () => {
    const { state } = game(twoPlayer, ['a', 'b']);
    return state;
  };
  const step = (s: RoomState, actor: string, c: Parameters<typeof decide>[1]) => {
    const d = decide(s, c, ctx(actor));
    if (!d.ok) throw new Error(d.error);
    return reduceAll(s, d.events);
  };
  const seen = (s: RoomState, viewer: string, id: string) => projectState(s, viewer).game!.cards[id]!.printingId !== null;

  it('reveal hand to one player lasts until the card changes zones', () => {
    let s = setup();
    const [h0] = s.game!.players.a!.zones.hand;
    s = step(s, 'a', { type: 'revealHand', to: ['b'] });
    expect(seen(s, 'b', h0!)).toBe(true);
    expect(seen(s, 'a', h0!)).toBe(true);
    s = step(s, 'a', { type: 'draw', count: 1 });
    const drawn = s.game!.players.a!.zones.hand.at(-1)!;
    expect(seen(s, 'b', drawn)).toBe(false); // drawn later, not part of the reveal
    s = step(s, 'a', { type: 'moveCard', instanceId: h0!, to: 'library', libraryPosition: 'bottom' });
    expect(seen(s, 'b', h0!)).toBe(false);
    expect(seen(s, 'a', h0!)).toBe(false);
  });

  it('look at top is private, reorder must be a permutation, dismiss hides again', () => {
    let s = setup();
    const lib = s.game!.players.a!.zones.library;
    expect(lib).toHaveLength(2); // 9-card deck, 7 drawn
    s = step(s, 'a', { type: 'openLibraryView', kind: 'top', count: 1 });
    expect(seen(s, 'a', lib[0]!)).toBe(true);
    expect(seen(s, 'a', lib[1]!)).toBe(false);
    expect(seen(s, 'b', lib[0]!)).toBe(false);
    expect(decide(s, { type: 'reorderLibraryTop', instanceIds: [lib[0]!, 'nope'] }, ctx('a')).ok).toBe(false);
    s = step(s, 'a', { type: 'reorderLibraryTop', instanceIds: [lib[1]!, lib[0]!] });
    expect(s.game!.players.a!.zones.library).toEqual([lib[1], lib[0]]);
    s = step(s, 'a', { type: 'closeLibraryView', shuffle: false });
    expect(seen(s, 'a', lib[0]!)).toBe(false);
    expect(s.game!.players.a!.libraryView).toBeNull();
    for (const v of ['a', 'b']) assertNoLeak(s, v);
  });

  it('reveals a top card to everyone, and the permanent top-card reveal follows the library', () => {
    let s = setup();
    const lib = s.game!.players.a!.zones.library;
    s = step(s, 'a', { type: 'revealCards', instanceIds: [lib[0]!], to: 'all', until: 'dismissed' });
    expect(seen(s, 'b', lib[0]!)).toBe(true);
    s = step(s, 'a', { type: 'dismissReveal', instanceIds: [lib[0]!] });
    expect(seen(s, 'b', lib[0]!)).toBe(false);
    s = step(s, 'a', { type: 'setTopRevealed', enabled: true });
    expect(seen(s, 'b', lib[0]!)).toBe(true);
    expect(seen(s, 'b', lib[1]!)).toBe(false);
    s = step(s, 'a', { type: 'draw', count: 1 });
    expect(seen(s, 'b', lib[0]!)).toBe(false); // now in a's hand
    expect(seen(s, 'b', lib[1]!)).toBe(true); // new top
    s = step(s, 'a', { type: 'setTopRevealed', enabled: false });
    expect(seen(s, 'b', lib[1]!)).toBe(false);
  });

  it('a player may discard a hand card that was revealed to them, but nothing else', () => {
    let s = setup();
    const [h0, h1] = s.game!.players.a!.zones.hand;
    expect(decide(s, { type: 'moveCard', instanceId: h0!, to: 'graveyard' }, ctx('b')).ok).toBe(false);
    s = step(s, 'a', { type: 'revealCards', instanceIds: [h0!], to: ['b'], until: 'zoneChange' });
    expect(decide(s, { type: 'moveCard', instanceId: h0!, to: 'battlefield' }, ctx('b')).ok).toBe(false);
    expect(decide(s, { type: 'moveCard', instanceId: h1!, to: 'graveyard' }, ctx('b')).ok).toBe(false);
    s = step(s, 'b', { type: 'moveCard', instanceId: h0!, to: 'graveyard' });
    expect(s.game!.cards[h0!]).toMatchObject({ zone: 'graveyard', ownerId: 'a', visibleTo: 'all' });
    expect(s.game!.players.a!.zones.graveyard).toEqual([h0]);
  });

  it('projected replay with reveals still equals projected state, and reveals produce revealed identities', () => {
    const { state, log } = game(twoPlayer, ['a', 'b']);
    const lib = state.game!.players.a!.zones.library;
    const cmds: [string, Parameters<typeof decide>[1]][] = [
      ['a', { type: 'revealCards', instanceIds: [lib[0]!, lib[1]!], to: ['b'], until: 'dismissed' }],
      ['a', { type: 'reorderLibraryTop', instanceIds: [lib[1]!, lib[0]!] }],
      ['a', { type: 'dismissReveal' }],
      ['a', { type: 'setTopRevealed', enabled: true }],
      ['b', { type: 'draw', count: 1 }],
    ];
    let s = state;
    const extra: RoomEvent[] = [];
    for (const [actor, c] of cmds) {
      const d = decide(s, c, ctx(actor));
      if (!d.ok) throw new Error(d.error);
      for (const event of d.events) extra.push({ seq: log.length + extra.length + 1, actorId: actor, at: '', event });
      s = reduceAll(s, d.events);
    }
    const full = { ...s, seq: log.length + extra.length };
    for (const viewer of ['a', 'b']) {
      const projected = projectEvents([...log, ...extra], viewer, initialRoomState('r'));
      expect(projected.reduce(applyRoomEvent, initialRoomState('r'))).toEqual(projectState(full, viewer));
    }
    const forB = projectEvents(extra, 'b', state);
    expect(forB[0]?.revealed?.map((r) => r.instanceId)).toEqual([lib[0]]);
    expect(forB[1]?.revealed?.map((r) => r.instanceId)).toEqual([lib[1]]);
  });
});

describe('hidden identities', () => {
  it('tells the viewer to forget a card after a dismissed reveal', () => {
    const { state, log } = game(twoPlayer, ['a', 'b']);
    const top = state.game!.players.a!.zones.library[0]!;
    const d1 = decide(state, { type: 'revealCards', instanceIds: [top], to: 'all', until: 'dismissed' }, ctx('a'));
    const s1 = reduceAll(state, d1.ok ? d1.events : []);
    const d2 = decide(s1, { type: 'dismissReveal' }, ctx('a'));
    const events: RoomEvent[] = [...(d1.ok ? d1.events : []), ...(d2.ok ? d2.events : [])].map((event, i) => ({ seq: log.length + i + 1, actorId: 'a', at: '', event }));
    const forB = projectEvents(events, 'b', state);
    expect(forB[0]?.revealed?.[0]?.instanceId).toBe(top);
    expect(forB[1]?.hidden).toEqual([top]);
    let client = projectState(state, 'b');
    for (const e of forB) client = applyRoomEvent(client, e);
    expect(client.game!.cards[top]!.printingId).toBeNull();
  });
});

describe('top card revealed across shuffles', () => {
  it('keeps the new top card identified for everyone after a shuffle', async () => {
    const { decide } = await import('./decide.js');
    const { initialRoomState, reduce } = await import('./reduce.js');
    let state = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false } });
    const ctx = (actorId: string) => ({ actorId, actorDisplayName: actorId, now: new Date('2026-01-01'), random: () => 0.5, newId: (() => { let n = 0; return () => `n${n++}`; })() });
    const run = (actor: string, command: Parameters<typeof decide>[1], extra: Record<string, unknown> = {}) => {
      const d = decide(state, command, { ...ctx(actor), ...extra });
      if (!d.ok) throw new Error(d.error);
      const before = state;
      const stored = d.events.map((event, i) => ({ seq: state.seq + i + 1, actorId: actor, at: 'now', event }));
      state = stored.reduce((s, e) => ({ ...reduce(s, e.event), seq: e.seq }), state);
      return { before, stored };
    };
    const decks = { a: { main: [{ printingId: 'bolt', quantity: 9 }], sideboard: [], commander: [] }, b: { main: [{ printingId: 'bear', quantity: 9 }], sideboard: [], commander: [] } };
    for (const p of ['a', 'b']) {
      run(p, { type: 'join' });
      run(p, { type: 'selectDeck', deckId: 'd' });
      run(p, { type: 'setReady', ready: true });
    }
    run('a', { type: 'start' }, { decks });
    run('a', { type: 'finishSideboarding' });
    run('b', { type: 'finishSideboarding' });
    run('a', { type: 'keepHand', bottom: [] });
    run('b', { type: 'keepHand', bottom: [] });
    run('a', { type: 'setTopRevealed', enabled: true });

    // Bob's replica, built from projected events, must show Alice's top card after she shuffles.
    let bob = projectState(state, 'b');
    const { before, stored } = run('a', { type: 'shuffleLibrary' });
    for (const e of projectEvents(stored, 'b', before)) bob = applyRoomEvent(bob, e);
    const top = state.game!.players.a!.zones.library[0]!;
    expect(bob.game!.cards[top]!.printingId).toBe('bolt');
    expect(bob).toEqual(projectState(state, 'b'));
    // The rest of the library stays hidden.
    expect(state.game!.players.a!.zones.library.slice(1).every((id) => bob.game!.cards[id]!.printingId === null)).toBe(true);
  });
});

describe('library views', () => {
  const setup = () => {
    const { state } = game(twoPlayer, ['a', 'b']);
    return state;
  };
  const step = (s: RoomState, actor: string, c: Parameters<typeof decide>[1]) => {
    const d = decide(s, c, ctx(actor));
    if (!d.ok) throw new Error(d.error);
    return reduceAll(s, d.events);
  };
  const seen = (s: RoomState, viewer: string, id: string) => projectState(s, viewer).game!.cards[id]!.printingId !== null;

  it('shows the owner the top cards, tracks where they go and what was revealed, and hides them again on close', () => {
    let s = setup();
    const lib = s.game!.players.a!.zones.library;
    expect(lib).toHaveLength(2);
    s = step(s, 'a', { type: 'openLibraryView', kind: 'top', count: 5 }); // clamps to what is there
    const view = () => s.game!.players.a!.libraryView!;
    expect(view()).toEqual({ kind: 'top', cards: [lib[0], lib[1]], placed: {}, revealed: [] });
    expect(seen(s, 'a', lib[0]!)).toBe(true);
    expect(seen(s, 'b', lib[0]!)).toBe(false);
    expect(decide(s, { type: 'openLibraryView', kind: 'search' }, ctx('a'))).toEqual({ ok: false, error: 'Close the current library view first' });

    // Reveal one to everyone; put the other on the bottom; the peek learns both.
    s = step(s, 'a', { type: 'revealCards', instanceIds: [lib[0]!], to: 'all', until: 'dismissed' });
    expect(seen(s, 'b', lib[0]!)).toBe(true);
    expect(view().revealed).toEqual([lib[0]]);
    s = step(s, 'a', { type: 'moveCard', instanceId: lib[1]!, to: 'library', libraryPosition: 'bottom' });
    expect(view().placed).toEqual({ [lib[1]!]: 'bottom' });
    s = step(s, 'a', { type: 'moveCard', instanceId: lib[0]!, to: 'hand' });
    expect(view().placed).toEqual({ [lib[1]!]: 'bottom', [lib[0]!]: 'hand' });
    for (const v of ['a', 'b']) assertNoLeak(s, v);

    // Done: what is left in the library is hidden from everyone again, the view is gone.
    s = step(s, 'a', { type: 'closeLibraryView', shuffle: false });
    expect(s.game!.players.a!.libraryView).toBeNull();
    expect(seen(s, 'a', lib[1]!)).toBe(false);
    expect(decide(s, { type: 'closeLibraryView', shuffle: false }, ctx('a'))).toEqual({ ok: false, error: 'No library view is open' });
    for (const v of ['a', 'b']) assertNoLeak(s, v);
  });

  it('a search covers the whole library, and shuffling closes it, keeping a tutored card on top when asked', () => {
    let s = setup();
    const lib = [...s.game!.players.a!.zones.library];
    s = step(s, 'a', { type: 'openLibraryView', kind: 'search' });
    expect(s.game!.players.a!.libraryView!.cards).toEqual(lib);
    expect(lib.every((id) => seen(s, 'a', id))).toBe(true);
    // Tutor the last card to the top, then shuffle the rest under it: it stays first (re-keyed, hidden again).
    const wanted = s.game!.cards[lib[lib.length - 1]!]!.printingId;
    s = step(s, 'a', { type: 'moveCard', instanceId: lib[lib.length - 1]!, to: 'library', libraryPosition: 'top' });
    let n = 0;
    const kept = decide(s, { type: 'closeLibraryView', shuffle: true, keepTop: 1 }, { ...ctx('a'), random: () => 0.3, newId: () => `k${++n}` });
    const afterKept = reduceAll(s, kept.ok ? kept.events : []);
    const top = afterKept.game!.players.a!.zones.library[0]!;
    expect(afterKept.game!.cards[top]!.printingId).toBe(wanted);
    expect(top).not.toBe(lib[lib.length - 1]);
    expect(seen(afterKept, 'a', top)).toBe(false);
    expect(afterKept.game!.players.a!.libraryView).toBeNull();
    const d = decide(s, { type: 'closeLibraryView', shuffle: true }, { ...ctx('a'), random: () => 0.3, newId: () => `n${Math.random()}` });
    expect(d.ok && d.events.map((e) => e.type)).toEqual(['libraryViewClosed', 'libraryShuffled']);
    s = reduceAll(s, d.ok ? d.events : []);
    expect(s.game!.players.a!.libraryView).toBeNull();
    expect(s.game!.players.a!.zones.library.every((id) => !seen(s, 'a', id))).toBe(true);
    for (const v of ['a', 'b']) assertNoLeak(s, v);
  });
});
