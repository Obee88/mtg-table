import type { CardPrinting } from './cards.js';
import type { DeckContents } from './decks.js';
import { computeCardStats, type StatPick } from './draft/stats.js';
import type { GameMode, PlayerId } from './game/types.js';

/** A reported game as stored in `game_results`. */
export interface ResultRecord {
  roomId: string;
  gameNumber: number;
  winners: PlayerId[];
  mode: GameMode;
  playerCount: number;
  commander: boolean;
  draftName: string | null;
  players: { playerId: PlayerId; seat: number; team: number; deck: DeckContents | null }[];
  reportedAt: string;
}

/** A pick as needed for tendencies: who picked what, where in the pack. */
export interface PlayerPick extends StatPick {
  playerId: PlayerId;
  roomId: string;
}

export type Outcome = 'win' | 'loss' | 'draw';

export interface Record_ {
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface PlayerStats {
  playerId: PlayerId;
  record: Record_;
  /** Per format, most played first. */
  byFormat: (Record_ & { format: string })[];
  /** Against each opponent (teammates in 2v2 are not opponents), most played first. */
  headToHead: (Record_ & { opponentId: PlayerId })[];
  /** Newest first. */
  deckHistory: {
    roomId: string;
    gameNumber: number;
    at: string;
    format: string;
    outcome: Outcome;
    deck: DeckContents | null;
    opponents: PlayerId[];
    teammates: PlayerId[];
  }[];
  draft: {
    drafts: number;
    picks: number;
    /** Share of the player's picks that carry each colour (W U B R G), multicolour cards count for each. */
    colours: { colour: string; picks: number; share: number }[];
    mostPicked: { printingId: string; count: number }[];
    /** Mean of (own pick position − the card's average across everyone); negative = takes cards earlier than the group. */
    timing: { earlierBy: number | null; compared: number };
  };
}

/** "1v1", "4-player FFA", "2v2", with " Commander" and " draft" as applicable. */
export function formatOf(r: Pick<ResultRecord, 'mode' | 'playerCount' | 'commander' | 'draftName'>): string {
  const base = r.mode === '1v1' ? '1v1' : r.mode === 'ffa' ? `${r.playerCount}-player FFA` : '2v2';
  return `${base}${r.commander ? ' Commander' : ''}${r.draftName ? ' draft' : ''}`;
}

export function outcomeFor(r: ResultRecord, playerId: PlayerId): Outcome {
  if (r.winners.length === 0) return 'draw';
  return r.winners.includes(playerId) ? 'win' : 'loss';
}

const emptyRecord = (): Record_ => ({ games: 0, wins: 0, losses: 0, draws: 0 });
const tally = (rec: Record_, outcome: Outcome) => {
  rec.games++;
  if (outcome === 'win') rec.wins++;
  else if (outcome === 'loss') rec.losses++;
  else rec.draws++;
};

const COLOURS = ['W', 'U', 'B', 'R', 'G'];

/**
 * Everything about one player: results (only games they sat in), per format
 * and per opponent, deck history, and draft tendencies from their picks
 * compared with everyone's picks of the same cards.
 */
export function computePlayerStats(playerId: PlayerId, results: readonly ResultRecord[], picks: readonly PlayerPick[], printings: ReadonlyMap<string, Pick<CardPrinting, 'colorIdentity'>>): PlayerStats {
  const record = emptyRecord();
  const byFormat = new Map<string, Record_>();
  const h2h = new Map<PlayerId, Record_>();
  const deckHistory: PlayerStats['deckHistory'] = [];

  for (const r of results) {
    const me = r.players.find((p) => p.playerId === playerId);
    if (!me) continue;
    const outcome = outcomeFor(r, playerId);
    const format = formatOf(r);
    tally(record, outcome);
    const f = byFormat.get(format) ?? emptyRecord();
    tally(f, outcome);
    byFormat.set(format, f);
    const teammates = r.players.filter((p) => p.playerId !== playerId && r.mode === '2v2' && p.team === me.team).map((p) => p.playerId);
    const opponents = r.players.filter((p) => p.playerId !== playerId && !teammates.includes(p.playerId)).map((p) => p.playerId);
    for (const o of opponents) {
      const rec = h2h.get(o) ?? emptyRecord();
      // Against this opponent: a win is a win; a loss only counts when they (or their team) actually won.
      tally(rec, outcome === 'loss' && !r.winners.includes(o) ? 'draw' : outcome);
      h2h.set(o, rec);
    }
    deckHistory.push({ roomId: r.roomId, gameNumber: r.gameNumber, at: r.reportedAt, format, outcome, deck: me.deck, opponents, teammates });
  }
  deckHistory.sort((a, b) => b.at.localeCompare(a.at) || b.gameNumber - a.gameNumber);

  const mine = picks.filter((p) => p.playerId === playerId);
  const counts = new Map<string, number>();
  const colourCounts = new Map<string, number>();
  for (const p of mine) {
    counts.set(p.printingId, (counts.get(p.printingId) ?? 0) + 1);
    for (const c of printings.get(p.printingId)?.colorIdentity ?? []) colourCounts.set(c, (colourCounts.get(c) ?? 0) + 1);
  }
  const group = new Map(computeCardStats(picks).map((s) => [s.printingId, s.avgPick]));
  const diffs = mine.filter((p) => !p.double).map((p) => p.pickInPack - (group.get(p.printingId) ?? p.pickInPack));

  return {
    playerId,
    record,
    byFormat: [...byFormat].map(([format, rec]) => ({ format, ...rec })).sort((a, b) => b.games - a.games || a.format.localeCompare(b.format)),
    headToHead: [...h2h].map(([opponentId, rec]) => ({ opponentId, ...rec })).sort((a, b) => b.games - a.games || a.opponentId.localeCompare(b.opponentId)),
    deckHistory,
    draft: {
      drafts: new Set(mine.map((p) => p.roomId)).size,
      picks: mine.length,
      colours: COLOURS.map((colour) => ({ colour, picks: colourCounts.get(colour) ?? 0, share: mine.length ? (colourCounts.get(colour) ?? 0) / mine.length : 0 })),
      mostPicked: [...counts].map(([printingId, count]) => ({ printingId, count })).sort((a, b) => b.count - a.count || a.printingId.localeCompare(b.printingId)).slice(0, 15),
      timing: { earlierBy: diffs.length ? diffs.reduce((s, d) => s + d, 0) / diffs.length : null, compared: diffs.length },
    },
  };
}

/** API response: the stats plus the names and printings needed to render them. */
export interface PlayerStatsResponse {
  player: { id: PlayerId; displayName: string };
  stats: PlayerStats;
  names: Record<PlayerId, string>;
  printings: CardPrinting[];
}
