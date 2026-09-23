import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { Button } from '../components';
import { useLogout, useMe } from '../lib/auth';
import { api } from '../lib/api';
import { useQuery } from '@tanstack/react-query';
import type { FriendsResponse } from '@mtg/shared';

const tab = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-surface-raised text-text' : 'text-text-muted hover:text-text'}`;

/**
 * The app shell: a top bar with the four places a player goes (Play, Decks,
 * Cubes, Stats), invites for admins, and a user menu with the rest. The game
 * and draft screens render outside it, full-viewport.
 */
export function Shell() {
  const me = useMe();
  const user = me.data;
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
        <nav className="mx-auto flex h-12 max-w-5xl items-center gap-1 px-4">
          <Link to="/" className="mr-3 font-semibold tracking-tight">MTG Table</Link>
          <NavLink to="/" end className={tab}>Play</NavLink>
          <NavLink to="/decks" className={tab}>Decks</NavLink>
          <NavLink to="/cubes" className={tab}>Cubes</NavLink>
          <NavLink to="/players/me/stats" className={tab}>Stats</NavLink>
          {user?.isAdmin && <NavLink to="/invites" className={tab}>Invites</NavLink>}
          <span className="ml-auto" />
          {user && <UserMenu name={user.displayName} />}
        </nav>
      </header>
      <Outlet />
    </div>
  );
}

function UserMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api<FriendsResponse>('/friends'), refetchInterval: 60_000 });
  const pending = friends.data?.incoming.length ?? 0;
  const ref = useRef<HTMLDivElement>(null);
  const logout = useLogout();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const item = 'block rounded px-3 py-1.5 text-left text-sm hover:bg-surface-raised';
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="rounded-md px-3 py-1.5 text-sm text-text-muted hover:text-text" aria-haspopup="menu" aria-expanded={open}>
        {name}{pending > 0 && <span className="ml-1 text-accent" title="friend requests waiting">●</span>} ▾
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 flex w-48 flex-col gap-0.5 rounded-md border border-border bg-surface p-1 shadow-xl">
          <Link to="/account" className={item} onClick={() => setOpen(false)}>Account</Link>
          <Link to="/friends" className={item} onClick={() => setOpen(false)}>Friends{pending > 0 && <span className="ml-2 rounded-full bg-accent px-1.5 text-xs text-bg">{pending}</span>}</Link>
          <Link to="/drafts/history" className={item} onClick={() => setOpen(false)}>Past drafts</Link>
          <Link to="/cards" className={item} onClick={() => setOpen(false)}>Browse cards</Link>
          <span className="my-0.5 border-t border-border" />
          <Button variant="ghost" className="!justify-start !px-3 !py-1.5 text-sm" onClick={() => logout.mutate()} disabled={logout.isPending}>Sign out</Button>
        </div>
      )}
    </div>
  );
}
