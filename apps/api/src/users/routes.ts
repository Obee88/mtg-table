import type { UserSummary } from '@mtg/shared';
import { asc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema } from '../db/index.js';
import { unauthorized } from '../errors.js';

/** The members of this private group, for pickers (sharing a cube, seating). */
export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get('/users', async (req): Promise<UserSummary[]> => {
    if (!req.user) throw unauthorized();
    return app.db.select({ id: schema.users.id, displayName: schema.users.displayName }).from(schema.users).orderBy(asc(schema.users.displayName));
  });
}
