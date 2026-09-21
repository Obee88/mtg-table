import type { DeckSummary, RoomState } from '@mtg/shared';
import { defaultDraftName, seatedPlayers, teamForSeat } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Card, Dialog, ErrorText, Input } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { describeSettings } from './RoomListPage';
import { SettingsForm } from './SettingsForm';
import { DraftScreen } from '../draft/DraftScreen';
import { GameScreen } from '../table/GameScreen';
import { useRoom } from './useRoom';

export function RoomPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const room = useRoom(id, me.data ? { id: me.data.id, displayName: me.data.displayName } : undefined);

  if (room.status === 'closed' && !room.state) return <main className="p-6"><ErrorText error={room.lastError ?? 'Room unavailable'} /></main>;
  if (!room.state || !me.data) return <main className="p-6 text-text-muted">Connecting…</main>;

  if (room.state.phase === 'playing') {
    // The game owns the whole viewport: no page scroll, everything sized to fit.
    return <GameScreen room={{ ...room, state: room.state }} meId={me.data.id} />;
  }
  if ((room.state.phase === 'drafting' || room.state.phase === 'deckbuilding') && room.state.draft) {
    return <DraftScreen room={{ ...room, state: room.state }} meId={me.data.id} />;
  }

  const title = { lobby: 'Lobby', drafting: 'Drafting', deckbuilding: 'Deckbuilding', playing: 'Playing', ended: 'Closed' }[room.state.phase];
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{room.state.name ?? title}</h1>
          <p className="text-sm text-text-muted">{describeSettings(room.state.settings)} · {room.status === 'open' ? 'connected' : 'reconnecting…'}</p>
        </div>
        <Link to="/rooms" className="text-sm text-accent hover:underline">Rooms</Link>
      </header>
      {room.state.phase === 'lobby' && <Lobby state={room.state} meId={me.data.id} connected={room.connected} send={room.send} />}
      {room.state.phase === 'ended' && <p className="text-text-muted">This room has been closed.</p>}
    </main>
  );
}

function Lobby({ state, meId, connected, send }: { state: RoomState; meId: string; connected: string[]; send: ReturnType<typeof useRoom>['send'] }) {
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const me = state.players[meId];
  const isOwner = state.ownerId === meId;
  const decks = useQuery({ queryKey: ['decks'], queryFn: () => api<DeckSummary[]>('/decks'), enabled: !!me });
  const players = seatedPlayers(state);
  const allReady = players.length === state.settings.playerCount && players.every((p) => p.ready);
  const drafting = !!state.settings.draft;

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
                    <span className="flex-1 truncate font-medium">{p.displayName}{p.id === state.ownerId && <Chip type="primary" className="ml-1">host</Chip>}</span>
                    {state.settings.mode === '2v2' && <Chip type="neutral">team {p.team + 1}</Chip>}
                    <Chip type={p.ready ? 'success' : 'neutral'} shape="pill">{p.ready ? 'ready' : p.deckId || drafting ? 'not ready' : 'no deck'}</Chip>
                  </>
                ) : (
                  <span className="flex flex-1 items-center justify-between text-text-muted">
                    <span>empty{state.settings.mode === '2v2' && ` · team ${teamForSeat(seat, state.settings.mode) + 1}`}</span>
                    {me && <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => run({ type: 'takeSeat', seat })}>Sit here</Button>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {isOwner && (
        <Card title="Settings">
          <SettingsForm value={state.settings} onChange={(settings) => run({ type: 'updateSettings', settings })} />
          <p className="mt-2 text-xs text-text-muted">Changing settings clears everyone's ready state. Player count cannot drop below the seated players.</p>
        </Card>
      )}

      <Card title="You">
        <div className="flex flex-wrap items-center gap-3">
          {!me ? (
            <Button onClick={() => run({ type: 'join' })} disabled={players.length >= state.settings.playerCount}>Take a seat</Button>
          ) : (
            <>
              {drafting && <span className="text-sm text-text-muted">Decks are built after the draft.</span>}
              {!drafting && <label className="text-sm">
                <span className="mb-1 block text-text-muted">Deck</span>
                <select
                  value={me.deckId ?? ''}
                  onChange={(e) => run({ type: 'selectDeck', deckId: e.target.value || null })}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-text"
                >
                  <option value="">— choose —</option>
                  {decks.data?.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.mainCount})</option>)}
                </select>
              </label>}
              <Button onClick={() => run({ type: 'setReady', ready: !me.ready })} disabled={!me.deckId && !drafting} variant={me.ready ? 'ghost' : 'primary'}>
                {me.ready ? 'Not ready' : 'Ready'}
              </Button>
              <Button variant="ghost" onClick={() => run({ type: 'leave' })}>Leave seat</Button>
              {!drafting && decks.data?.length === 0 && <Link to="/decks/new" className="text-sm text-accent hover:underline">Import a deck first</Link>}
            </>
          )}
          {isOwner && (
            <span className="ml-auto flex items-center gap-3">
              <Button onClick={() => (drafting ? setNaming(defaultDraftName(state, new Date())) : run({ type: 'start' }))} disabled={!allReady}>{drafting ? 'Start draft…' : 'Start game'}</Button>
              <Button variant="ghost" className="text-danger" onClick={() => confirm('Close this room?') && run({ type: 'closeRoom' })}>Close room</Button>
            </span>
          )}
        </div>
        <ErrorText error={error} />
      </Card>

      {naming !== null && (
        <Dialog title="Name this draft" onClose={() => setNaming(null)}>
          <form
            className="flex flex-col gap-4 text-sm"
            onSubmit={(e) => {
              e.preventDefault();
              void run({ type: 'start', name: naming.trim() });
              setNaming(null);
            }}
          >
            <Input label="Name" value={naming} onChange={(e) => setNaming(e.target.value)} autoFocus />
            <p className="text-xs text-text-muted">Shown in the room list and in the draft history, so you can find these decks again.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setNaming(null)}>Cancel</Button>
              <Button type="submit">Start draft</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}

