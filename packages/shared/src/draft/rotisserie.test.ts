import { describe, expect, it } from 'vitest';
import { dealDraft, decideDraft } from './decide.js';
import { projectDraft, visibleDraftCards } from './project.js';
import { reduceDraft } from './reduce.js';
import { rotisserieSeat, type DraftCard, type DraftConfig, type DraftState } from './types.js';

const config: DraftConfig = {
  name: 'Roti',
  seats: 4,
  startDirection: 'left',
  phases: [{ type: 'rotisserie', name: 'Rotisserie', poolCubeVersionId: 'main', poolSize: 10, picksPerPlayer: 2 }],
};
const pool: DraftCard[] = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, printingId: `p${i}` }));
const seats = ['a', 'b', 'c', 'd'];

function start(): DraftState {
  let n = 0;
  const r = dealDraft(config, seats, { pools: [pool], random: () => 0.999, newId: () => `id${n++}` });
  if (!r.ok) throw new Error(r.error);
  return reduceDraft(null, r.events[0]!)!;
}
function pick(s: DraftState, who: string, cardId: string): DraftState {
  const d = decideDraft(s, { type: 'rotisseriePick', cardId }, who);
  if (!d.ok) throw new Error(d.error);
  return d.events.reduce((st, e) => reduceDraft(st, e)!, s);
}

describe('Rotisserie', () => {
  it('snakes through the seats', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => rotisserieSeat(4, n))).toEqual([0, 1, 2, 3, 3, 2, 1, 0, 0]);
    expect([0, 1, 2, 3].map((n) => rotisserieSeat(2, n))).toEqual([0, 1, 1, 0]);
  });

  it('lays the table face up for everyone and takes one card per turn until everyone has their picks', () => {
    let s = start();
    expect(s.rotisserie).toMatchObject({ pickNumber: 0, activeSeat: 0 });
    expect([...visibleDraftCards(s, 'zed').keys()]).toHaveLength(10);
    expect(Object.values(projectDraft(s, 'zed').packs).flatMap((p) => p.cards).every((c) => c.printingId !== '')).toBe(true);
    expect(decideDraft(s, { type: 'rotisseriePick', cardId: 'c0' }, 'b')).toEqual({ ok: false, error: 'Not your turn' });
    expect(decideDraft(s, { type: 'rotisseriePick', cardId: 'nope' }, 'a')).toEqual({ ok: false, error: 'That card is not on the table' });

    const order: string[] = [];
    let n = 0;
    while (s.status === 'running') {
      const who = seats[s.rotisserie!.activeSeat]!;
      order.push(who);
      s = pick(s, who, `c${n++}`);
    }
    expect(order).toEqual(['a', 'b', 'c', 'd', 'd', 'c', 'b', 'a']);
    expect(s.rotisserie).toBeNull();
    expect(seats.map((id) => s.players[id]!.pool.map((c) => c.id))).toEqual([['c0', 'c7'], ['c1', 'c6'], ['c2', 'c5'], ['c3', 'c4']]);
    expect(s.packs[Object.keys(s.packs)[0]!]!.cards).toHaveLength(2); // the rest stays on the table
    expect(s.picks.map((p) => p.pickInPack)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(s.picks.every((p) => p.faceUp && !p.double)).toBe(true);
  });
});
