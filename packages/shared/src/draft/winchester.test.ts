import { describe, expect, it } from 'vitest';
import { dealDraft, decideDraft } from './decide.js';
import { projectDraft, visibleDraftCards } from './project.js';
import { reduceDraft } from './reduce.js';
import type { DraftCard, DraftConfig, DraftState } from './types.js';

const config: DraftConfig = {
  name: 'Winchester',
  seats: 2,
  startDirection: 'left',
  phases: [{ type: 'winchester', name: 'Winchester', poolCubeVersionId: 'main', stackSize: 12, piles: 4 }],
};
const pool: DraftCard[] = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, printingId: `p${i}` }));

function start(): DraftState {
  let n = 0;
  const r = dealDraft(config, ['a', 'b'], { pools: [pool], random: () => 0.999, newId: () => `id${n++}` });
  if (!r.ok) throw new Error(r.error);
  return reduceDraft(null, r.events[0]!)!;
}
function take(s: DraftState, who: string, index: number): DraftState {
  const d = decideDraft(s, { type: 'winchesterTake', index }, who);
  if (!d.ok) throw new Error(d.error);
  return d.events.reduce((st, e) => reduceDraft(st, e)!, s);
}
const piles = (s: DraftState) => s.winchester!.piles.map((p) => p.map((c) => c.id));
const stack = (s: DraftState) => s.packs[s.winchester!.packId]!.cards.map((c) => c.id);

describe('Winchester', () => {
  it('seeds one face-up card per pile, visible to everyone', () => {
    const s = start();
    expect(piles(s)).toEqual([['c0'], ['c1'], ['c2'], ['c3']]);
    expect(stack(s)).toEqual(['c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11']);
    expect([...visibleDraftCards(s, 'b').keys()]).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect([...visibleDraftCards(s, 'zed').keys()]).toHaveLength(4);
    expect(Object.values(projectDraft(s, 'zed').packs).flatMap((p) => p.cards).every((c) => c.printingId === '')).toBe(true);
    expect(decideDraft(s, { type: 'winchesterTake', index: 0 }, 'b')).toEqual({ ok: false, error: 'Not your turn' });
    expect(decideDraft(s, { type: 'winchesterTake', index: 4 }, 'a')).toEqual({ ok: false, error: 'No such pile' });
  });

  it('taking a pile grows every pile by one, alternates turns, and ends when nothing is left', () => {
    let s = start();
    s = take(s, 'a', 1);
    expect(s.players.a!.pool.map((c) => c.id)).toEqual(['c1']);
    expect(piles(s)).toEqual([['c0', 'c4'], ['c5'], ['c2', 'c6'], ['c3', 'c7']]);
    expect(stack(s)).toEqual(['c8', 'c9', 'c10', 'c11']);
    expect(s.winchester!.activeSeat).toBe(1);
    expect(s.picks[0]).toMatchObject({ playerId: 'a', pickInPack: 1, double: false, faceUp: true, packContents: ['p1'] });

    s = take(s, 'b', 0); // c0, c4
    expect(s.players.b!.pool.map((c) => c.id)).toEqual(['c0', 'c4']);
    expect(piles(s)).toEqual([['c8'], ['c5', 'c9'], ['c2', 'c6', 'c10'], ['c3', 'c7', 'c11']]);
    expect(stack(s)).toEqual([]);
    expect(s.picks.slice(-2).map((p) => p.double)).toEqual([false, true]);

    s = take(s, 'a', 2); // 3 cards, no refill
    expect(piles(s)).toEqual([['c8'], ['c5', 'c9'], [], ['c3', 'c7', 'c11']]);
    expect(decideDraft(s, { type: 'winchesterTake', index: 2 }, 'b')).toEqual({ ok: false, error: 'That pile is empty' });
    s = take(s, 'b', 3);
    s = take(s, 'a', 1);
    s = take(s, 'b', 0);
    expect(s.status).toBe('finished');
    expect(s.winchester).toBeNull();
    expect(s.players.a!.pool.length + s.players.b!.pool.length).toBe(12);
    expect(s.picks).toHaveLength(12);
  });
});
