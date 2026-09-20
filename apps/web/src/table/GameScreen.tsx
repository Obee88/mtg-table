import type { GameCommand, RoomEvent, RoomState } from '@mtg/shared';
import type { CommandResult } from '../rooms/connection';
import { useState } from 'react';
import { CardPreviewProvider } from '../cards/CardPreview';
import { LogPanel } from './LogPanel';
import { ResultDialog } from './ResultDialog';
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
  const restart = () => {
    if (confirm('Restart the game? New hands are dealt for everyone.')) void room.send({ type: 'restart' });
  };
  const closeRoom = () => {
    if (confirm('Close this room for everyone? The game ends.')) void room.send({ type: 'closeRoom' });
  };
  const [reporting, setReporting] = useState(false);
  const seated = !!room.state.players[meId];
  const report = async (winners: string[], note: string) => {
    const r = await room.send({ type: 'reportResult', winners, ...(note.trim() ? { note: note.trim() } : {}) });
    return r.ok ? null : r.error;
  };
  return (
    <CardPreviewProvider mode="panel">
    <main className="felt flex h-dvh w-screen overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1">
        <Table state={room.state} meId={meId} send={room.send} live={room.events} connected={room.connected} />
      </div>
      <LogPanel roomId={room.state.id} state={room.state} live={room.events} status={room.status} leaveHref={leaveHref} onCloseRoom={isOwner ? closeRoom : undefined} onRestart={isOwner ? restart : undefined} onReport={seated ? () => setReporting(true) : undefined} />
      {reporting && <ResultDialog state={room.state} onReport={report} onClose={() => setReporting(false)} />}
    </main>
    </CardPreviewProvider>
  );
}
