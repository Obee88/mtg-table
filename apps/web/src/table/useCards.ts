import type { CardPrinting, CardPrintingsResponse } from '@mtg/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { rememberTapland } from '../cards/taplandLookup';

/** Process-wide cache of printings by id; a table references the same few hundred ids for its whole life. */
const cache = new Map<string, CardPrinting>();
let inflight: Promise<void> | null = null;
let queued = new Set<string>();
const listeners = new Set<() => void>();

function request(ids: string[]) {
  for (const id of ids) if (!cache.has(id)) queued.add(id);
  if (queued.size === 0 || inflight) return;
  const batch = [...queued];
  queued = new Set();
  inflight = api<CardPrintingsResponse>('/cards/lookup', { body: { ids: batch } })
    .then((res) => {
      for (const p of res.printings) {
        cache.set(p.id, p);
        rememberTapland(p.id, p.entersTapped);
      }
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
      for (const l of listeners) l();
      if (queued.size > 0) request([]);
    });
}

/** Printings for the given ids (nulls skipped); re-renders as lookups complete. */
export function useCards(ids: readonly (string | null)[]): Map<string, CardPrinting> {
  const [, bump] = useState(0);
  const wanted = useMemo(() => [...new Set(ids.filter((id): id is string => id !== null))], [ids]);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    request(wanted);
    return () => {
      listeners.delete(l);
    };
  }, [wanted]);
  return cache;
}

/** Preloads printings (design playground, tests). */
export function seedCards(printings: CardPrinting[]): void {
  for (const p of printings) {
    cache.set(p.id, p);
    rememberTapland(p.id, p.entersTapped);
  }
}
