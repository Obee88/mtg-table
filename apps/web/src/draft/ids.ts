import type { DraftState } from '@mtg/shared';

/** Every printing id a draft state references for the viewer (blank ids are hidden cards). */
export function draftPrintingIds(draft: DraftState | null | undefined): string[] {
  if (!draft) return [];
  const ids = new Set<string>();
  for (const p of Object.values(draft.packs)) for (const c of p.cards) if (c.printingId) ids.add(c.printingId);
  for (const p of Object.values(draft.players)) for (const c of [...p.pool, ...p.faceUp]) if (c.printingId) ids.add(c.printingId);
  return [...ids];
}
