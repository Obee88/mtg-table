import type { CubeSummary } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button, Card, EmptyState, ErrorText, PageHeader } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';

export function CubeListPage() {
  const qc = useQueryClient();
  const cubes = useQuery({ queryKey: ['cubes'], queryFn: () => api<CubeSummary[]>('/cubes') });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/cubes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cubes'] }),
  });
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <PageHeader title="Cubes" subtitle="The lists you draft from, with their versions, formats and stats." actions={<Link to="/cubes/new"><Button>New cube</Button></Link>} />
      <Card>
        <ErrorText error={cubes.error ?? remove.error} />
        {cubes.data?.length === 0 && (
          <EmptyState title="No cubes yet" text="Bring one over from Cube Cobra with its link, or paste the list. You can then draft it, share it and track its stats." action={<Link to="/cubes/new"><Button>Add your first cube</Button></Link>} />
        )}
        <ul className="flex flex-col gap-1">
          {cubes.data?.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
              <Link to={`/cubes/${c.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="mt-0.5 flex items-center gap-2 text-text-muted"><Chip type="neutral">v{c.latestVersion}</Chip>{c.shared && <Chip type="primary" title="shared with you">by {c.ownerName}</Chip>}{c.cardCount} cards · {new Date(c.updatedAt).toLocaleDateString()}</span>
              </Link>
              <Button variant="ghost" className="text-danger" onClick={() => confirm(`Delete “${c.name}” and all its versions?`) && remove.mutate(c.id)} disabled={remove.isPending}>Delete</Button>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
