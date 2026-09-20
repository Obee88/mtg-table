import type { RoomListItem, RoomSettings, RoomState } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Card, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { SettingsForm } from './SettingsForm';

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
  const [settings, setSettings] = useState<RoomSettings>(PRESETS[0]!.settings);
  const close = useMutation({
    mutationFn: (id: string) => api<unknown>(`/rooms/${id}/commands`, { body: { type: 'closeRoom' } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rooms'] }),
  });
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
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Button key={p.label} variant="ghost" className="!py-1 text-xs" onClick={() => setSettings(p.settings)}>{p.label}</Button>
            ))}
          </div>
          <SettingsForm value={settings} onChange={setSettings} />
          <div>
            <Button onClick={() => create.mutate(settings)} disabled={create.isPending}>Create room · {describeSettings(settings)}</Button>
          </div>
        </div>
        <ErrorText error={create.error} />
      </Card>

      <Card title="Open rooms">
        <ErrorText error={rooms.error ?? close.error} />
        {rooms.data?.length === 0 && <p className="text-sm text-text-muted">No rooms yet.</p>}
        <ul className="flex flex-col gap-1">
          {rooms.data?.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
              <Link to={`/rooms/${r.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium">{describeSettings(r.settings)}{r.ownerId === me.data?.id && <Chip type="primary" shape="pill" className="ml-2">yours</Chip>}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-text-muted"><Chip type={r.phase === 'lobby' ? 'success' : r.phase === 'playing' ? 'primary' : 'neutral'}>{r.phase}</Chip>{r.playerCount}/{r.settings.playerCount} seated · {new Date(r.createdAt).toLocaleString()}</span>
                </span>
                <span className="text-accent">{r.phase === 'playing' ? 'Rejoin' : 'Open'}</span>
              </Link>
              {r.ownerId === me.data?.id && (
                <Button variant="ghost" className="text-danger" disabled={close.isPending} onClick={() => confirm('Close this room for everyone?') && close.mutate(r.id)}>
                  Close
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
