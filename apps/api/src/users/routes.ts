import type { UserSummary } from '@mtg/shared';
import { asc, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schema } from '../db/index.js';
import { unauthorized } from '../errors.js';
import { parse } from '../validate.js';

const idsQuery = z.object({ ids: z.string().max(2000) });

/** Display names for known ids (reserved seats, members). The group's full list is not on offer: friends are asked for by name or email. */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', async (req): Promise<UserSummary[]> => {
    if (!req.user) throw unauthorized();
    const { ids } = parse(idsQuery, req.query);
    const wanted = [...new Set(ids.split(',').map((s) => s.trim()).filter((s) => z.uuid().safeParse(s).success))].slice(0, 50);
    if (wanted.length === 0) return [];
    return app.db.select({ id: schema.users.id, displayName: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, wanted)).orderBy(asc(schema.users.displayName));
  });
}
