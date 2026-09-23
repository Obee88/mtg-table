import type { Invite } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, EmptyState, ErrorText, PageHeader } from '../components';
import { Chip } from '../components/Chip';
import { CopyButton } from '../components/CopyButton';
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
      <PageHeader title="Invites" subtitle="The group is invite-only: make a link, send it, and the newcomer registers with it." />
      <Card>
        <div className="flex flex-col gap-4">
          <div>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>New invite link</Button>
            <ErrorText error={create.error ?? invites.error} />
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {invites.data?.map((inv) => (
              <li key={inv.code} className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-3 py-2">
                <code className={inv.usedBy ? 'text-text-muted line-through' : ''}>{link(inv.code)}</code>
                {inv.usedBy ? <Chip type="neutral">used</Chip> : <CopyButton text={link(inv.code)} copiedLabel="Link copied ✓">Copy link</CopyButton>}
              </li>
            ))}
            {invites.data?.length === 0 && <li><EmptyState title="No invites yet" text="Each link admits one person." /></li>}
          </ul>
        </div>
      </Card>
    </main>
  );
}
