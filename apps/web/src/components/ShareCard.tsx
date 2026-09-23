import type { FriendsResponse, SharedMember } from '@mtg/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, ErrorText, Select } from '../components';
import { api } from '../lib/api';
import { Chip } from './Chip';

/** Owner's list of players something is shared with, with add (from their friends) and remove. */
export function ShareCard({ title = 'Shared with', description, members, ownerId, basePath, onChanged }: {
  title?: string;
  description: string;
  members: SharedMember[];
  ownerId: string;
  /** `POST {basePath}/members { userId }` and `DELETE {basePath}/members/:userId`. */
  basePath: string;
  onChanged: () => void;
}) {
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api<FriendsResponse>('/friends') });
  const [pick, setPick] = useState('');
  const add = useMutation({ mutationFn: (userId: string) => api<unknown>(`${basePath}/members`, { body: { userId } }), onSuccess: () => { setPick(''); onChanged(); } });
  const remove = useMutation({ mutationFn: (userId: string) => api<unknown>(`${basePath}/members/${userId}`, { method: 'DELETE' }), onSuccess: onChanged });
  const candidates = (friends.data?.friends ?? []).filter((u) => u.id !== ownerId && !members.some((m) => m.id === u.id));
  return (
    <Card title={title}>
      <p className="mb-3 text-sm text-text-muted">{description}</p>
      <ul className="flex flex-col gap-1 text-sm">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-surface-raised">
            <span>{m.displayName}{m.status === 'pending' && <Chip type="neutral" className="ml-2" title="offered, not accepted yet">invited</Chip>}</span>
            <Button variant="ghost" className="!px-2 !py-0.5 text-xs" disabled={remove.isPending} onClick={() => remove.mutate(m.id)}>Remove</Button>
          </li>
        ))}
        {members.length === 0 && <li className="text-text-muted">Only you, so far.</li>}
      </ul>
      <div className="mt-3 flex items-end gap-2">
        <Select label="Share with a friend" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">— choose —</option>
          {candidates.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
        </Select>
        <Button variant="ghost" disabled={!pick || add.isPending} onClick={() => add.mutate(pick)}>Share</Button>
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {friends.data && candidates.length === 0 ? 'Nobody left to share with among your friends. ' : 'Only friends can be picked. '}
        <Link to="/friends" className="text-accent hover:underline">Manage friends</Link>
      </p>
      <ErrorText error={add.error ?? remove.error} />
    </Card>
  );
}
