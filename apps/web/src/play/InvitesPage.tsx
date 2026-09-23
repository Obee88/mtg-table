import type { Invite, PasswordReset } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, Card, EmptyState, ErrorText, Input, PageHeader } from '../components';
import { Chip } from '../components/Chip';
import { CopyButton } from '../components/CopyButton';
import { api } from '../lib/api';

/** Admin only: invite links for new members, and one-time password reset links (this app sends no mail). */
export function InvitesPage() {
  const qc = useQueryClient();
  const invites = useQuery({ queryKey: ['invites'], queryFn: () => api<Invite[]>('/invites') });
  const create = useMutation({
    mutationFn: () => api<Invite>('/invites', { body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  });
  const link = (code: string) => `${window.location.origin}/register?invite=${encodeURIComponent(code)}`;

  const resets = useQuery({ queryKey: ['password-resets'], queryFn: () => api<PasswordReset[]>('/admin/password-resets'), refetchInterval: 30_000 });
  const [email, setEmail] = useState('');
  const [issued, setIssued] = useState<PasswordReset | null>(null);
  const issue = useMutation({
    mutationFn: (email: string) => api<PasswordReset>('/admin/password-resets', { body: { email } }),
    onSuccess: (r) => {
      setIssued(r);
      setEmail('');
      void qc.invalidateQueries({ queryKey: ['password-resets'] });
    },
  });
  const submitIssue = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim()) issue.mutate(email.trim());
  };
  const open = resets.data?.filter((r) => !r.usedAt && !r.expiresAt) ?? [];
  const history = resets.data?.filter((r) => r.usedAt || r.expiresAt) ?? [];

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

      <Card title="Password resets">
        <p className="mb-3 text-sm text-text-muted">Nobody gets email from this app. When a player forgets their password they ask from the sign-in page and show up here; issue a one-time link (valid a day) and pass it to them. You can issue one for anyone by email.</p>
        <ErrorText error={resets.error ?? issue.error} />
        {open.length > 0 && (
          <ul className="mb-4 flex flex-col gap-1 text-sm">
            {open.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2">
                <span className="flex-1"><span className="font-medium">{r.displayName}</span> <span className="text-text-muted">({r.email}) asked {new Date(r.requestedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span></span>
                <Button disabled={issue.isPending} onClick={() => issue.mutate(r.email)}>Issue reset link</Button>
              </li>
            ))}
          </ul>
        )}
        {issued?.link && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-surface-raised px-3 py-2 text-sm">
            <span className="min-w-0 flex-1"><span className="font-medium">{issued.displayName}</span>: <code className="break-all">{issued.link}</code></span>
            <CopyButton text={issued.link} copiedLabel="Link copied ✓">Copy link</CopyButton>
          </div>
        )}
        <form className="flex flex-wrap items-end gap-2" onSubmit={submitIssue}>
          <div className="min-w-64 flex-1"><Input label="Issue a reset link for (email)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="player@example.com" /></div>
          <Button type="submit" variant="secondary" disabled={!email.trim() || issue.isPending}>Issue</Button>
        </form>
        {history.length > 0 && (
          <ul className="mt-4 flex flex-col gap-0.5 border-t border-border pt-3 text-xs text-text-muted">
            {history.slice(0, 8).map((r) => (
              <li key={r.id}>{r.displayName} · {r.usedAt ? `reset ${new Date(r.usedAt).toLocaleDateString()}` : `link issued, valid until ${new Date(r.expiresAt!).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`}</li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
