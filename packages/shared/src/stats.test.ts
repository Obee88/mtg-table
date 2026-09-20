import { describe, expect, it } from 'vitest';
import { computePlayerStats, formatOf, type PlayerPick, type ResultRecord } from './stats.js';

const game = (roomId: string, n: number, winners: string[], players: string[], extra: Partial<ResultRecord> = {}): ResultRecord => ({
  roomId, gameNumber: n, winners, mode: players.length === 2 ? '1v1' : 'ffa', playerCount: players.length as 2 | 4, commander: false, draftName: null,
  players: players.map((playerId, seat) => ({ playerId, seat, team: seat, deck: { main: [{ printingId: `${playerId}-card`, quantity: 40 }], sideboard: [], commander: [] } })),
  reportedAt: `2026-01-0${n}T00:00:00.000Z`,
  ...extra,
});
const pick = (playerId: string, printingId: string, pickInPack: number, roomId = 'd1', double = false): PlayerPick => ({ playerId, printingId, pickInPack, packContents: [printingId], double, roomId });

describe('computePlayerStats', () => {
  it('tallies results overall, per format and per opponent, newest deck first', () => {
    const results = [
      game('r1', 1, ['a'], ['a', 'b']),
      game('r1', 2, ['b'], ['a', 'b']),
      game('r1', 3, [], ['a', 'b']),
      game('r2', 1, ['a', 'c'], ['a', 'b', 'c', 'd'], { mode: '2v2', players: ['a', 'b', 'c', 'd'].map((p, seat) => ({ playerId: p, seat, team: seat % 2, deck: null })), commander: true, reportedAt: '2026-01-01T12:00:00.000Z' }),
      game('r3', 1, ['c'], ['b', 'c']), // a did not play
    ];
    const s = computePlayerStats('a', results, [], new Map());
    expect(s.record).toEqual({ games: 4, wins: 2, losses: 1, draws: 1 });
    expect(s.byFormat).toEqual([
      { format: '1v1', games: 3, wins: 1, losses: 1, draws: 1 },
      { format: '2v2 Commander', games: 1, wins: 1, losses: 0, draws: 0 },
    ]);
    expect(s.headToHead).toEqual([
      { opponentId: 'b', games: 4, wins: 2, losses: 1, draws: 1 },
      { opponentId: 'd', games: 1, wins: 1, losses: 0, draws: 0 },
    ]);
    expect(s.deckHistory.map((d) => [d.roomId, d.gameNumber, d.outcome, d.teammates, d.opponents])).toEqual([
      ['r1', 3, 'draw', [], ['b']],
      ['r1', 2, 'loss', [], ['b']],
      ['r2', 1, 'win', ['c'], ['b', 'd']],
      ['r1', 1, 'win', [], ['b']],
    ]);
    expect(s.deckHistory[3]!.deck?.main[0]?.quantity).toBe(40);
    expect(formatOf({ mode: 'ffa', playerCount: 4, commander: false, draftName: 'House' })).toBe('4-player FFA draft');
  });

  it('a loss to a third player is not a loss against an opponent who also lost', () => {
    const s = computePlayerStats('a', [game('r', 1, ['c'], ['a', 'b', 'c', 'd'])], [], new Map());
    expect(s.headToHead.find((h) => h.opponentId === 'b')).toEqual({ opponentId: 'b', games: 1, wins: 0, losses: 0, draws: 1 });
    expect(s.headToHead.find((h) => h.opponentId === 'c')).toEqual({ opponentId: 'c', games: 1, wins: 0, losses: 1, draws: 0 });
  });

  it('derives colours, most-picked cards and pick timing against the group', () => {
    const printings = new Map([
      ['bolt', { colorIdentity: ['R'] }],
      ['helix', { colorIdentity: ['R', 'W'] }],
      ['bear', { colorIdentity: ['G'] }],
    ]);
    const picks = [
      pick('a', 'bolt', 1), pick('a', 'bolt', 3, 'd2'), pick('a', 'helix', 2), pick('a', 'bear', 5, 'd2', true),
      pick('b', 'bolt', 5), pick('b', 'helix', 2), pick('c', 'bolt', 9),
    ];
    const s = computePlayerStats('a', [], picks, printings);
    expect(s.draft.drafts).toBe(2);
    expect(s.draft.picks).toBe(4);
    expect(s.draft.mostPicked).toEqual([{ printingId: 'bolt', count: 2 }, { printingId: 'bear', count: 1 }, { printingId: 'helix', count: 1 }]);
    expect(s.draft.colours.map((c) => [c.colour, c.picks])).toEqual([['W', 1], ['U', 0], ['B', 0], ['R', 3], ['G', 1]]);
    // bolt group average = (1+3+5+9)/4 = 4.5; helix = 2. a's regular picks: 1−4.5, 3−4.5, 2−2 → mean −5/3.
    expect(s.draft.timing.compared).toBe(3);
    expect(s.draft.timing.earlierBy).toBeCloseTo(-5 / 3);
    expect(computePlayerStats('zed', [], [], new Map()).draft.timing).toEqual({ earlierBy: null, compared: 0 });
  });
});
