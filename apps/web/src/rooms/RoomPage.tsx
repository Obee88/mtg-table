import type { DeckSummary, RoomEvent, RoomState } from '@mtg/shared';
import { seatedPlayers } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Card, ErrorText } from '../components';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { describeSettings } from './RoomListPage';
import { LogPanel } from '../table/LogPanel';
import { Table } from '../table/Table';
import { useRoom } from './useRoom';

export function RoomPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const room = useRoom(id, me.data ? { id: me.data.id, displayName: me.data.displayName } : undefined);

  if (room.status === 'closed' && !room.state) return <main className="p-6"><ErrorText error={room.lastError ?? 'Room unavailable'} /></main>;
  if (!room.state || !me.data) return <main className="p-6 text-text-muted">Connecting…</main>;

  return (
    <main className={`mx-auto flex flex-col gap-6 p-6 ${room.state.phase === 'playing' ? 'max-w-6xl' : 'max-w-3xl'}`}>
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{room.state.phase === 'lobby' ? 'Lobby' : room.state.phase === 'playing' ? 'Game' : 'Closed'}</h1>
          <p className="text-sm text-text-muted">{describeSettings(room.state.settings)} · {room.status === 'open' ? 'connected' : 'reconnecting…'}</p>
        </div>
        <Link to="/rooms" className="text-sm text-accent hover:underline">Rooms</Link>
      </header>
      {room.state.phase === 'lobby' && <Lobby state={room.state} meId={me.data.id} connected={room.connected} send={room.send} />}
      {room.state.phase === 'playing' && <Started state={room.state} meId={me.data.id} send={room.send} live={room.events} />}
      {room.state.phase === 'ended' && <p className="text-text-muted">This room has been closed.</p>}
    </main>
  );
}

function Lobby({ state, meId, connected, send }: { state: RoomState; meId: string; connected: string[]; send: ReturnType<typeof useRoom>['send'] }) {
  const [error, setError] = useState<string | null>(null);
  const me = state.players[meId];
  const isOwner = state.ownerId === meId;
  const decks = useQuery({ queryKey: ['decks'], queryFn: () => api<DeckSummary[]>('/decks'), enabled: !!me });
  const players = seatedPlayers(state);
  const allReady = players.length === state.settings.playerCount && players.every((p) => p.ready);

  const run = async (command: Parameters<typeof send>[0]) => {
    setError(null);
    const r = await send(command);
    if (!r.ok) setError(r.error);
  };

  return (
    <>
      <Card title={`Seats · ${players.length}/${state.settings.playerCount}`}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {Array.from({ length: state.settings.playerCount }, (_, seat) => {
            const p = players.find((x) => x.seat === seat);
            return (
              <li key={seat} className="flex items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm">
                <span className="text-text-muted">#{seat + 1}</span>
                {p ? (
                  <>
                    <span className={`h-2 w-2 rounded-full ${connected.includes(p.id) ? 'bg-success' : 'bg-border'}`} title={connected.includes(p.id) ? 'online' : 'offline'} />
                    <span className="flex-1 truncate font-medium">{p.displayName}{p.id === state.ownerId && <span className="ml-1 text-xs text-accent">host</span>}</span>
                    {state.settings.mode === '2v2' && <span className="text-xs text-text-muted">team {p.team + 1}</span>}
                    <span className={p.ready ? 'text-success' : 'text-text-muted'}>{p.ready ? 'ready' : p.deckId ? 'not ready' : 'no deck'}</span>
                  </>
                ) : (
                  <span className="flex-1 text-text-muted">empty</span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="You">
        <div className="flex flex-wrap items-center gap-3">
          {!me ? (
            <Button onClick={() => run({ type: 'join' })} disabled={players.length >= state.settings.playerCount}>Take a seat</Button>
          ) : (
            <>
              <label className="text-sm">
                <span className="mb-1 block text-text-muted">Deck</span>
                <select
                  value={me.deckId ?? ''}
                  onChange={(e) => run({ type: 'selectDeck', deckId: e.target.value || null })}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-text"
                >
                  <option value="">— choose —</option>
                  {decks.data?.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.mainCount})</option>)}
                </select>
              </label>
              <Button onClick={() => run({ type: 'setReady', ready: !me.ready })} disabled={!me.deckId} variant={me.ready ? 'ghost' : 'primary'}>
                {me.ready ? 'Not ready' : 'Ready'}
              </Button>
              <Button variant="ghost" onClick={() => run({ type: 'leave' })}>Leave seat</Button>
              {decks.data?.length === 0 && <Link to="/decks/new" className="text-sm text-accent hover:underline">Import a deck first</Link>}
            </>
          )}
          {isOwner && (
            <span className="ml-auto flex items-center gap-3">
              <Button onClick={() => run({ type: 'start' })} disabled={!allReady}>Start game</Button>
              <Button variant="ghost" className="text-danger" onClick={() => confirm('Close this room?') && run({ type: 'closeRoom' })}>Close room</Button>
            </span>
          )}
        </div>
        <ErrorText error={error} />
      </Card>
    </>
  );
}

function Started({ state, meId, send, live }: { state: RoomState; meId: string; send: ReturnType<typeof useRoom>['send']; live: RoomEvent[] }) {
  const g = state.game!;
  const players = seatedPlayers(state);
  return (
    <>
      <p className="text-sm text-text-muted">
        {players.find((p) => p.id === g.firstPlayerId)?.displayName} goes first (rolled {g.openingRoll[g.firstPlayerId]}).
      </p>
      <div className="flex gap-4">
        <div className="min-w-0 flex-1"><Table state={state} meId={meId} send={send} live={live} /></div>
        <LogPanel roomId={state.id} state={state} live={live} />
      </div>
    </>
  );
}
