import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Button, Card, ErrorText, Input, PageHeader } from '../components';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';

/** Your account: who you are, and a new password. */
export function AccountPage() {
  const me = useMe();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const change = useMutation({
    mutationFn: () => api<void>('/auth/password', { body: { current, next } }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setAgain('');
    },
  });
  const mismatch = again.length > 0 && again !== next;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mismatch && next.length >= 6 && current) change.mutate();
  };
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <PageHeader title="Account" subtitle={me.data ? `${me.data.displayName} · ${me.data.email}` : undefined} />
      <Card title="Change password">
        <form onSubmit={submit} className="flex max-w-sm flex-col gap-4">
          <Input label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          <Input label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={6} required />
          <Input label="New password again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
          {mismatch && <p className="text-sm text-danger">The two passwords differ.</p>}
          <ErrorText error={change.error} />
          {change.isSuccess && <p className="text-sm text-success">Password changed. Other browsers you were signed in on are signed out.</p>}
          <div><Button type="submit" disabled={change.isPending || mismatch || next.length < 6 || !current}>{change.isPending ? 'Changing…' : 'Change password'}</Button></div>
        </form>
        <p className="mt-3 text-xs text-text-muted">Forgot it? Sign out and use “Forgot your password?” on the sign-in page; the host issues a reset link.</p>
      </Card>
    </main>
  );
}
