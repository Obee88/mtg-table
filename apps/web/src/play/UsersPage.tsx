import type { AdminUser, PasswordReset } from '@mtg/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, Card, Dialog, ErrorText, Input, PageHeader } from '../components';
import { Chip } from '../components/Chip';
import { CopyButton } from '../components/CopyButton';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';

/** Admin only: every account, with a password set directly or a one-time reset link handed over. */
export function UsersPage() {
  const me = useMe();
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => api<AdminUser[]>('/admin/users') });
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const set = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => api<void>(`/admin/users/${id}/password`, { body: { password } }),
    onSuccess: (_r, v) => {
      setDone(users.data?.find((u) => u.id === v.id)?.displayName ?? '');
      setTarget(null);
      setPassword('');
    },
  });
  const [issued, setIssued] = useState<PasswordReset | null>(null);
  const issue = useMutation({ mutationFn: (email: string) => api<PasswordReset>('/admin/password-resets', { body: { email } }), onSuccess: setIssued });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (target && password.length >= 6) set.mutate({ id: target.id, password });
  };

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <PageHeader title="Users" subtitle="Every account in the group. Set a password directly, or issue a reset link the player sets their own with." />
      <Card>
        <ErrorText error={users.error ?? set.error ?? issue.error} />
        {done && <p className="mb-3 text-sm text-success">Password set for {done}; they are signed out everywhere and can sign in with it now.</p>}
        {issued?.link && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md bg-surface-raised px-3 py-2 text-sm">
            <span className="min-w-0 flex-1"><span className="font-medium">{issued.displayName}</span>: <code className="break-all">{issued.link}</code> <span className="text-text-muted">(valid a day, works once)</span></span>
            <CopyButton text={issued.link} copiedLabel="Link copied ✓">Copy link</CopyButton>
          </div>
        )}
        <ul className="flex flex-col gap-1 text-sm">
          {users.data?.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-2 hover:bg-surface-raised">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{u.displayName}{u.isAdmin && <Chip type="primary" className="ml-2">admin</Chip>}{u.id === me.data?.id && <span className="text-text-muted"> (you)</span>}</span>
                <span className="block truncate text-text-muted">{u.email} · since {new Date(u.createdAt).toLocaleDateString()}</span>
              </span>
              <Button variant="secondary" onClick={() => { setDone(null); setIssued(null); setTarget(u); }}>Set password</Button>
              <Button variant="tertiary" disabled={issue.isPending} onClick={() => { setDone(null); issue.mutate(u.email); }}>Reset link</Button>
            </li>
          ))}
        </ul>
      </Card>
      {target && (
        <Dialog title={`Set a password for ${target.displayName}`} onClose={() => setTarget(null)}>
          <form onSubmit={submit} className="flex flex-col gap-4 text-sm">
            <p className="text-text-muted">They are signed out everywhere and sign in with the password you set. Tell them in person; better still, issue a reset link so they choose their own.</p>
            <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required autoFocus />
            <ErrorText error={set.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
              <Button type="submit" disabled={set.isPending || password.length < 6}>{set.isPending ? 'Setting…' : 'Set password'}</Button>
            </div>
          </form>
        </Dialog>
      )}
    </main>
  );
}
