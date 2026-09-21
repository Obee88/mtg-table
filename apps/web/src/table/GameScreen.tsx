import type { GameCommand, RoomEvent, RoomState } from '@mtg/shared';
import { seatedPlayers } from '@mtg/shared';
import type { CommandResult } from '../rooms/connection';
import { useState } from 'react';
import { CardPreviewProvider } from '../cards/CardPreview';
import { LogPanel } from './LogPanel';
import { PendingResultDialog, ResultDialog } from './ResultDialog';
import { Table } from './Table';

export interface GameRoom {
  state: RoomState;
  events: RoomEvent[];
  status: 'connecting' | 'open' | 'closed';
  connected: string[];
  send: (command: GameCommand) => Promise<CommandResult>;
}

/** The whole-viewport game: felt table plus the log column. No page scroll. */
export function GameScreen({ room, meId, leaveHref = '/rooms' }: { room: GameRoom; meId: string; leaveHref?: string }) {
  const isOwner = room.state.ownerId === meId;
  const closeRoom = () => {
    if (confirm('Abandon this room for everyone? Nothing is recorded. To end the game properly, use "End game" in the toolbar.')) void room.send({ type: 'closeRoom' });
  };
  const [proposing, setProposing] = useState<'end' | 'restart' | null>(null);
  const seated = !!room.state.players[meId];
  const outcome = (r: { ok: boolean; error?: string }) => (r.ok ? null : (r.error ?? 'Failed'));
  const propose = (then: 'end' | 'restart') => async (winners: string[] | null) => outcome(await room.send({ type: 'proposeResult', winners, then }));
  /** Conceding: the other side wins this game, once everyone confirms. */
  const forfeit = () => {
    const me = room.state.players[meId];
    const teams = room.state.settings.mode === '2v2';
    const winners = seatedPlayers(room.state)
      .filter((p) => (teams && me ? p.team !== me.team : p.id !== meId))
      .map((p) => p.id);
    if (winners.length === 0) return;
    const names = winners.map((id) => room.state.players[id]?.displayName ?? '?').join(' & ');
    if (confirm(`Forfeit game ${room.state.game?.gameNumber ?? 1}? ${names} win once everyone confirms, and the table clears.`)) {
      void room.send({ type: 'proposeResult', winners, then: 'end' });
    }
  };
  return (
    <CardPreviewProvider mode="panel">
    <main className="felt flex h-dvh w-screen overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1">
        <Table
          state={room.state}
          meId={meId}
          send={room.send}
          live={room.events}
          connected={room.connected}
          leaveHref={leaveHref}
          onEndGame={seated ? () => setProposing('end') : undefined}
          onNewGame={seated ? () => setProposing('restart') : undefined}
          onForfeit={seated ? forfeit : undefined}
        />
      </div>
      <LogPanel roomId={room.state.id} state={room.state} live={room.events} status={room.status} leaveHref={leaveHref} onCloseRoom={isOwner ? closeRoom : undefined} />
      {proposing && <ResultDialog state={room.state} then={proposing} onPropose={propose(proposing)} onClose={() => setProposing(null)} />}
      {seated && room.state.game?.pendingResult && (
        <PendingResultDialog state={room.state} meId={meId} onConfirm={async () => outcome(await room.send({ type: 'confirmResult' }))} onReject={async () => outcome(await room.send({ type: 'rejectResult' }))} />
      )}
    </main>
    </CardPreviewProvider>
  );
}
