import type { RoomEvent } from '@mtg/shared';
import { useEffect, useRef, useState } from 'react';
import { touchedPlayers } from './log';

const HIGHLIGHT_MS = 900;

/** Player ids whose area changed in the last moment; used for a brief ring pulse. */
export function useHighlights(live: RoomEvent[], cardOwner: (instanceId: string) => string | undefined, meId: string): ReadonlySet<string> {
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());
  const seen = useRef(0);
  useEffect(() => {
    const fresh = live.filter((e) => e.seq > seen.current);
    if (fresh.length === 0) return;
    seen.current = fresh[fresh.length - 1]!.seq;
    // Own actions are not surprising; highlight what others did.
    const ids = new Set(fresh.filter((e) => e.actorId !== meId).flatMap((e) => touchedPlayers(e, cardOwner)));
    ids.delete(meId);
    if (ids.size === 0) return;
    setActive((prev) => new Set([...prev, ...ids]));
    const t = setTimeout(() => setActive((prev) => new Set([...prev].filter((id) => !ids.has(id)))), HIGHLIGHT_MS);
    return () => clearTimeout(t);
  }, [live, cardOwner, meId]);
  return active;
}
