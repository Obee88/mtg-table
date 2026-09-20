import type { DraftConfigSummary } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button, Card, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';

export function DraftConfigListPage() {
  const qc = useQueryClient();
  const configs = useQuery({ queryKey: ['draft-configs'], queryFn: () => api<DraftConfigSummary[]>('/draft-configs') });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/draft-configs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['draft-configs'] }),
  });
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Draft formats</h1>
        <div className="flex items-center gap-3">
          <Link to="/" className="text-sm text-accent hover:underline">Home</Link>
          <Link to="/drafts/new"><Button>New format</Button></Link>
        </div>
      </header>
      <Card>
        <ErrorText error={configs.error ?? remove.error} />
        {configs.data?.length === 0 && <p className="text-sm text-text-muted">No draft formats yet. Start from the house rules.</p>}
        <ul className="flex flex-col gap-1">
          {configs.data?.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
              <Link to={`/drafts/${c.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="mt-0.5 flex items-center gap-2 text-text-muted"><Chip type="neutral">{c.seats} players</Chip>{c.phaseCount} phase{c.phaseCount === 1 ? '' : 's'} · {new Date(c.updatedAt).toLocaleDateString()}</span>
              </Link>
              <Button variant="ghost" className="text-danger" onClick={() => confirm(`Delete “${c.name}”?`) && remove.mutate(c.id)} disabled={remove.isPending}>Delete</Button>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
