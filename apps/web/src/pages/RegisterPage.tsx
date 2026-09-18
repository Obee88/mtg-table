import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Card, ErrorText, Input } from '../components';
import { useRegister } from '../lib/auth';

export function RegisterPage() {
  const register = useRegister();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(params.get('invite') ?? '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    register.mutate(
      { email, password, displayName, ...(inviteCode ? { inviteCode } : {}) },
      { onSuccess: () => navigate('/') },
    );
  };

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-center text-2xl font-semibold">MTG Table</h1>
      <Card title="Create account">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input label="Invite code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} />
          <Input label="Display name" autoComplete="nickname" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required minLength={2} />
          <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label="Password (10+ characters)" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
          <ErrorText error={register.error} />
          <Button type="submit" disabled={register.isPending}>
            {register.isPending ? 'Creating…' : 'Create account'}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-text-muted">
        Already have an account? <Link to="/login" className="text-accent hover:underline">Sign in</Link>
      </p>
    </main>
  );
}
