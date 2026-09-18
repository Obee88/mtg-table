import type { Invite, User } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button, Card, ErrorText } from '../components';
import { api } from '../lib/api';
import { useLogout } from '../lib/auth';

export function HomePage({ user }: { user: User }) {
  const logout = useLogout();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">MTG Table</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-text-muted">{user.displayName}</span>
          <Button variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
            Sign out
          </Button>
        </div>
      </header>

      <Card title="Table">
        <p className="text-text-muted">Create a room, import a deck, sit down.</p>
        <div className="mt-3 flex gap-4 text-sm">
          <Link to="/rooms" className="text-accent hover:underline">Rooms</Link>
          <Link to="/decks" className="text-accent hover:underline">My decks</Link>
          <Link to="/cards" className="text-accent hover:underline">Browse cards</Link>
        </div>
      </Card>

      {user.isAdmin && <InvitesPanel />}
    </main>
  );
}

function InvitesPanel() {
  const qc = useQueryClient();
  const invites = useQuery({ queryKey: ['invites'], queryFn: () => api<Invite[]>('/invites') });
  const create = useMutation({
    mutationFn: () => api<Invite>('/invites', { body: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  });
  const link = (code: string) => `${window.location.origin}/register?invite=${encodeURIComponent(code)}`;

  return (
    <Card title="Invites">
      <div className="flex flex-col gap-4">
        <div>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            New invite link
          </Button>
          <ErrorText error={create.error} />
        </div>
        <ul className="flex flex-col gap-2 text-sm">
          {invites.data?.map((inv) => (
            <li key={inv.code} className="flex items-center justify-between gap-3 rounded-md bg-surface-raised px-3 py-2">
              <code className={inv.usedBy ? 'text-text-muted line-through' : ''}>{link(inv.code)}</code>
              {inv.usedBy ? (
                <span className="text-text-muted">used</span>
              ) : (
                <Button variant="ghost" onClick={() => navigator.clipboard.writeText(link(inv.code))}>
                  Copy
                </Button>
              )}
            </li>
          ))}
          {invites.data?.length === 0 && <li className="text-text-muted">No invites yet.</li>}
        </ul>
      </div>
    </Card>
  );
}
