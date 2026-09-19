import type { GameCommand, RoomEvent, RoomState } from '@mtg/shared';
import type { CommandResult } from '../rooms/connection';
import { CardPreviewProvider } from '../cards/CardPreview';
import { LogPanel } from './LogPanel';
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
  return (
    <CardPreviewProvider mode="panel">
    <main className="felt flex h-dvh w-screen overflow-hidden">
      <div className="min-h-0 min-w-0 flex-1">
        <Table state={room.state} meId={meId} send={room.send} live={room.events} connected={room.connected} />
      </div>
      <LogPanel roomId={room.state.id} state={room.state} live={room.events} status={room.status} leaveHref={leaveHref} />
    </main>
    </CardPreviewProvider>
  );
}
