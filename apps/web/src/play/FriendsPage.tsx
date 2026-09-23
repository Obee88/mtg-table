import type { FriendsResponse, UserSummary } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorText, PageHeader, Select } from '../components';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';

/** Who you can share cubes and formats with. Requests need the other side's yes. */
export function FriendsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api<FriendsResponse>('/friends') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserSummary[]>('/users') });
  const [pick, setPick] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['friends'] });
  const ask = useMutation({ mutationFn: (userId: string) => api<FriendsResponse>('/friends', { body: { userId } }), onSuccess: () => { setPick(''); refresh(); } });
  const respond = useMutation({ mutationFn: ({ userId, accept }: { userId: string; accept: boolean }) => api<FriendsResponse>(`/friends/${userId}/respond`, { body: { accept } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (userId: string) => api<FriendsResponse>(`/friends/${userId}`, { method: 'DELETE' }), onSuccess: refresh });
  const busy = ask.isPending || respond.isPending || remove.isPending;
  const known = new Set([...(friends.data?.friends ?? []), ...(friends.data?.incoming ?? []), ...(friends.data?.outgoing ?? [])].map((u) => u.id));
  const candidates = (users.data ?? []).filter((u) => u.id !== me.data?.id && !known.has(u.id));
  const row = 'flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-raised';

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <PageHeader title="Friends" subtitle="Cubes and draft formats can only be shared with friends. A request needs the other side's yes." />
      <ErrorText error={friends.error ?? ask.error ?? respond.error ?? remove.error} />

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
        <div className="mt-4 flex items-end gap-2 border-t border-border pt-4">
          <Select label="Ask someone in the group" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">— choose —</option>
            {candidates.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </Select>
          <Button disabled={!pick || busy} onClick={() => ask.mutate(pick)}>Send request</Button>
        </div>
      </Card>
    </main>
  );
}
