import type { DeckContents, PlayerStatsResponse, Record_ } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { CardImage } from '../cards/CardImage';
import { Card, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { useCards } from '../table/useCards';

const COLOUR_NAME: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
const COLOUR_BAR: Record<string, string> = { W: '#e9e2c9', U: '#4f8fd6', B: '#6b5b7b', R: '#d65a4a', G: '#4f9a5a' };

const wl = (r: Record_) => `${r.wins}–${r.losses}${r.draws ? `–${r.draws}` : ''}`;
const winRate = (r: Record_) => (r.games ? `${Math.round((r.wins / r.games) * 100)}%` : '—');

/** One player's record, head-to-head, draft tendencies and deck history. */
export function PlayerStatsPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const playerId = id === 'me' ? (me.data?.id ?? '') : id;
  const query = useQuery({ queryKey: ['players', playerId, 'stats'], queryFn: () => api<PlayerStatsResponse>(`/players/${playerId}/stats`), enabled: !!playerId });

  if (!playerId || query.isPending) return <main className="p-6 text-text-muted">Loading…</main>;
  if (query.isError) return <main className="p-6"><ErrorText error={query.error} /></main>;
  const { player, stats, names, printings } = query.data;
  const name = (pid: string) => names[pid] ?? '?';
  const byId = new Map(printings.map((p) => [p.id, p]));
  const own = player.id === me.data?.id;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{own ? 'My stats' : `${player.displayName} · stats`}</h1>
          <p className="text-sm text-text-muted">{stats.record.games} game{stats.record.games === 1 ? '' : 's'} · {wl(stats.record)} · {winRate(stats.record)} wins</p>
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="By format">
          {stats.byFormat.length === 0 && <p className="text-sm text-text-muted">No reported games yet. Use “Report result” at the table.</p>}
          <table className="w-full text-sm">
            <tbody>
              {stats.byFormat.map((f) => (
                <tr key={f.format} className="border-t border-border/50 first:border-t-0">
                  <td className="py-1">{f.format}</td>
                  <td className="py-1 text-right tabular-nums text-text-muted">{f.games} games</td>
                  <td className="py-1 text-right tabular-nums">{wl(f)}</td>
                  <td className="py-1 text-right tabular-nums">{winRate(f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Head-to-head">
          {stats.headToHead.length === 0 && <p className="text-sm text-text-muted">No opponents yet.</p>}
          <table className="w-full text-sm">
            <tbody>
              {stats.headToHead.map((h) => (
                <tr key={h.opponentId} className="border-t border-border/50 first:border-t-0">
                  <td className="py-1"><Link to={`/players/${h.opponentId}/stats`} className="text-accent hover:underline">{name(h.opponentId)}</Link></td>
                  <td className="py-1 text-right tabular-nums text-text-muted">{h.games} games</td>
                  <td className="py-1 text-right tabular-nums">{wl(h)}</td>
                  <td className="py-1 text-right tabular-nums">{winRate(h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <Card title={`Draft tendencies · ${stats.draft.drafts} draft${stats.draft.drafts === 1 ? '' : 's'}, ${stats.draft.picks} picks`}>
        {stats.draft.picks === 0 ? (
          <p className="text-sm text-text-muted">No drafts yet.</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-1">
                {stats.draft.colours.map((c) => (
                  <div key={c.colour} className="flex items-center gap-2">
                    <span className="w-12 text-text-muted">{COLOUR_NAME[c.colour]}</span>
                    <span className="h-3 flex-1 overflow-hidden rounded bg-surface-raised"><span className="block h-full" style={{ width: `${Math.round(c.share * 100)}%`, background: COLOUR_BAR[c.colour] }} /></span>
                    <span className="w-10 text-right tabular-nums">{Math.round(c.share * 100)}%</span>
                  </div>
                ))}
              </div>
              <p className="text-text-muted">
                Pick timing: {stats.draft.timing.earlierBy === null ? '—' : stats.draft.timing.earlierBy < -0.05 ? `takes cards ${Math.abs(stats.draft.timing.earlierBy).toFixed(1)} picks earlier than the group` : stats.draft.timing.earlierBy > 0.05 ? `takes cards ${stats.draft.timing.earlierBy.toFixed(1)} picks later than the group` : 'in step with the group'}
                {stats.draft.timing.compared > 0 && <span> · over {stats.draft.timing.compared} picks</span>}
              </p>
            </div>
            <div>
              <p className="mb-2 text-sm text-text-muted">Most picked</p>
              <ul className="grid grid-cols-5 gap-2 sm:grid-cols-8">
                {stats.draft.mostPicked.map((m) => {
                  const p = byId.get(m.printingId);
                  return (
                    <li key={m.printingId} className="relative text-xs">
                      {p ? <CardImage card={p} /> : <div className="aspect-[5/7] rounded-[4.5%] bg-surface-raised" />}
                      <Chip type="primary" shape="pill" className="absolute right-1 top-1 shadow">×{m.count}</Chip>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </Card>

      <Card title="Deck history">
        {stats.deckHistory.length === 0 && <p className="text-sm text-text-muted">Nothing yet.</p>}
        <ul className="flex flex-col gap-1 text-sm">
          {stats.deckHistory.map((d) => <HistoryRow key={`${d.roomId}:${d.gameNumber}`} entry={d} name={name} />)}
        </ul>
      </Card>
    </main>
  );
}

function HistoryRow({ entry, name }: { entry: PlayerStatsResponse['stats']['deckHistory'][number]; name: (id: string) => string }) {
  const [open, setOpen] = useState(false);
  const chip = entry.outcome === 'win' ? 'success' : entry.outcome === 'loss' ? 'error' : 'neutral';
  const size = entry.deck ? entry.deck.main.reduce((n, c) => n + c.quantity, 0) : 0;
  return (
    <li className="rounded-md px-2 py-1 hover:bg-surface-raised">
      <div className="flex flex-wrap items-center gap-2">
        <Chip type={chip} shape="pill" className="w-12 justify-center">{entry.outcome}</Chip>
        <span className="text-text-muted">{new Date(entry.at).toLocaleDateString()}</span>
        <span>{entry.format} · game {entry.gameNumber}</span>
        <span className="text-text-muted">vs {entry.opponents.map(name).join(', ')}{entry.teammates.length > 0 && ` · with ${entry.teammates.map(name).join(', ')}`}</span>
        <span className="ml-auto flex items-center gap-2">
          <Link to={`/rooms/${entry.roomId}`} className="text-accent hover:underline">room</Link>
          {entry.deck && <button type="button" className="text-accent hover:underline" onClick={() => setOpen((o) => !o)}>{open ? 'hide deck' : `deck · ${size}`}</button>}
        </span>
      </div>
      {open && entry.deck && <DeckList deck={entry.deck} />}
    </li>
  );
}

function DeckList({ deck }: { deck: DeckContents }) {
  const printings = useCards([...deck.main, ...deck.sideboard, ...deck.commander].map((c) => c.printingId));
  const line = (c: { printingId: string; quantity: number }) => `${c.quantity} ${printings.get(c.printingId)?.name ?? '…'}`;
  return (
    <div className="mt-2 grid gap-3 text-xs text-text-muted sm:grid-cols-3">
      <div><p className="mb-1 font-medium text-text">Main</p>{deck.main.map((c) => <div key={c.printingId}>{line(c)}</div>)}</div>
      {deck.sideboard.length > 0 && <div><p className="mb-1 font-medium text-text">Sideboard</p>{deck.sideboard.map((c) => <div key={c.printingId}>{line(c)}</div>)}</div>}
      {deck.commander.length > 0 && <div><p className="mb-1 font-medium text-text">Commander</p>{deck.commander.map((c) => <div key={c.printingId}>{line(c)}</div>)}</div>}
    </div>
  );
}
