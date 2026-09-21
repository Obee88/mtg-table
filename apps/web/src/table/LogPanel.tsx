import type { RoomEvent, RoomState } from '@mtg/shared';
import { describeEvent, logContextFor } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { PreviewPanel } from '../cards/CardPreview';
import { api } from '../lib/api';
import { useNarrowScreen } from '../lib/useMediaQuery';
import { mergeEvents } from './log';
import { playerColor } from './PlayerStrip';
import { useCards } from './useCards';
import { draftPrintingIds } from '../draft/ids';

/** Full-height log column: history backfilled once, then the live buffer. Scrolls internally only. */
export function LogPanel({ roomId, state, live, status, leaveHref, onCloseRoom, onRestart, onReport }: { roomId: string; state: RoomState; live: RoomEvent[]; status: 'connecting' | 'open' | 'closed'; leaveHref: string; onCloseRoom?: (() => void) | undefined; onRestart?: (() => void) | undefined; onReport?: (() => void) | undefined }) {
  // On a tablet the table needs the width: the log slides over it instead of sitting beside it.
  const narrow = useNarrowScreen();
  const [open, setOpen] = useState(!narrow);
  const history = useQuery({
    queryKey: ['rooms', roomId, 'events'],
    queryFn: () => api<RoomEvent[]>(`/rooms/${roomId}/events?after=0`),
    staleTime: Infinity,
    enabled: roomId !== 'design',
  });
  const events = useMemo(() => mergeEvents(history.data ?? [], live), [history.data, live]);
  const printings = useCards([...Object.values(state.game?.cards ?? {}).map((c) => c.printingId), ...draftPrintingIds(state.draft)]);
  const ctx = useMemo(() => logContextFor(state, (id) => printings.get(id)?.name), [state, printings]);
  const lines = useMemo(
    () => events.map((e) => ({ seq: e.seq, at: e.at, actorId: e.actorId, text: describeEvent(e, ctx) })).filter((l): l is typeof l & { text: string } => l.text !== null),
    [events, ctx],
  );
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [lines.length, open]);

  const colorOf = (id: string | null) => (id && state.players[id] ? playerColor(state, state.players[id]!) : undefined);

  return (
    <>
    {narrow && open && <div className="fixed inset-0 z-30 bg-black/50" onClick={() => setOpen(false)} aria-hidden />}
    <aside
      className={`flex min-h-0 flex-col border-l border-white/10 bg-black/40 backdrop-blur-sm ${
        narrow
          ? open
            ? 'fixed right-0 top-0 z-40 h-dvh w-[min(85vw,360px)]'
            : 'fixed right-0 top-2 z-40 h-10 w-10 items-center justify-center rounded-l-md bg-black/60'
          : `h-full shrink-0 ${open ? 'w-[clamp(280px,20vw,400px)]' : 'w-6'}`
      }`}
      style={narrow ? { paddingRight: 'env(safe-area-inset-right)' } : undefined}
    >
      <div className={`flex shrink-0 items-center gap-2 text-[11px] text-text-muted ${open ? 'h-9 px-2' : 'h-full justify-center'}`}>
        <button type="button" onClick={() => setOpen((o) => !o)} className="touch-target text-text-muted hover:text-text" title={open ? 'Collapse log' : 'Expand log'}>{open ? '›' : '‹'}</button>
        {open && (
          <>
            <span className={status === 'open' ? 'text-success' : 'text-accent'}>●</span>
            <span>{status === 'open' ? 'connected' : status === 'connecting' ? 'reconnecting…' : 'offline'}</span>
            <Link to={leaveHref} className="touch-target ml-auto text-accent hover:underline">Leave</Link>
            {onReport && <button type="button" onClick={onReport} className="touch-target text-accent hover:underline" title="Record who won this game">Report result</button>}
            {onRestart && <button type="button" onClick={onRestart} className="touch-target text-accent hover:underline" title="Deal new hands for everyone">Restart</button>}
            {onCloseRoom && <button type="button" onClick={onCloseRoom} className="touch-target text-danger hover:underline" title="Close the room without recording anything">Abandon</button>}
          </>
        )}
      </div>
      {open && <div className="shrink-0 px-2 pb-2"><PreviewPanel /></div>}
      {open && (
        <ol className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2 text-[11px] leading-snug">
          {lines.map((l) => {
            const color = colorOf(l.actorId);
            return (
              <li key={l.seq} className="text-text-muted">
                <span className="mr-1 tabular-nums text-text-muted/50">{l.at ? new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
                <span className="text-text/90" style={color ? { borderLeft: `2px solid ${color}`, paddingLeft: 4 } : undefined}>{l.text}</span>
              </li>
            );
          })}
          {lines.length === 0 && <li className="text-text-muted">Nothing yet.</li>}
          <div ref={bottom} />
        </ol>
      )}
    </aside>
    </>
  );
}
