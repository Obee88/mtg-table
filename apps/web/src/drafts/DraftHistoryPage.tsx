import type { DraftHistoryItem } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';

export const DRAFT_TYPE_LABELS: Record<string, string> = {
  pickAndPass: 'pick and pass',
  winston: 'Winston',
  grid: 'Grid',
  winchester: 'Winchester',
  rotisserie: 'Rotisserie',
};

/** Every draft the signed-in player took part in, newest first; each opens their drafted cards. */
export function DraftHistoryPage() {
  const drafts = useQuery({ queryKey: ['drafts', 'history'], queryFn: () => api<DraftHistoryItem[]>('/drafts/history') });
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Past drafts</h1>
        <div className="flex items-center gap-3 text-sm">
        </div>
      </header>
      <Card>
        <ErrorText error={drafts.error} />
        {drafts.data?.length === 0 && <p className="text-sm text-text-muted">No drafts yet. Once you have drafted, your pools and decks show up here.</p>}
        <ul className="flex flex-col gap-1">
          {drafts.data?.map((d) => (
            <li key={d.roomId}>
              <Link to={`/drafts/history/${d.roomId}`} className="block rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
                <span className="block truncate font-medium">{d.name ?? d.format}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-2 text-text-muted">
                  <span>{new Date(d.startedAt).toLocaleDateString()}</span>
                  <Chip type="neutral">{d.format}</Chip>
                  {d.types.map((t) => <Chip key={t} type="neutral">{DRAFT_TYPE_LABELS[t] ?? t}</Chip>)}
                  <span>{d.players.map((p) => p.displayName).join(', ')}</span>
                  <span className="ml-auto tabular-nums">{d.picks} picks</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
