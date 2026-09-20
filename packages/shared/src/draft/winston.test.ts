import { describe, expect, it } from 'vitest';
import { dealDraft, decideDraft } from './decide.js';
import type { DraftEvent } from './events.js';
import { projectDraft, visibleDraftCards } from './project.js';
import { reduceDraft } from './reduce.js';
import type { DraftCard, DraftConfig, DraftState } from './types.js';

const config: DraftConfig = {
  name: 'Winston',
  seats: 2,
  startDirection: 'left',
  phases: [{ type: 'winston', name: 'Winston', poolCubeVersionId: 'main', stackSize: 8, piles: 3 }],
};
const pool: DraftCard[] = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, printingId: `p${i}` }));
const identity = () => 0.999; // shuffle keeps order: c0 top of the stack

function start(): DraftState {
  let n = 0;
  const r = dealDraft(config, ['a', 'b'], { pools: [pool], random: identity, newId: () => `id${n++}` });
  if (!r.ok) throw new Error(r.error);
  return reduceDraft(null, r.events[0]!)!;
}
function act(s: DraftState, who: string, take: boolean): DraftState {
  const d = decideDraft(s, { type: 'winstonDecide', take }, who);
  if (!d.ok) throw new Error(d.error);
  return d.events.reduce((st, e) => reduceDraft(st, e)!, s);
}
const stack = (s: DraftState) => s.packs[s.winston!.packId]!.cards.map((c) => c.id);
const piles = (s: DraftState) => s.winston!.piles.map((p) => p.map((c) => c.id));

describe('Winston', () => {
  it('seeds the piles from the stack and starts with seat 0 looking at pile 1', () => {
    const s = start();
    expect(piles(s)).toEqual([['c0'], ['c1'], ['c2']]);
    expect(stack(s)).toEqual(['c3', 'c4', 'c5', 'c6', 'c7']);
    expect(s.winston).toMatchObject({ activeSeat: 0, pileIndex: 0 });
    expect(decideDraft(s, { type: 'winstonDecide', take: true }, 'b')).toEqual({ ok: false, error: 'Not your turn' });
  });

  it('passing grows a pile and moves on; taking refills the pile and passes the turn', () => {
    let s = start();
    s = act(s, 'a', false);
    expect(piles(s)).toEqual([['c0', 'c3'], ['c1'], ['c2']]);
    expect(s.winston).toMatchObject({ activeSeat: 0, pileIndex: 1 });
    s = act(s, 'a', true);
    expect(s.players.a!.pool.map((c) => c.id)).toEqual(['c1']);
    expect(piles(s)).toEqual([['c0', 'c3'], ['c4'], ['c2']]);
    expect(stack(s)).toEqual(['c5', 'c6', 'c7']);
    expect(s.winston).toMatchObject({ activeSeat: 1, pileIndex: 0 });
    expect(s.picks).toHaveLength(1);
    expect(s.picks[0]).toMatchObject({ playerId: 'a', pickInPack: 1, double: false, packContents: ['p1'] });
  });

  it('passing on the last pile takes the next stack card blind, and the game ends when everything is gone', () => {
    let s = start();
    s = act(s, 'a', false); // pile 1 ← c3
    s = act(s, 'a', false); // pile 2 ← c4
    s = act(s, 'a', false); // pile 3 ← c5, then c6 blind
    expect(s.players.a!.pool.map((c) => c.id)).toEqual(['c6']);
    expect(piles(s)).toEqual([['c0', 'c3'], ['c1', 'c4'], ['c2', 'c5']]);
    expect(stack(s)).toEqual(['c7']);
    expect(s.winston).toMatchObject({ activeSeat: 1, pileIndex: 0 });
    expect(s.picks.at(-1)).toMatchObject({ playerId: 'a', card: { id: 'c6' }, double: false });

    s = act(s, 'b', true); // pile 1 (2 cards), refilled with c7
    expect(s.players.b!.pool.map((c) => c.id)).toEqual(['c0', 'c3']);
    expect(piles(s)).toEqual([['c7'], ['c1', 'c4'], ['c2', 'c5']]);
    expect(stack(s)).toEqual([]);
    expect(s.picks.slice(-2).map((p) => p.double)).toEqual([false, true]);

    s = act(s, 'a', false); // no stack: pile 1 stays, look at pile 2
    expect(piles(s)).toEqual([['c7'], ['c1', 'c4'], ['c2', 'c5']]);
    s = act(s, 'a', false);
    s = act(s, 'a', false); // passed everything, nothing blind: turn passes
    expect(s.players.a!.pool).toHaveLength(1);
    expect(s.winston).toMatchObject({ activeSeat: 1, pileIndex: 0 });
    s = act(s, 'b', true); // c7; pile 1 now empty and skipped
    expect(s.winston).toMatchObject({ activeSeat: 0, pileIndex: 1 });
    s = act(s, 'a', true);
    s = act(s, 'b', true);
    expect(s.status).toBe('finished');
    expect(s.winston).toBeNull();
    expect(s.players.a!.pool.length + s.players.b!.pool.length).toBe(8);
    expect(decideDraft(s, { type: 'winstonDecide', take: true }, 'a')).toEqual({ ok: false, error: 'Draft is not running' });
  });

  it('shows only the active player the pile at hand', () => {
    let s = start();
    expect([...visibleDraftCards(s, 'a').keys()]).toEqual(['c0']);
    expect([...visibleDraftCards(s, 'b').keys()]).toEqual([]);
    const forB = projectDraft(s, 'b');
    expect(forB.winston!.piles.flat().every((c) => c.printingId === '')).toBe(true);
    expect(Object.values(forB.packs).flatMap((p) => p.cards).every((c) => c.printingId === '')).toBe(true);
    s = act(s, 'a', false);
    expect([...visibleDraftCards(s, 'a').keys()]).toEqual(['c1']);
    const d = decideDraft(s, { type: 'winstonDecide', take: true }, 'a');
    const ev = (d as { events: DraftEvent[] }).events[0]!;
    expect(ev.type === 'winstonTaken' && ev.cards[0]?.printingId).toBe('p1');
  });
});
