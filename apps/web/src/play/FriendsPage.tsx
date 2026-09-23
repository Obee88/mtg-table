import type { FriendsResponse } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorText, Input, PageHeader } from '../components';
import { api } from '../lib/api';

/** Who you can share cubes and formats with. Requests need the other side's yes. */
export function FriendsPage() {
  const qc = useQueryClient();
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api<FriendsResponse>('/friends') });
  const [pick, setPick] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['friends'] });
  const ask = useMutation({ mutationFn: (name: string) => api<FriendsResponse>('/friends', { body: { name } }), onSuccess: () => { setPick(''); refresh(); } });
  const respond = useMutation({ mutationFn: ({ userId, accept }: { userId: string; accept: boolean }) => api<FriendsResponse>(`/friends/${userId}/respond`, { body: { accept } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (userId: string) => api<FriendsResponse>(`/friends/${userId}`, { method: 'DELETE' }), onSuccess: refresh });
  const busy = ask.isPending || respond.isPending || remove.isPending;
  const row = 'flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-raised';

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <PageHeader title="Friends" subtitle="Cubes and draft formats can only be shared with friends. A request needs the other side's yes." />
      <ErrorText error={friends.error ?? respond.error ?? remove.error} />

      {(friends.data?.incoming.length ?? 0) > 0 && (
        <Card title="Requests for you">
          <ul className="flex flex-col gap-1">
            {friends.data!.incoming.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 rounded-md border border-accent/40 bg-accent/5 px-3 py-2 text-sm">
                <span className="flex-1"><span className="font-medium">{u.displayName}</span> wants to be your friend.</span>
                <Button variant="ghost" disabled={busy} onClick={() => respond.mutate({ userId: u.id, accept: false })}>Reject</Button>
                <Button disabled={busy} onClick={() => respond.mutate({ userId: u.id, accept: true })}>Accept</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`Your friends · ${friends.data?.friends.length ?? 0}`}>
        {friends.data?.friends.length === 0 && <EmptyState title="No friends yet" text="Ask someone below. Once they accept, you can share cubes and formats with each other." />}
        <ul className="flex flex-col gap-1">
          {friends.data?.friends.map((u) => (
            <li key={u.id} className={row}>
              <span className="font-medium">{u.displayName}</span>
              <Button variant="ghost" disabled={busy} onClick={() => confirm(`Unfriend ${u.displayName}? Things already shared stay shared.`) && remove.mutate(u.id)}>Unfriend</Button>
            </li>
          ))}
          {friends.data?.outgoing.map((u) => (
            <li key={u.id} className={row}>
              <span><span className="font-medium">{u.displayName}</span> <span className="text-text-muted">· asked, waiting for their answer</span></span>
              <Button variant="ghost" disabled={busy} onClick={() => remove.mutate(u.id)}>Take back</Button>
            </li>
          ))}
        </ul>
        <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4" onSubmit={(e) => { e.preventDefault(); if (pick.trim()) ask.mutate(pick.trim()); }}>
          <div className="min-w-64 flex-1"><Input label="Their display name or email" value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Obee, or obee@example.com" /></div>
          <Button type="submit" disabled={!pick.trim() || busy}>Send request</Button>
          {ask.error && <p className="w-full text-sm text-danger" role="alert">{ask.error instanceof Error ? ask.error.message : String(ask.error)}</p>}
          <p className="w-full text-xs text-text-muted">Exact name or email, any capitalisation. Nobody is listed here: you have to know whom you are asking.</p>
        </form>
      </Card>
    </main>
  );
}
