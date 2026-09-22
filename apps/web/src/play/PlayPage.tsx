import type { CubeSummary, DeckSummary, RoomListItem } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button, Card, EmptyState, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { describeSettings } from '../rooms/describe';

const PHASE_LABEL: Record<RoomListItem['phase'], string> = { lobby: 'lobby', drafting: 'drafting', deckbuilding: 'deckbuilding', playing: 'playing', ended: 'closed' };

/** One line of state for a room: phase, seats or game number, and what it waits on from me. */
function RoomState({ r, meId }: { r: RoomListItem; meId: string | undefined }) {
  const reserved = r.settings.reservedPlayerIds ?? [];
  const reservedFor = reserved.length === 0 ? null : meId && reserved.includes(meId) ? 'you' : 'others';
  const seats = `${r.playerCount}/${r.settings.playerCount}`;
  const detail = r.phase === 'lobby' ? `${seats} seated` : r.phase === 'playing' && r.gameNumber ? `game ${r.gameNumber}` : null;
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-text-muted">
      <Chip type={r.phase === 'lobby' ? 'success' : 'primary'}>{PHASE_LABEL[r.phase]}{detail ? ` · ${detail}` : ''}</Chip>
      {r.attention && <Chip type="warning" emphasis="solid" title="waiting on you">{r.attention}</Chip>}
      {reservedFor && <Chip type={reservedFor === 'you' ? 'primary' : 'neutral'} title="reserved table">{reservedFor === 'you' ? 'reserved for you' : 'reserved'}</Chip>}
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
  // A brand-new account: nothing to play with yet, so say what to do first.
  const decks = useQuery({ queryKey: ['decks'], queryFn: () => api<DeckSummary[]>('/decks') });
  const cubes = useQuery({ queryKey: ['cubes'], queryFn: () => api<CubeSummary[]>('/cubes') });
  const firstRun = rooms.data && mine.length === 0 && decks.data?.length === 0 && cubes.data?.length === 0;
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

      {firstRun && (
        <Card title="Getting started">
          <ol className="flex flex-col gap-2 text-sm">
            <li className="flex items-baseline gap-3"><Chip type="primary" shape="pill">1</Chip><span><Link to="/decks/new" className="text-accent hover:underline">Import a deck</Link> for constructed games, or <Link to="/cubes/new" className="text-accent hover:underline">add a cube</Link> to draft from.</span></li>
            <li className="flex items-baseline gap-3"><Chip type="primary" shape="pill">2</Chip><span>Start a game or a draft above, name it, and share the room link, or leave the seats open for the group.</span></li>
            <li className="flex items-baseline gap-3"><Chip type="primary" shape="pill">3</Chip><span>Everyone sits, readies up, and the host starts. The tab title tells you when it is your move.</span></li>
          </ol>
        </Card>
      )}

      <Card title="Now">
        <ErrorText error={rooms.error ?? close.error} />
        {rooms.data && mine.length === 0 && <EmptyState title="You are not at any table" text="Start one above, or join an open lobby below. Rooms you sit in show up here with what they wait on from you." />}
        <ul className="flex flex-col gap-1">
          {mine.map((r) => (
            <li key={r.id} className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-raised ${r.attention ? 'bg-accent/5' : ''}`}>
              <Link to={`/rooms/${r.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.name ?? describeSettings(r.settings)}</span>
                  <RoomState r={r} meId={me.data?.id} />
                </span>
                <span className="shrink-0 text-accent">{r.attention ? 'Go' : 'Rejoin'}</span>
              </Link>
              {closeButton(r)}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Open lobbies">
        {rooms.data && open.length === 0 && <EmptyState title="Nobody is waiting for players right now" text="Open lobbies of the whole group appear here the moment someone creates one." />}
        <ul className="flex flex-col gap-1">
          {open.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-surface-raised">
              <Link to={`/rooms/${r.id}`} className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.name ?? describeSettings(r.settings)}</span>
                  <RoomState r={r} meId={me.data?.id} />
                </span>
                <span className="shrink-0 text-accent">{(r.settings.reservedPlayerIds?.length ?? 0) > 0 && !r.settings.reservedPlayerIds!.includes(me.data?.id ?? '') ? 'Watch' : 'Join'}</span>
              </Link>
              {closeButton(r)}
            </li>
          ))}
        </ul>
      </Card>
    </main>
  );
}
