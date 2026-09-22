import type { CardPrinting, CardPrintingsResponse, CardSearchResponse, TokenSuggestion } from '@mtg/shared';
import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schema } from '../db/index.js';
import { notFound, unauthorized } from '../errors.js';
import { parse } from '../validate.js';
import { basicLands, defaultPrintings, getPrinting, getPrintings, listPrintings, searchCards } from './search.js';
import { taplandRoutes } from './taplands.js';

const searchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Tokens are excluded from card search unless asked for. */
  kind: z.enum(['cards', 'tokens']).default('cards'),
});
const uuidParam = z.object({ id: z.uuid() });
const lookupInput = z.object({ ids: z.array(z.uuid()).max(500) });
const defaultsInput = z.object({ oracleIds: z.array(z.uuid()).max(1000) });
const recentTokensQuery = z.object({ deckId: z.uuid().optional() });

export async function cardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req) => {
    if (!req.user) throw unauthorized();
  });
  taplandRoutes(app);

  app.get('/cards/search', async (req): Promise<CardSearchResponse> => {
    const { q, limit, kind } = parse(searchQuery, req.query);
    return { results: await searchCards(app.db, q, limit, kind) };
  });

  app.get('/cards/oracle/:id/printings', async (req): Promise<CardPrintingsResponse> => {
    const { id } = parse(uuidParam, req.params);
    return { printings: await listPrintings(app.db, id) };
  });

  /** Printings by id, for rendering a table. Unknown ids are omitted. */
  app.post('/cards/lookup', async (req): Promise<CardPrintingsResponse> => {
    const { ids } = parse(lookupInput, req.body);
    return { printings: await getPrintings(app.db, ids) };
  });

  /** Default printing (oldest English paper non-promo) per oracle id. */
  app.post('/cards/default-printings', async (req): Promise<{ printings: Record<string, CardPrinting> }> => {
    const { oracleIds } = parse(defaultsInput, req.body);
    return { printings: await defaultPrintings(app.db, oracleIds) };
  });

  /** Basic lands drafters may add for free. */
  app.get('/cards/basics', async (): Promise<{ printings: CardPrinting[] }> => ({ printings: await basicLands(app.db) }));

  /** Tokens the caller has made before, the ones from this deck first. */
  app.get('/cards/tokens/recent', async (req): Promise<{ tokens: TokenSuggestion[] }> => {
    const { deckId } = parse(recentTokensQuery, req.query);
    const rows = await app.db
      .select()
      .from(schema.tokenUses)
      .where(eq(schema.tokenUses.userId, req.user!.id))
      .orderBy(desc(schema.tokenUses.uses), desc(schema.tokenUses.lastUsedAt))
      .limit(60);
    const printings = new Map((await getPrintings(app.db, rows.map((r) => r.printingId).filter((id): id is string => !!id))).map((p) => [p.id, p]));
    const seen = new Set<string>();
    const tokens: TokenSuggestion[] = [];
    for (const r of [...rows].sort((a, b) => Number(b.deckKey === deckId) - Number(a.deckKey === deckId))) {
      if (seen.has(r.tokenKey)) continue;
      seen.add(r.tokenKey);
      const printing = r.printingId ? (printings.get(r.printingId) ?? null) : null;
      if (r.printingId && !printing) continue;
      tokens.push({ printing, customName: r.customName, uses: r.uses, thisDeck: !!deckId && r.deckKey === deckId });
    }
    return { tokens: tokens.slice(0, 12) };
  });

  app.get('/cards/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const printing = await getPrinting(app.db, id);
    if (!printing) throw notFound('Unknown card');
    return printing;
  });
}
