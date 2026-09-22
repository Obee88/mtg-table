import type { DeckSummary } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button, Card, EmptyState, ErrorText, PageHeader } from '../components';
import { api } from '../lib/api';

export function DeckListPage() {
  const qc = useQueryClient();
  const decks = useQuery({ queryKey: ['decks'], queryFn: () => api<DeckSummary[]>('/decks') });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/decks/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decks'] }),
  });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <PageHeader title="Decks" subtitle="What you bring to a constructed game. Drafted decks land here from Past drafts." actions={<Link to="/decks/new"><Button>Import deck</Button></Link>} />
      <Card>
        <ErrorText error={decks.error ?? remove.error} />
        {decks.isPending && <p className="text-sm text-text-muted">Loading…</p>}
        {decks.data?.length === 0 && (
          <EmptyState title="No decks yet" text="Paste a decklist, upload a file, or drop in a Moxfield or Archidekt link. Sideboards and commanders come along." action={<Link to="/decks/new"><Button>Import your first deck</Button></Link>} />
        )}
        <ul className="flex flex-col gap-1">
          {decks.data?.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
              <Link to={`/decks/${d.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-medium">{d.name}</span>
                <span className="block text-text-muted">
                  {d.mainCount} main{d.sideboardCount > 0 && ` · ${d.sideboardCount} side`}{d.commanderCount > 0 && ` · ${d.commanderCount} commander`}
                  {' · '}{new Date(d.updatedAt).toLocaleDateString()}
                </span>
              </Link>
              <Button variant="ghost" className="text-danger" onClick={() => confirm(`Delete “${d.name}”?`) && remove.mutate(d.id)} disabled={remove.isPending}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
