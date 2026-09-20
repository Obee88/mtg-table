import { describe, expect, it } from 'vitest';
import { dealDraft, decideDraft } from './decide.js';
import { projectDraft, visibleDraftCards } from './project.js';
import { reduceDraft } from './reduce.js';
import type { DraftCard, DraftConfig, DraftState } from './types.js';
import { gridLine } from './types.js';

const config: DraftConfig = {
  name: 'Grid',
  seats: 2,
  startDirection: 'left',
  phases: [{ type: 'grid', name: 'Grid', poolCubeVersionId: 'main', grids: 2, size: 3 }],
};
const pool: DraftCard[] = Array.from({ length: 18 }, (_, i) => ({ id: `c${i}`, printingId: `p${i}` }));

function start(): DraftState {
  let n = 0;
  const r = dealDraft(config, ['a', 'b'], { pools: [pool], random: () => 0.999, newId: () => `id${n++}` });
  if (!r.ok) throw new Error(r.error);
  return reduceDraft(null, r.events[0]!)!;
}
function pick(s: DraftState, who: string, line: 'row' | 'col', index: number): DraftState {
  const d = decideDraft(s, { type: 'gridPick', line, index }, who);
  if (!d.ok) throw new Error(d.error);
  return d.events.reduce((st, e) => reduceDraft(st, e)!, s);
}
const cells = (s: DraftState) => s.grid!.cells.map((c) => c?.id ?? null);

describe('Grid', () => {
  it('lays out the first grid face up for everyone, seat 0 picking first', () => {
    const s = start();
    expect(cells(s)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
    expect(s.grid).toMatchObject({ activeSeat: 0, picksThisGrid: 0, size: 3 });
    expect([...visibleDraftCards(s, 'b').keys()]).toHaveLength(9);
    expect([...visibleDraftCards(s, 'zed').keys()]).toHaveLength(9);
    expect(projectDraft(s, 'b').grid!.cells.every((c) => c && c.printingId !== '')).toBe(true);
    expect(gridLine(3, 'col', 1)).toEqual([1, 4, 7]);
    expect(decideDraft(s, { type: 'gridPick', line: 'row', index: 0 }, 'b')).toEqual({ ok: false, error: 'Not your turn' });
    expect(decideDraft(s, { type: 'gridPick', line: 'row', index: 3 }, 'a')).toEqual({ ok: false, error: 'No such line' });
  });

  it('takes a row, then the other player a partial column, then moves to the next grid with the other player first', () => {
    let s = start();
    s = pick(s, 'a', 'row', 1);
    expect(s.players.a!.pool.map((c) => c.id)).toEqual(['c3', 'c4', 'c5']);
    expect(cells(s)).toEqual(['c0', 'c1', 'c2', null, null, null, 'c6', 'c7', 'c8']);
    expect(s.grid).toMatchObject({ activeSeat: 1, picksThisGrid: 1 });
    expect(s.picks.map((p) => [p.pickInPack, p.double, p.faceUp])).toEqual([[1, false, true], [1, true, true], [1, true, true]]);
    expect(decideDraft(s, { type: 'gridPick', line: 'row', index: 1 }, 'b')).toEqual({ ok: false, error: 'That line is empty' });
    s = pick(s, 'b', 'col', 0);
    expect(s.players.b!.pool.map((c) => c.id)).toEqual(['c0', 'c6']);
    // Both picked: the leftovers are discarded and grid 2 opens with seat 1 first.
    expect(s.round).toBe(1);
    expect(cells(s)).toEqual(['c9', 'c10', 'c11', 'c12', 'c13', 'c14', 'c15', 'c16', 'c17']);
    expect(s.grid).toMatchObject({ activeSeat: 1, picksThisGrid: 0 });
    expect(s.picks.at(-1)).toMatchObject({ pickInPack: 2, packContents: ['p0', 'p1', 'p2', 'p6', 'p7', 'p8'] });

    s = pick(s, 'b', 'col', 2);
    s = pick(s, 'a', 'row', 0);
    expect(s.status).toBe('finished');
    expect(s.grid).toBeNull();
    expect(s.players.a!.pool).toHaveLength(5);
    expect(s.players.b!.pool).toHaveLength(5);
  });
});
