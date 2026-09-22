import { detectTapland, type CardPrinting, type TaplandFace, type TaplandSuggestion } from '@mtg/shared';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schema, type Db } from '../db/index.js';
import { parse } from '../validate.js';
import { toPrinting } from './search.js';

/**
 * The group's tapland list, by card name, kept in memory: it is tiny, read on
 * every printing served and on every card played, and only changes through
 * the routes below (single API process).
 */
const faces = new Map<string, TaplandFace>();

export async function loadTaplands(db: Db): Promise<void> {
  faces.clear();
  for (const row of await db.select().from(schema.taplands)) faces.set(row.name, row.face);
}

/** Which face of the named card is a land that always enters tapped, if marked. */
export const taplandFace = (name: string): TaplandFace | null => faces.get(name) ?? null;

/** The same, for a printing id (one indexed lookup). */
export async function taplandForPrinting(db: Db, printingId: string): Promise<TaplandFace | null> {
  if (faces.size === 0) return null;
  const [row] = await db.select({ name: schema.cards.name }).from(schema.cards).where(eq(schema.cards.id, printingId));
  return row ? taplandFace(row.name) : null;
}

const setInput = z.object({ name: z.string().trim().min(1).max(200), face: z.enum(['front', 'back']).nullable() });
const suggestInput = z.object({ ids: z.array(z.uuid()).max(500) });

export interface TaplandSuggestionResponse {
  suggestions: (TaplandSuggestion & { printing: CardPrinting })[];
}

/** Under the card routes' auth hook: any signed-in player may curate the list. */
export function taplandRoutes(app: FastifyInstance): void {
  app.get('/cards/taplands', async (): Promise<{ taplands: { name: string; face: TaplandFace }[] }> => ({
    taplands: [...faces].map(([name, face]) => ({ name, face })).sort((a, b) => a.name.localeCompare(b.name)),
  }));

  /** Mark (face) or unmark (null) a card, by name. */
  app.put('/cards/taplands', async (req): Promise<{ name: string; face: TaplandFace | null }> => {
    const { name, face } = parse(setInput, req.body);
    if (face) {
      await app.db.insert(schema.taplands).values({ name, face, setBy: req.user!.id }).onConflictDoUpdate({ target: schema.taplands.name, set: { face, setBy: req.user!.id } });
      faces.set(name, face);
    } else {
      await app.db.delete(schema.taplands).where(eq(schema.taplands.name, name));
      faces.delete(name);
    }
    return { name, face };
  });

  /** Lands among the given printings whose rules text says they always enter tapped, and which are not marked yet. */
  app.post('/cards/taplands/suggest', async (req): Promise<TaplandSuggestionResponse> => {
    const { ids } = parse(suggestInput, req.body);
    if (ids.length === 0) return { suggestions: [] };
    const rows = await app.db.select().from(schema.cards).where(inArray(schema.cards.id, ids));
    const seen = new Set<string>();
    const suggestions: TaplandSuggestionResponse['suggestions'] = [];
    for (const row of rows) {
      if (seen.has(row.name) || faces.has(row.name)) continue;
      const hit = detectTapland(row);
      if (!hit) continue;
      seen.add(row.name);
      suggestions.push({ ...hit, printing: toPrinting(row) });
    }
    return { suggestions: suggestions.sort((a, b) => a.printing.name.localeCompare(b.printing.name)) };
  });
}
