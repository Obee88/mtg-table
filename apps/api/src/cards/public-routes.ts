import type { CardPrintingsResponse, CardSearchResponse } from '@mtg/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { notFound, unauthorized } from '../errors.js';
import { parse } from '../validate.js';
import { getPrinting, listPrintings, searchCards } from './search.js';

const searchQuery = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const uuidParam = z.object({ id: z.uuid() });

export async function cardRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req) => {
    if (!req.user) throw unauthorized();
  });

  app.get('/cards/search', async (req): Promise<CardSearchResponse> => {
    const { q, limit } = parse(searchQuery, req.query);
    return { results: await searchCards(app.db, q, limit) };
  });

  app.get('/cards/oracle/:id/printings', async (req): Promise<CardPrintingsResponse> => {
    const { id } = parse(uuidParam, req.params);
    return { printings: await listPrintings(app.db, id) };
  });

  app.get('/cards/:id', async (req) => {
    const { id } = parse(uuidParam, req.params);
    const printing = await getPrinting(app.db, id);
    if (!printing) throw notFound('Unknown card');
    return printing;
  });
}
