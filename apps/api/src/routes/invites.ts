import { randomBytes } from 'node:crypto';
import type { Invite } from '@mtg/shared';
import { desc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema } from '../db/index.js';
import { forbidden, unauthorized } from '../errors.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const toInvite = (row: typeof schema.invites.$inferSelect): Invite => ({
  code: row.code,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  usedBy: row.usedBy,
});

export async function inviteRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;

  app.addHook('preHandler', async (req) => {
    if (!req.user) throw unauthorized();
    if (!req.user.isAdmin) throw forbidden('Admins only');
  });

  app.post('/invites', async (req, reply) => {
    const [row] = await db
      .insert(schema.invites)
      .values({
        code: randomBytes(9).toString('base64url'),
        createdBy: req.user!.id,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      })
      .returning();
    return reply.code(201).send(toInvite(row!));
  });

  app.get('/invites', async () => {
    const rows = await db.select().from(schema.invites).orderBy(desc(schema.invites.createdAt)).limit(100);
    return rows.map(toInvite);
  });
}
