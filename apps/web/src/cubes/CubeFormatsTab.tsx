import type { DraftConfigResponse, DraftConfigSummary } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { Button, Card, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { PoolHelper } from './PoolHelper';

/** The formats that deal from this cube. House rules is always there; others are saved formats (yours, shared with you, or offered to you). */
export function CubeFormatsTab({ cubeId }: { cubeId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const formats = useQuery({ queryKey: ['draft-configs'], queryFn: () => api<DraftConfigSummary[]>('/draft-configs') });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['draft-configs'] });
  const remove = useMutation({ mutationFn: (id: string) => api<void>(`/draft-configs/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const answer = useMutation({ mutationFn: ({ id, accept }: { id: string; accept: boolean }) => api<unknown>(`/draft-configs/${id}/membership`, { body: { accept } }), onSuccess: refresh });
  const copy = useMutation({
    mutationFn: (id: string) => api<DraftConfigResponse>(`/draft-configs/${id}/copy`, { method: 'POST' }),
    onSuccess: (res) => {
      refresh();
      navigate(`/drafts/${res.id}`);
    },
  });
  const busy = remove.isPending || answer.isPending || copy.isPending;
  const mine = formats.data?.filter((f) => f.cubeIds.includes(cubeId)) ?? [];
  const row = 'flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-raised';
  return (
    <Card title="Formats">
      <ErrorText error={formats.error ?? remove.error ?? answer.error ?? copy.error} />
      <ul className="flex flex-col gap-1">
        <li className={row}>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">House rules</span>
            <span className="mt-0.5 block text-text-muted">One pack of 5 from a tri-colour pool, then three packs of 15 from this cube. Built in; pick the pool cube when you start.</span>
          </span>
          <Link to={`/play/new?kind=draft&cube=${cubeId}`} className="shrink-0 text-accent hover:underline">Draft</Link>
        </li>
        {mine.map((f) => {
          if (f.deletedByOwner) {
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.name}</span>
                  <span className="block text-text-muted">{f.ownerName} deleted this format. Do you want to keep a copy of it, or delete it too?</span>
                </span>
                <Button variant="ghost" className="text-danger" disabled={busy} onClick={() => remove.mutate(f.id)}>Delete</Button>
                {f.membership === 'member' && <Button disabled={busy} onClick={() => copy.mutate(f.id)}>Create a copy</Button>}
              </li>
            );
          }
          if (f.membership === 'invited') {
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{f.name}</span>
                  <span className="block text-text-muted">{f.ownerName} wants to share this format with you.</span>
                </span>
                <Button variant="ghost" disabled={busy} onClick={() => answer.mutate({ id: f.id, accept: false })}>Reject</Button>
                <Button disabled={busy} onClick={() => answer.mutate({ id: f.id, accept: true })}>Accept</Button>
              </li>
            );
          }
          return (
            <li key={f.id} className={row}>
              <Link to={`/drafts/${f.id}`} className="min-w-0 flex-1">
                <span className="block truncate font-medium">{f.name}</span>
                <span className="mt-0.5 flex items-center gap-2 text-text-muted"><Chip type="neutral">{f.seats} players</Chip>{f.shared && <Chip type="primary" title="shared with you">by {f.ownerName}</Chip>}{f.phaseCount} phase{f.phaseCount === 1 ? '' : 's'} · {new Date(f.updatedAt).toLocaleDateString()}</span>
              </Link>
              <Link to={`/play/new?kind=draft&cube=${cubeId}&format=${f.id}`} className="shrink-0 text-accent hover:underline">Draft</Link>
              <Button variant="ghost" className={f.shared ? '' : 'text-danger'} onClick={() => confirm(f.shared ? `Stop sharing “${f.name}” with you? The owner keeps it.` : `Delete “${f.name}”? Players it is shared with will be asked whether to keep a copy.`) && remove.mutate(f.id)} disabled={busy}>{f.shared ? 'Remove' : 'Delete'}</Button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 border-t border-border pt-4">
        <h3 className="mb-2 text-sm font-semibold text-text-muted">House rules pool</h3>
        <PoolHelper cubeId={cubeId} onCreated={(c) => navigate(`/cubes/${c.cube.id}`)} />
      </div>
      <div className="mt-4 border-t border-border pt-4">
        <Link to={`/drafts/new?cube=${cubeId}`}><Button variant="ghost">New format for this cube</Button></Link>
      </div>
    </Card>
  );
}
