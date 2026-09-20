import { describe, expect, it } from 'vitest';
import { dealDraft, decideDraft } from './decide.js';
import type { DraftEvent } from './events.js';
import { applyDraftIdentities, projectDraft, projectDraftEvent, visibleDraftCards } from './project.js';
import { reduceDraft } from './reduce.js';
import { cardsNeeded, directionFor, nextSeat, type DraftCard, type DraftConfig, type DraftState } from './types.js';

/** The house rules: a 20-card tri-colour phase (4×5), then three rounds of 15 from the main cube. */
const house: DraftConfig = {
  name: 'House',
  seats: 4,
  startDirection: 'right',
  phases: [
    { type: 'pickAndPass', name: 'Tri-colour', poolCubeVersionId: 'tri', packSize: 5, packsPerPlayer: 1, rounds: 1, direction: 'alternate' },
    { type: 'pickAndPass', name: 'Main', poolCubeVersionId: 'main', packSize: 15, packsPerPlayer: 1, rounds: 3, direction: 'alternate' },
  ],
};
const seats = ['a', 'b', 'c', 'd'];
const pool = (prefix: string, n: number): DraftCard[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, printingId: `p-${prefix}${i}` }));

/** Deterministic LCG so shuffles are reproducible. */
function rng(seed = 1) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}
function deal(config = house, pools = [pool('t', 20), pool('m', 360)]) {
  let n = 0;
  const r = dealDraft(config, seats, { pools, random: rng(), newId: () => `pack${n++}` });
  if (!r.ok) throw new Error(r.error);
  return r.events[0]!;
}
function start(config = house): DraftState {
  return reduceDraft(null, deal(config))!;
}
/** Every seated player picks the first card of the pack at hand. */
function everyonePicks(s: DraftState, opts: { faceUp?: boolean } = {}): DraftState {
  for (const id of s.seats) {
    const d = decideDraft(s, { type: 'draftPick', cardId: s.packs[s.players[id]!.queue[0]!]!.cards[0]!.id, ...opts }, id);
    if (!d.ok) throw new Error(d.error);
    s = reduceDraft(s, d.events[0]!)!;
  }
  return s;
}

describe('dealing', () => {
  it('deals every phase and round up front, using only what is needed', () => {
    const started = deal();
    expect(started.type).toBe('draftStarted');
    if (started.type !== 'draftStarted') return;
    expect(started.packs).toHaveLength(4 + 12);
    expect(started.packs.filter((p) => p.phase === 0).every((p) => p.cards.length === 5)).toBe(true);
    expect(started.packs.filter((p) => p.phase === 1).every((p) => p.cards.length === 15)).toBe(true);
    expect(started.dealt).toHaveLength(2);
    expect(started.dealt[1]).toHaveLength(3);
    expect(started.dealt[1]![0]).toHaveLength(4);
    const ids = started.packs.flatMap((p) => p.cards.map((c) => c.id));
    expect(new Set(ids).size).toBe(20 + 180);
    expect(cardsNeeded(house, house.phases[1]!)).toBe(180);
  });

  it('refuses a pool that is too small', () => {
    const r = dealDraft(house, seats, { pools: [pool('t', 20), pool('m', 100)], random: rng(), newId: () => 'x' });
    expect(r).toEqual({ ok: false, error: 'Phase 2 (Main) needs 180 cards but the pool has 100' });
    expect(dealDraft(house, ['a', 'b'], { pools: [], random: rng(), newId: () => 'x' })).toEqual({ ok: false, error: 'This draft needs 4 players' });
  });
});

describe('directions and passing', () => {
  it('alternates every round across phases from the start direction', () => {
    const [tri, main] = house.phases as [DraftConfig['phases'][0], DraftConfig['phases'][0]];
    expect([0, 1, 2, 3].map((g) => directionFor(house, g === 0 ? tri : main, g))).toEqual(['right', 'left', 'right', 'left']);
    expect(directionFor(house, { ...main, direction: 'left' }, 3)).toBe('left');
    expect(nextSeat(4, 3, 'left')).toBe(0);
    expect(nextSeat(4, 0, 'right')).toBe(3);
  });

  it('passes the rest of the pack to the next seat', () => {
    let s = start();
    expect(s.direction).toBe('right');
    const packOfA = s.players.a!.queue[0]!;
    const pick = decideDraft(s, { type: 'draftPick', cardId: s.packs[packOfA]!.cards[2]!.id }, 'a');
    expect(pick.ok).toBe(true);
    s = reduceDraft(s, (pick as { events: DraftEvent[] }).events[0]!)!;
    expect(s.players.a!.queue).toEqual([]);
    expect(s.players.a!.pool).toHaveLength(1);
    // Passing right from seat 0 lands on seat 3 (d), behind d's own pack.
    expect(s.players.d!.queue).toEqual([s.dealt[0]![0]![3]![0], packOfA]);
    expect(s.packs[packOfA]!.cards).toHaveLength(4);
  });

  it('rejects picks that are not from the pack at hand', () => {
    const s = start();
    expect(decideDraft(s, { type: 'draftPick', cardId: 'nope' }, 'a')).toEqual({ ok: false, error: 'That card is not in your current pack' });
    expect(decideDraft(s, { type: 'draftPick', cardId: 't0' }, 'zed')).toEqual({ ok: false, error: 'Not in the draft' });
    const s2 = everyonePicks(s);
    const otherPack = s2.players.a!.queue[0]!;
    const notMine = Object.values(s2.packs).find((p) => p.id !== otherPack && p.cards.length > 0)!;
    expect(decideDraft(s2, { type: 'draftPick', cardId: notMine.cards[0]!.id }, 'a').ok).toBe(false);
  });
});

describe('rounds and phases', () => {
  it('runs the whole house draft: 5 + 45 cards each, directions flipping each round', () => {
    let s = start();
    const directions: string[] = [s.direction];
    for (let i = 0; i < 5; i++) s = everyonePicks(s);
    expect(s.phase).toBe(1);
    expect(s.round).toBe(0);
    expect(s.globalRound).toBe(1);
    directions.push(s.direction);
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 15; i++) s = everyonePicks(s);
      if (s.status === 'running') directions.push(s.direction);
    }
    expect(directions).toEqual(['right', 'left', 'right', 'left']);
    expect(s.status).toBe('finished');
    for (const id of seats) {
      expect(s.players[id]!.pool).toHaveLength(50);
      expect(s.players[id]!.queue).toEqual([]);
    }
    expect(s.picks).toHaveLength(200);
    expect(decideDraft(s, { type: 'draftPick', cardId: 'x' }, 'a')).toEqual({ ok: false, error: 'Draft is not running' });
  });

  it('records each pick with its pack context', () => {
    let s = start();
    s = everyonePicks(s);
    s = everyonePicks(s);
    const [first, , , , fifth] = s.picks;
    expect(first).toMatchObject({ n: 1, phase: 0, round: 0, playerId: 'a', pickInPack: 1, double: false });
    expect(first!.packContents).toHaveLength(5);
    expect(first!.packContents).toContain(first!.card.printingId);
    expect(fifth).toMatchObject({ n: 5, playerId: 'a', pickInPack: 2 });
    expect(fifth!.packContents).toHaveLength(4);
  });

  it('keeps the pack in hand on a double pick', () => {
    let s = start();
    const packId = s.players.a!.queue[0]!;
    const [c1, c2] = s.packs[packId]!.cards;
    s = reduceDraft(s, { type: 'draftPicked', playerId: 'a', packId, cardId: c1!.id, printingId: c1!.printingId, faceUp: false, double: true })!;
    expect(s.players.a!.queue).toEqual([packId]);
    s = reduceDraft(s, { type: 'draftPicked', playerId: 'a', packId, cardId: c2!.id, printingId: c2!.printingId, faceUp: false, double: false })!;
    expect(s.players.a!.queue).toEqual([]);
    expect(s.players.a!.pool).toHaveLength(2);
    expect(s.picks.map((p) => p.double)).toEqual([true, false]);
  });
});

describe('projection', () => {
  it('shows only the pack at hand, the viewer\'s own pool and face-up picks; only own picks are logged', () => {
    let s = start();
    s = everyonePicks(s); // hidden picks
    s = everyonePicks(s, { faceUp: true });
    const view = projectDraft(s, 'a');
    const mine = view.players.a!.queue[0]!;
    expect(view.packs[mine]!.cards.every((c) => c.printingId !== '')).toBe(true);
    for (const [id, p] of Object.entries(view.packs)) if (id !== mine) expect(p.cards.every((c) => c.printingId === '')).toBe(true);
    expect(view.players.a!.pool.every((c) => c.printingId !== '')).toBe(true);
    expect(view.players.b!.pool.map((c) => c.printingId === '')).toEqual([true, false]);
    expect(view.players.b!.faceUp[0]!.printingId).not.toBe('');
    // Others' records keep their numbering but only face-up cards stay named; pack contents are blank.
    expect(view.picks.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(view.picks.filter((p) => p.playerId !== 'a').map((p) => p.card.printingId !== '')).toEqual([false, false, false, true, true, true]);
    expect(view.picks.filter((p) => p.playerId !== 'a').every((p) => p.packContents.every((c) => c === ''))).toBe(true);
    expect(view.picks.filter((p) => p.playerId === 'a').every((p) => p.packContents.every((c) => c !== ''))).toBe(true);

    const visible = visibleDraftCards(s, 'a');
    expect(visible.size).toBe(3 + 2 + 3); // pack at hand (5 − 2 picks), own pool, others' face-up picks
  });

  it('applies revealed/hidden identities wherever the cards sit', () => {
    let s = start();
    s = everyonePicks(s);
    const stripped = projectDraft(s, 'zed'); // nobody: everything blank
    const mine = s.players.a!.queue[0]!;
    const revealed = s.packs[mine]!.cards.map((c) => ({ cardId: c.id, printingId: c.printingId }));
    const applied = applyDraftIdentities(stripped, [...revealed, { cardId: s.players.a!.pool[0]!.id, printingId: s.players.a!.pool[0]!.printingId }], []);
    expect(applied.packs[mine]).toEqual(s.packs[mine]);
    expect(applied.players.a!.pool).toEqual(s.players.a!.pool);
    expect(applyDraftIdentities(applied, [], revealed.map((r) => r.cardId)).packs[mine]!.cards.every((c) => c.printingId === '')).toBe(true);
  });

  it('strips identities from the events others receive', () => {
    const started = deal();
    const p = projectDraftEvent(started, 'a');
    if (p.type !== 'draftStarted') throw new Error('type');
    expect(p.packs.every((pk) => pk.cards.every((c) => c.printingId === null))).toBe(true);
    const picked: DraftEvent = { type: 'draftPicked', playerId: 'b', packId: 'x', cardId: 'y', printingId: 'z', faceUp: false, double: false };
    const printingOf = (e: DraftEvent) => (e.type === 'draftPicked' ? e.printingId : undefined);
    expect(printingOf(projectDraftEvent(picked, 'a'))).toBeNull();
    expect(printingOf(projectDraftEvent(picked, 'b'))).toBe('z');
    expect(printingOf(projectDraftEvent({ ...picked, faceUp: true }, 'a'))).toBe('z');
  });

  it('rebuilds the same state from stripped events plus own picks (ids are stable)', () => {
    const started = deal();
    const full = reduceDraft(null, started)!;
    const stripped = reduceDraft(null, projectDraftEvent(started, 'a'))!;
    expect(Object.keys(stripped.packs)).toEqual(Object.keys(full.packs));
    expect(stripped.players.a!.queue).toEqual(full.players.a!.queue);
  });
});
