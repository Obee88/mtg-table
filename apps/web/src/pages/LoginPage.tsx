import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Card, ErrorText, Input } from '../components';
import { useLogin } from '../lib/auth';

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email, password }, { onSuccess: () => navigate('/') });
  };

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-center text-2xl font-semibold">MTG Table</h1>
      <Card title="Sign in">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <ErrorText error={login.error} />
          <Button type="submit" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-text-muted">
        Have an invite? <Link to="/register" className="text-accent hover:underline">Create an account</Link>
        <span className="mx-2">·</span>
        <Link to="/forgot" className="text-accent hover:underline">Forgot your password?</Link>
      </p>
    </main>
  );
}
