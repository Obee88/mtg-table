import type { RoomListItem } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button, Card, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { describeSettings } from '../rooms/NewRoomPage';

const PHASE_LABEL: Record<RoomListItem['phase'], string> = { lobby: 'lobby', drafting: 'drafting', deckbuilding: 'deckbuilding', playing: 'playing', ended: 'closed' };

/** One line of state for a room: phase, seats or game number, and what it waits on from me. */
function RoomState({ r }: { r: RoomListItem }) {
  const seats = `${r.playerCount}/${r.settings.playerCount}`;
  const detail = r.phase === 'lobby' ? `${seats} seated` : r.phase === 'playing' && r.gameNumber ? `game ${r.gameNumber}` : null;
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-text-muted">
      <Chip type={r.phase === 'lobby' ? 'success' : 'primary'}>{PHASE_LABEL[r.phase]}{detail ? ` · ${detail}` : ''}</Chip>
      {r.attention && <Chip type="warning" emphasis="solid" title="waiting on you">{r.attention}</Chip>}
      {r.name && <span>{describeSettings(r.settings)}</span>}
      <span>{new Date(r.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
    </span>
  );
}

/** The Play home: what is going on now, open tables to join, and the two ways to start something. */
export function PlayPage() {
  const me = useMe();
  const qc = useQueryClient();
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: () => api<RoomListItem[]>('/rooms'), refetchInterval: 10_000 });
  const close = useMutation({
    mutationFn: (id: string) => api<unknown>(`/rooms/${id}/commands`, { body: { type: 'closeRoom' } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rooms'] }),
  });
  const mine = rooms.data?.filter((r) => r.seated) ?? [];
  const open = rooms.data?.filter((r) => !r.seated && r.phase === 'lobby') ?? [];
  const closeButton = (r: RoomListItem) =>
    r.ownerId === me.data?.id && (
      <Button variant="ghost" className="text-danger" disabled={close.isPending} onClick={() => confirm('Close this room for everyone?') && close.mutate(r.id)}>Close</Button>
    );

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <Card title="Start something">
        <div className="flex flex-wrap gap-3">
          <Link to="/play/new?kind=game"><Button>New game</Button></Link>
          <Link to="/play/new?kind=draft"><Button>New draft</Button></Link>
          <span className="self-center text-sm text-text-muted">A game needs decks from <Link to="/decks" className="text-accent hover:underline">Decks</Link>; a draft needs a <Link to="/cubes" className="text-accent hover:underline">cube</Link>.</span>
        </div>
      </Card>

      <Card title="Now">
        <ErrorText error={rooms.error ?? close.error} />
        {rooms.data && mine.length === 0 && <p className="text-sm text-text-muted">You are not at any table. Start one above, or join an open lobby below.</p>}
        <ul className="flex flex-col gap-1">
          {mine.map((r) => (
            <li key={r.id} className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-raised ${r.attention ? 'bg-accent/5' : ''}`}>
              <Link to={`/rooms/${r.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.name ?? describeSettings(r.settings)}</span>
                  <RoomState r={r} />
                </span>
                <span className="shrink-0 text-accent">{r.attention ? 'Go' : 'Rejoin'}</span>
              </Link>
              {closeButton(r)}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Open lobbies">
        {rooms.data && open.length === 0 && <p className="text-sm text-text-muted">Nobody is waiting for players right now.</p>}
        <ul className="flex flex-col gap-1">
          {open.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
              <Link to={`/rooms/${r.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.name ?? describeSettings(r.settings)}</span>
                  <RoomState r={r} />
                </span>
                <span className="shrink-0 text-accent">Join</span>
              </Link>
              {closeButton(r)}
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
