import type { CardStat, CubeStatsResponse } from '@mtg/shared';
import { mostPassed } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { CardImage } from '../cards/CardImage';
import { Card, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';

type Column = 'name' | 'pickRate' | 'avgPick' | 'firstPickRate' | 'seen' | 'taken' | 'passed';
const COLUMNS: { key: Column; label: string; title: string }[] = [
  { key: 'name', label: 'Card', title: 'Card name' },
  { key: 'pickRate', label: 'Pick rate', title: 'Taken ÷ times seen in a pack when a pick was made' },
  { key: 'avgPick', label: 'Avg pick', title: 'Mean position in the pack when taken (1 = first pick)' },
  { key: 'firstPickRate', label: 'First-pick', title: 'First-picked ÷ times it was in an untouched pack' },
  { key: 'seen', label: 'Seen', title: 'Times in a pack when a pick was made' },
  { key: 'taken', label: 'Taken', title: 'Times drafted' },
  { key: 'passed', label: 'Passed', title: 'Times someone chose another card over it' },
];

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const num = (v: number | null) => (v === null ? '—' : v.toFixed(1));

/** Draft statistics of a cube: every card with pick rate, average pick, first-pick rate, and the most-passed list. */
export function CubeStatsPage() {
  const { id = '' } = useParams();
  const [version, setVersion] = useState<number | 'all'>('all');
  const [sort, setSort] = useState<{ key: Column; desc: boolean }>({ key: 'pickRate', desc: true });
  const query = useQuery({ queryKey: ['cubes', id, 'stats', version], queryFn: () => api<CubeStatsResponse>(`/cubes/${id}/stats${version === 'all' ? '' : `?version=${version}`}`) });
  const all = useQuery({ queryKey: ['cubes', id, 'stats', 'all'], queryFn: () => api<CubeStatsResponse>(`/cubes/${id}/stats`) });

  if (query.isPending) return <main className="p-6 text-text-muted">Loading…</main>;
  if (query.isError) return <main className="p-6"><ErrorText error={query.error} /></main>;
  const { cube, stats, printings, drafts, picks } = query.data;
  const byId = new Map(printings.map((p) => [p.id, p]));
  const name = (s: CardStat) => byId.get(s.printingId)?.name ?? s.printingId;
  const value = (s: CardStat, key: Column): number | string => (key === 'name' ? name(s) : (s[key] ?? -1));
  const rows = [...stats].sort((a, b) => {
    const x = value(a, sort.key);
    const y = value(b, sort.key);
    const c = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y);
    return sort.desc ? -c : c;
  });
  const clickSort = (key: Column) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'name' && key !== 'avgPick' }));
  const versions = all.data?.versions ?? query.data.versions;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="truncate text-2xl font-semibold">{cube.name} · draft stats</h1>
          <p className="text-sm text-text-muted">{drafts} draft{drafts === 1 ? '' : 's'} · {picks} picks</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-text-muted">Version</span>
            <select className="rounded-md border border-border bg-surface px-2 py-1.5 text-text" value={version} onChange={(e) => setVersion(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">all versions</option>
              {versions.map((v) => <option key={v.id} value={v.number}>v{v.number}{v.note ? ` · ${v.note}` : ''}</option>)}
            </select>
          </label>
          <Link to={`/cubes/${id}`} className="text-accent hover:underline">Cube</Link>
        </div>
      </header>

      {stats.length === 0 ? (
        <Card><p className="text-sm text-text-muted">No drafts with this cube yet. Statistics appear once a draft has been played.</p></Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Card title="Every card">
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-surface text-xs text-text-muted">
                  <tr>
                    {COLUMNS.map((c) => (
                      <th key={c.key} className={`cursor-pointer py-1 pr-3 font-medium hover:text-text ${c.key === 'name' ? '' : 'text-right'}`} title={c.title} onClick={() => clickSort(c.key)}>
                        {c.label}{sort.key === c.key ? (sort.desc ? ' ↓' : ' ↑') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const p = byId.get(s.printingId);
                    return (
                      <tr key={s.printingId} className="border-t border-border/50 hover:bg-surface-raised">
                        <td className="py-1 pr-3">
                          <span className="flex items-center gap-2">
                            {p && <CardImage card={p} className="w-7 shrink-0" />}
                            <span className="truncate">{name(s)}</span>
                          </span>
                        </td>
                        <td className="text-right tabular-nums">{pct(s.pickRate)}</td>
                        <td className="text-right tabular-nums">{num(s.avgPick)}</td>
                        <td className="text-right tabular-nums">{pct(s.firstPickRate)}<span className="text-text-muted"> /{s.firstPickChances}</span></td>
                        <td className="text-right tabular-nums">{s.seen}</td>
                        <td className="text-right tabular-nums">{s.taken}</td>
                        <td className="text-right tabular-nums">{s.passed}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          <Card title="Most passed">
            <p className="mb-3 text-xs text-text-muted">Candidates to cut: seen often, rarely taken.</p>
            <ol className="flex flex-col gap-1 text-sm">
              {mostPassed(stats, 15).map((s, i) => (
                <li key={s.printingId} className="flex items-center gap-2">
                  <span className="w-5 text-right text-text-muted">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate">{name(s)}</span>
                  <Chip type="neutral" title="passed">{s.passed}×</Chip>
                  <Chip type={s.pickRate !== null && s.pickRate < 0.2 ? 'warning' : 'neutral'} title="pick rate">{pct(s.pickRate)}</Chip>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </main>
  );
}
