import type { RoomEvent, RoomState } from '@mtg/shared';
import { describeEvent, logContextFor } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { PreviewPanel } from '../cards/CardPreview';
import { api } from '../lib/api';
import { mergeEvents } from './log';
import { seatColor } from './PlayerStrip';
import { useCards } from './useCards';

/** Full-height log column: history backfilled once, then the live buffer. Scrolls internally only. */
export function LogPanel({ roomId, state, live, status, leaveHref, onCloseRoom }: { roomId: string; state: RoomState; live: RoomEvent[]; status: 'connecting' | 'open' | 'closed'; leaveHref: string; onCloseRoom?: (() => void) | undefined }) {
  const [open, setOpen] = useState(true);
  const history = useQuery({
    queryKey: ['rooms', roomId, 'events'],
    queryFn: () => api<RoomEvent[]>(`/rooms/${roomId}/events?after=0`),
    staleTime: Infinity,
    enabled: roomId !== 'design',
  });
  const events = useMemo(() => mergeEvents(history.data ?? [], live), [history.data, live]);
  const printings = useCards(Object.values(state.game?.cards ?? {}).map((c) => c.printingId));
  const ctx = useMemo(() => logContextFor(state, (id) => printings.get(id)?.name), [state, printings]);
  const lines = useMemo(
    () => events.map((e) => ({ seq: e.seq, at: e.at, actorId: e.actorId, text: describeEvent(e, ctx) })).filter((l): l is typeof l & { text: string } => l.text !== null),
    [events, ctx],
  );
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [lines.length, open]);

  const seatOf = (id: string | null) => (id ? state.players[id]?.seat : undefined);

  return (
    <aside className={`flex h-full min-h-0 shrink-0 flex-col border-l border-white/10 bg-black/40 backdrop-blur-sm ${open ? 'w-[clamp(280px,20vw,400px)]' : 'w-6'}`}>
      <div className="flex h-9 shrink-0 items-center gap-2 px-2 text-[11px] text-text-muted">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-text-muted hover:text-text" title={open ? 'Collapse log' : 'Expand log'}>{open ? '›' : '‹'}</button>
        {open && (
          <>
            <span className={status === 'open' ? 'text-success' : 'text-accent'}>●</span>
            <span>{status === 'open' ? 'connected' : status === 'connecting' ? 'reconnecting…' : 'offline'}</span>
            <Link to={leaveHref} className="ml-auto text-accent hover:underline">Leave</Link>
            {onCloseRoom && <button type="button" onClick={onCloseRoom} className="text-danger hover:underline" title="End the game and close the room for everyone">Close room</button>}
          </>
        )}
      </div>
      {open && <div className="shrink-0 px-2 pb-2"><PreviewPanel /></div>}
      {open && (
        <ol className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2 text-[11px] leading-snug">
          {lines.map((l) => {
            const seat = seatOf(l.actorId);
            return (
              <li key={l.seq} className="text-text-muted">
                <span className="mr-1 tabular-nums text-text-muted/50">{l.at ? new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                <span className="text-text/90" style={seat !== undefined ? { borderLeft: `2px solid ${seatColor(seat)}`, paddingLeft: 4 } : undefined}>{l.text}</span>
              </li>
            );
          })}
          {lines.length === 0 && <li className="text-text-muted">Nothing yet.</li>}
          <div ref={bottom} />
        </ol>
      )}
    </aside>
  );
}
