import type { CubeResponse, CubeSummary } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Button, Card, EmptyState, ErrorText, PageHeader } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';

/** What the cube page's Delete button should ask, given who is asking. */
export function deleteQuestion(c: { name: string; membership: CubeSummary['membership']; memberCount: number }): string {
  if (c.membership !== 'owner') return `Stop sharing “${c.name}” with you? The owner keeps it.`;
  return c.memberCount > 0
    ? `Delete “${c.name}”? It is shared with ${c.memberCount} player${c.memberCount === 1 ? '' : 's'}: each will be asked whether to keep a copy or delete it too.`
    : `Delete “${c.name}” and all its versions?`;
}

export function CubeListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const cubes = useQuery({ queryKey: ['cubes'], queryFn: () => api<CubeSummary[]>('/cubes') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['cubes'] });
  const remove = useMutation({ mutationFn: (id: string) => api<void>(`/cubes/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const answer = useMutation({ mutationFn: ({ id, accept }: { id: string; accept: boolean }) => api<unknown>(`/cubes/${id}/membership`, { body: { accept } }), onSuccess: refresh });
  const copy = useMutation({
    mutationFn: (id: string) => api<CubeResponse>(`/cubes/${id}/copy`, { method: 'POST' }),
    onSuccess: (res) => {
      refresh();
      navigate(`/cubes/${res.cube.id}`);
    },
  });
  const busy = remove.isPending || answer.isPending || copy.isPending;
  const row = 'flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-raised';

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <PageHeader title="Cubes" subtitle="The lists you draft from, with their versions, formats and stats." actions={<Link to="/cubes/new"><Button>New cube</Button></Link>} />
      <Card>
        <ErrorText error={cubes.error ?? remove.error ?? answer.error ?? copy.error} />
        {cubes.data?.length === 0 && (
          <EmptyState title="No cubes yet" text="Bring one over from Cube Cobra with its link, or paste the list. You can then draft it, share it and track its stats." action={<Link to="/cubes/new"><Button>Add your first cube</Button></Link>} />
        )}
        <ul className="flex flex-col gap-1">
          {cubes.data?.map((c) => {
            if (c.deletedByOwner) {
              // The owner is gone from it; it is ours to keep (as a copy) or to let go.
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-text-muted">{c.ownerName} deleted this cube. Do you want to keep a copy of it, or delete it too?</span>
                  </span>
                  <Button variant="ghost" className="text-danger" disabled={busy} onClick={() => remove.mutate(c.id)}>Delete</Button>
                  {c.membership === 'member' && <Button disabled={busy} onClick={() => copy.mutate(c.id)}>Create a copy</Button>}
                </li>
              );
            }
            if (c.membership === 'invited') {
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-text-muted">{c.ownerName} wants to share this cube with you ({c.cardCount} cards).</span>
                  </span>
                  <Button variant="ghost" disabled={busy} onClick={() => answer.mutate({ id: c.id, accept: false })}>Reject</Button>
                  <Button disabled={busy} onClick={() => answer.mutate({ id: c.id, accept: true })}>Accept</Button>
                </li>
              );
            }
            return (
              <li key={c.id} className={row}>
                <Link to={`/cubes/${c.id}`} className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{c.name}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-text-muted"><Chip type="neutral">v{c.latestVersion}</Chip>{c.shared && <Chip type="primary" title="shared with you">by {c.ownerName}</Chip>}{!c.shared && c.memberCount > 0 && <Chip type="neutral" title="players you share it with">shared · {c.memberCount}</Chip>}{c.cardCount} cards · {new Date(c.updatedAt).toLocaleDateString()}</span>
                </Link>
                <Button variant="ghost" className={c.shared ? '' : 'text-danger'} onClick={() => confirm(deleteQuestion(c)) && remove.mutate(c.id)} disabled={busy}>{c.shared ? 'Remove from my list' : 'Delete'}</Button>
              </li>
            );
          })}
        </ul>
      </Card>
    </main>
  );
}
