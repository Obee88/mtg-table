import type { DeckSummary, RoomState, UserSummary } from '@mtg/shared';
import { canSit, defaultDraftName, seatedPlayers, startBlockers, teamForSeat } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Card, Dialog, ErrorText, Input, Select } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { describeSettings } from './describe';
import { SettingsForm } from './SettingsForm';
import { QuickImportDialog } from './QuickImportDialog';
import { EndOfGameCard } from './EndOfGameCard';
import { CopyButton } from '../components/CopyButton';
import { DraftScreen } from '../draft/DraftScreen';
import { GameScreen } from '../table/GameScreen';
import { useRoom } from './useRoom';
import { useAttentionCues } from '../table/useAttentionCues';

export function RoomPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const room = useRoom(id, me.data ? { id: me.data.id, displayName: me.data.displayName } : undefined);
  useAttentionCues(room.state, me.data?.id);

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
        <Link to="/" className="text-sm text-accent hover:underline">Play</Link>
      </header>
      {room.state.phase === 'lobby' && <Lobby state={room.state} meId={me.data.id} connected={room.connected} send={room.send} />}
      {room.state.phase === 'ended' && (room.state.results.length > 0 ? <EndOfGameCard state={room.state} meId={me.data.id} closed /> : <p className="text-text-muted">This room has been closed. <Link to="/" className="text-accent hover:underline">Back to Play</Link></p>)}
    </main>
  );
}

/**
 * One column: who sits where and what is missing, my own deck and ready
 * state with an inline import, the host's Start with its blocking reasons,
 * an invite link. Settings and closing hide behind a toggle for the host.
 */
function Lobby({ state, meId, connected, send }: { state: RoomState; meId: string; connected: string[]; send: ReturnType<typeof useRoom>['send'] }) {
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const me = state.players[meId];
  const isOwner = state.ownerId === meId;
  const decks = useQuery({ queryKey: ['decks'], queryFn: () => api<DeckSummary[]>('/decks'), enabled: !!me });
  const players = seatedPlayers(state);
  const blockers = startBlockers(state);
  const drafting = !!state.settings.draft;
  // A draft that already happened: the next game deals the decks built from it.
  const drafted = state.draft?.status === 'finished';
  const needDeck = !drafting && !drafted;
  const played = state.results.length;
  const reserved = state.settings.reservedPlayerIds ?? [];
  const users = useQuery({ queryKey: ['users', reserved.join(',')], queryFn: () => api<UserSummary[]>(`/users?ids=${reserved.join(',')}`), enabled: reserved.length > 0 });
  const reservedNames = reserved.map((id) => users.data?.find((u) => u.id === id)?.displayName ?? '…');
  const maySit = canSit(state, meId);
  const inviteLink = `${window.location.origin}/rooms/${state.id}`;

  const run = async (command: Parameters<typeof send>[0]) => {
    setError(null);
    const r = await send(command);
    if (!r.ok) setError(r.error);
  };
  const recent = (decks.data ?? []).slice(0, 4);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      {played > 0 && (
        <EndOfGameCard
          state={state}
          meId={meId}
          onPlayAgain={me ? () => void run(isOwner && blockers.length === 0 ? { type: 'start' } : { type: 'setReady', ready: true }) : undefined}
        />
      )}
      <Card title={`Seats · ${players.length}/${state.settings.playerCount}`}>
        {reserved.length > 0 && <p className="mb-3 text-sm text-text-muted"><Chip type="primary">reserved</Chip> for {reservedNames.join(', ')} and the host; others can watch.</p>}
        <ul className="flex flex-col gap-2">
          {Array.from({ length: state.settings.playerCount }, (_, seat) => {
            const p = players.find((x) => x.seat === seat);
            return (
              <li key={seat} className="flex items-center gap-3 rounded-md border border-border bg-surface-raised px-3 py-2 text-sm">
                <span className="w-6 text-text-muted">#{seat + 1}</span>
                {p ? (
                  <>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${connected.includes(p.id) ? 'bg-success' : 'bg-border'}`} title={connected.includes(p.id) ? 'online' : 'offline'} />
                    <span className="min-w-0 flex-1 truncate font-medium">{p.displayName}{p.id === meId && <span className="text-text-muted"> (you)</span>}{p.id === state.ownerId && <Chip type="primary" className="ml-1">host</Chip>}</span>
                    {state.settings.mode === '2v2' && <Chip type="neutral">team {p.team + 1}</Chip>}
                    <Chip type={p.ready ? 'success' : 'neutral'} shape="pill">{p.ready ? 'ready' : needDeck && !p.deckId ? 'no deck yet' : 'not ready'}</Chip>
                  </>
                ) : (
                  <span className="flex flex-1 items-center justify-between text-text-muted">
                    <span>{reserved.length > 0 ? 'reserved seat' : 'empty'}{state.settings.mode === '2v2' && ` · team ${teamForSeat(seat, state.settings.mode) + 1}`}</span>
                    {me ? (
                      <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => run({ type: 'takeSeat', seat })}>Move here</Button>
                    ) : (
                      <Button variant="ghost" className="!px-2 !py-0.5 text-xs" disabled={!maySit} title={maySit ? undefined : 'This table is reserved for other players'} onClick={() => run({ type: 'join' })}>Sit here</Button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <CopyButton text={inviteLink} copiedLabel="Link copied ✓" title={inviteLink}>Copy invite link</CopyButton>
          <span className="text-text-muted">Anyone in the group can open it{reserved.length > 0 ? '; only the reserved players can sit' : ''}.</span>
        </div>
      </Card>

      {me && (
        <Card title="You">
          <div className="flex flex-col gap-3">
            {needDeck ? (
              <div className="flex flex-col gap-2 text-sm">
                <span className="text-text-muted">Your deck</span>
                <div className="flex flex-wrap items-center gap-2">
                  {recent.map((d) => (
                    <Button key={d.id} variant={me.deckId === d.id ? 'primary' : 'ghost'} className="!py-1 text-xs" onClick={() => run({ type: 'selectDeck', deckId: me.deckId === d.id ? null : d.id })} title={`${d.mainCount} cards`}>{d.name}</Button>
                  ))}
                  {(decks.data?.length ?? 0) > recent.length && (
                    <Select value={me.deckId ?? ''} onChange={(e) => run({ type: 'selectDeck', deckId: e.target.value || null })} className="!py-1" aria-label="Other decks">
                      <option value="">other decks…</option>
                      {decks.data?.slice(recent.length).map((d) => <option key={d.id} value={d.id}>{d.name} ({d.mainCount})</option>)}
                    </Select>
                  )}
                  <Button variant="ghost" className="!py-1 text-xs" onClick={() => setImporting(true)}>Import…</Button>
                </div>
                {decks.data?.length === 0 && <span className="text-text-muted">No decks yet: import one here, it is saved to your Decks too.</span>}
              </div>
            ) : (
              <p className="text-sm text-text-muted">{drafted ? 'You play the deck you built from your draft pool.' : 'Decks are built after the draft.'}</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => run({ type: 'setReady', ready: !me.ready })} disabled={needDeck && !me.deckId} variant={me.ready ? 'ghost' : 'primary'}>{me.ready ? 'Not ready after all' : "I'm ready"}</Button>
              <Button variant="ghost" onClick={() => run({ type: 'leave' })}>Leave seat</Button>
            </div>
          </div>
        </Card>
      )}

      {isOwner && (
        <Card title={played > 0 ? 'Next game' : 'Start'}>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => (drafting && !drafted ? setNaming(state.name ?? defaultDraftName(state, new Date())) : run({ type: 'start' }))} disabled={blockers.length > 0}>
              {drafting && !drafted ? 'Start the draft' : played > 0 ? 'Start another game' : 'Start the game'}
            </Button>
            {blockers.length > 0 ? (
              <ul className="text-sm text-text-muted">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>
            ) : (
              <span className="text-sm text-success">Everyone is ready.</span>
            )}
          </div>
        </Card>
      )}

      {isOwner && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-sm">
            <button type="button" className="text-accent hover:underline" onClick={() => setShowSettings((s) => !s)}>{showSettings ? 'Hide settings' : 'Settings…'}</button>
            <Button variant="ghost" className="ml-auto text-danger" onClick={() => confirm('Close this room for everyone?') && run({ type: 'closeRoom' })}>Close room</Button>
          </div>
          {showSettings && (
            <Card title="Settings">
              <SettingsForm value={state.settings} onChange={(settings) => run({ type: 'updateSettings', settings })} />
              <p className="mt-2 text-xs text-text-muted">Changing settings clears everyone's ready state. Player count cannot drop below the seated players.</p>
            </Card>
          )}
        </div>
      )}
      <ErrorText error={error} />

      {importing && (
        <QuickImportDialog
          onClose={() => setImporting(false)}
          onSaved={(deckId) => {
            setImporting(false);
            void run({ type: 'selectDeck', deckId });
          }}
        />
      )}
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
            <p className="text-xs text-text-muted">Shown on Play and in Past drafts, so you can find these decks again.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setNaming(null)}>Cancel</Button>
              <Button type="submit">Start draft</Button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
