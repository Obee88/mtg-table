import type { RoomEvent, RoomState } from '@mtg/shared';
import { describeEvent, logContextFor } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { mergeEvents } from './log';
import { useCards } from './useCards';

/** Scrollable game log: history backfilled once, then the live event buffer. */
export function LogPanel({ roomId, state, live }: { roomId: string; state: RoomState; live: RoomEvent[] }) {
  const [open, setOpen] = useState(true);
  const history = useQuery({
    queryKey: ['rooms', roomId, 'events'],
    queryFn: () => api<RoomEvent[]>(`/rooms/${roomId}/events?after=0`),
    staleTime: Infinity,
  });
  const events = useMemo(() => mergeEvents(history.data ?? [], live), [history.data, live]);
  const printings = useCards(Object.values(state.game?.cards ?? {}).map((c) => c.printingId));
  const ctx = useMemo(() => logContextFor(state, (id) => printings.get(id)?.name), [state, printings]);
  const lines = useMemo(
    () => events.map((e) => ({ seq: e.seq, at: e.at, text: describeEvent(e, ctx) })).filter((l): l is { seq: number; at: string; text: string } => l.text !== null),
    [events, ctx],
  );
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [lines.length, open]);

  return (
    <aside className={`flex shrink-0 flex-col rounded-lg border border-border bg-surface ${open ? 'w-72' : 'w-10'}`}>
      <button type="button" className="flex items-center justify-between px-3 py-2 text-sm font-medium" onClick={() => setOpen((o) => !o)} title={open ? 'Collapse log' : 'Expand log'}>
        {open ? <span>Log · {lines.length}</span> : <span className="sr-only">Log</span>}
        <span className="text-text-muted">{open ? '›' : '‹'}</span>
      </button>
      {open && (
        <ol className="flex max-h-[70vh] flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3 text-xs">
          {lines.map((l) => (
            <li key={l.seq} className="text-text-muted">
              <span className="mr-1 tabular-nums text-text-muted/60">{l.at ? new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span>
              <span className="text-text">{l.text}</span>
            </li>
          ))}
          {lines.length === 0 && <li className="text-text-muted">Nothing yet.</li>}
          <div ref={bottom} />
        </ol>
      )}
    </aside>
  );
}
