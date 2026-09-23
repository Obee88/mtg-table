import type { User } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Card, ErrorText, Input } from '../components';
import { api } from '../lib/api';

/** The one-time link's landing page: choose a new password, then you are signed in. */
export function ResetPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const who = useQuery({ queryKey: ['reset', token], queryFn: () => api<{ displayName: string }>(`/auth/reset/${encodeURIComponent(token)}`), enabled: token.length > 0, retry: false });
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const reset = useMutation({
    mutationFn: () => api<User>('/auth/reset', { body: { token, password } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/');
    },
  });
  const mismatch = again.length > 0 && again !== password;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!mismatch && password.length >= 6) reset.mutate();
  };
  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-center text-2xl font-semibold">MTG Table</h1>
      <Card title="Choose a new password">
        {!token && <p className="text-sm text-danger">This link is missing its token.</p>}
        {token && who.isError && <ErrorText error={who.error} />}
        {who.data && (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">For <span className="text-text">{who.data.displayName}</span>. Every other signed-in browser is signed out once you set it.</p>
            <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required autoFocus />
            <Input label="Again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
            {mismatch && <p className="text-sm text-danger">The two passwords differ.</p>}
            <ErrorText error={reset.error} />
            <Button type="submit" disabled={reset.isPending || mismatch || password.length < 6}>{reset.isPending ? 'Saving…' : 'Set password and sign in'}</Button>
          </form>
        )}
      </Card>
      <p className="text-center text-sm text-text-muted"><Link to="/login" className="text-accent hover:underline">Back to sign in</Link></p>
    </main>
  );
}
