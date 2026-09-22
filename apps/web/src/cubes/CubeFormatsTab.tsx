import type { DraftConfigSummary } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button, Card, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';

/** The formats that deal from this cube. House rules is always there; others are saved formats (yours or shared with you). */
export function CubeFormatsTab({ cubeId }: { cubeId: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const formats = useQuery({ queryKey: ['draft-configs'], queryFn: () => api<DraftConfigSummary[]>('/draft-configs') });
  const remove = useMutation({
    mutationFn: (id: string) => api<void>(`/draft-configs/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['draft-configs'] }),
  });
  const mine = formats.data?.filter((f) => f.cubeIds.includes(cubeId)) ?? [];
  const row = 'flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-raised';
  return (
    <Card title="Formats">
      <ErrorText error={formats.error ?? remove.error} />
      <ul className="flex flex-col gap-1">
        <li className={row}>
          <span className="min-w-0 flex-1">
            <span className="block font-medium">House rules</span>
            <span className="mt-0.5 block text-text-muted">One pack of 5 from a tri-colour pool, then three packs of 15 from this cube. Built in; pick the pool cube when you start.</span>
          </span>
          <Link to={`/play/new?kind=draft&cube=${cubeId}`} className="shrink-0 text-accent hover:underline">Draft</Link>
        </li>
        {mine.map((f) => (
          <li key={f.id} className={row}>
            <Link to={`/drafts/${f.id}`} className="min-w-0 flex-1">
              <span className="block truncate font-medium">{f.name}</span>
              <span className="mt-0.5 flex items-center gap-2 text-text-muted"><Chip type="neutral">{f.seats} players</Chip>{f.shared && <Chip type="primary" title="shared with you">by {f.ownerName}</Chip>}{f.phaseCount} phase{f.phaseCount === 1 ? '' : 's'} · {new Date(f.updatedAt).toLocaleDateString()}</span>
            </Link>
            <Link to={`/play/new?kind=draft&cube=${cubeId}&format=${f.id}`} className="shrink-0 text-accent hover:underline">Draft</Link>
            {!f.shared && f.ownerId === me.data?.id && <Button variant="ghost" className="text-danger" onClick={() => confirm(`Delete “${f.name}”?`) && remove.mutate(f.id)} disabled={remove.isPending}>Delete</Button>}
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-border pt-4">
        <Link to={`/drafts/new?cube=${cubeId}`}><Button variant="ghost">New format for this cube</Button></Link>
      </div>
    </Card>
  );
}
