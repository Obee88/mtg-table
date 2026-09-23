import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Button, Card, ErrorText, Input } from '../components';
import { api } from '../lib/api';

/** No mail leaves this app: asking tells the host, who hands a reset link over. */
export function ForgotPage() {
  const [email, setEmail] = useState('');
  const ask = useMutation({ mutationFn: (email: string) => api<{ ok: boolean }>('/auth/forgot', { body: { email } }) });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask.mutate(email);
  };
  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-center text-2xl font-semibold">MTG Table</h1>
      <Card title="Forgot your password?">
        {ask.isSuccess ? (
          <p className="text-sm">If that email belongs to an account, the host has been told. They will send you a reset link; open it and choose a new password.</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">This group sends no email. Enter your address and the host is asked to make you a one-time reset link, which they pass on to you.</p>
            <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            <ErrorText error={ask.error} />
            <Button type="submit" disabled={ask.isPending}>{ask.isPending ? 'Asking…' : 'Ask for a reset link'}</Button>
          </form>
        )}
      </Card>
      <p className="text-center text-sm text-text-muted"><Link to="/login" className="text-accent hover:underline">Back to sign in</Link></p>
    </main>
  );
}
