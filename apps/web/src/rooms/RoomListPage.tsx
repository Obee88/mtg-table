import type { RoomListItem, RoomSettings, RoomState } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Card, ErrorText } from '../components';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';

const PRESETS: { label: string; settings: RoomSettings }[] = [
  { label: '1v1 · 20 life', settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false } },
  { label: '1v1 Commander · 40 life', settings: { playerCount: 2, mode: '1v1', startingLife: 40, commander: true } },
  { label: '4-player free-for-all · 20 life', settings: { playerCount: 4, mode: 'ffa', startingLife: 20, commander: false } },
  { label: '4-player Commander · 40 life', settings: { playerCount: 4, mode: 'ffa', startingLife: 40, commander: true } },
  { label: '2v2 Two-Headed Giant · 30 life', settings: { playerCount: 4, mode: '2v2', startingLife: 30, commander: false } },
];

export const describeSettings = (s: RoomSettings) =>
  `${s.mode === '1v1' ? '1v1' : s.mode === 'ffa' ? `${s.playerCount}-player FFA` : '2v2'} · ${s.startingLife} life${s.commander ? ' · commander' : ''}`;

export function RoomListPage() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api<RoomListItem[]>('/rooms'), refetchInterval: 10_000 });
  const [preset, setPreset] = useState(0);
  const create = useMutation({
    mutationFn: (settings: RoomSettings) => api<RoomState>('/rooms', { body: { settings } }),
    onSuccess: (state) => {
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      navigate(`/rooms/${state.id}`);
    },
  });

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Rooms</h1>
        <Link to="/" className="text-sm text-accent hover:underline">Home</Link>
      </header>

      <Card title="New room">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">Format</span>
            <select value={preset} onChange={(e) => setPreset(Number(e.target.value))} className="rounded-md border border-border bg-surface px-3 py-2 text-text">
              {PRESETS.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
            </select>
          </label>
          <Button onClick={() => create.mutate(PRESETS[preset]!.settings)} disabled={create.isPending}>Create room</Button>
        </div>
        <ErrorText error={create.error} />
      </Card>

      <Card title="Open rooms">
        <ErrorText error={rooms.error} />
        {rooms.data?.length === 0 && <p className="text-sm text-text-muted">No rooms yet.</p>}
        <ul className="flex flex-col gap-1">
          {rooms.data?.map((r) => (
            <li key={r.id}>
              <Link to={`/rooms/${r.id}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
                <span>
                  <span className="block font-medium">{describeSettings(r.settings)}{r.ownerId === me.data?.id && <span className="ml-2 text-xs text-accent">yours</span>}</span>
                  <span className="block text-text-muted">{r.playerCount}/{r.settings.playerCount} seated · {r.phase} · {new Date(r.createdAt).toLocaleString()}</span>
                </span>
                <span className="text-accent">Open</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
