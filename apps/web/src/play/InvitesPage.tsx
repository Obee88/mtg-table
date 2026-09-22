import type { Invite } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';

/** Admin only: invite links for new members of the group. */
export function InvitesPage() {
  const qc = useQueryClient();
  const invites = useQuery({ queryKey: ['invites'], queryFn: () => api<Invite[]>('/invites') });
  const create = useMutation({
    mutationFn: () => api<Invite>('/invites', { body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  });
  const link = (code: string) => `${window.location.origin}/register?invite=${encodeURIComponent(code)}`;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <Card title="Invites">
        <div className="flex flex-col gap-4">
          <div>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>New invite link</Button>
            <ErrorText error={create.error ?? invites.error} />
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {invites.data?.map((inv) => (
              <li key={inv.code} className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-3 py-2">
                <code className={inv.usedBy ? 'text-text-muted line-through' : ''}>{link(inv.code)}</code>
                {inv.usedBy ? <Chip type="neutral">used</Chip> : <Button variant="ghost" onClick={() => navigator.clipboard.writeText(link(inv.code))}>Copy</Button>}
              </li>
            ))}
            {invites.data?.length === 0 && <li className="text-text-muted">No invites yet.</li>}
          </ul>
        </div>
      </Card>
    </main>
  );
}
