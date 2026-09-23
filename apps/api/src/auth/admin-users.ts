import { passwordSchema, type AdminUser } from '@mtg/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schema } from '../db/index.js';
import { forbidden, notFound, unauthorized } from '../errors.js';
import { parse } from '../validate.js';
import { hashPassword } from './password.js';

const idParam = z.object({ id: z.uuid() });
const passwordInput = z.object({ password: passwordSchema });

/** Admin: the accounts of the group, and setting a password for one directly (signing that account out everywhere). */
export async function adminUserRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  app.addHook('preHandler', async (req) => {
    if (!req.user) throw unauthorized();
    if (!req.user.isAdmin) throw forbidden('Admins only');
  });

  app.get('/admin/users', async (): Promise<AdminUser[]> => {
    const rows = await db.select().from(schema.users).orderBy(asc(schema.users.displayName));
    return rows.map((u) => ({ id: u.id, email: u.email, displayName: u.displayName, isAdmin: u.isAdmin, createdAt: u.createdAt.toISOString() }));
  });

  app.post('/admin/users/:id/password', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { password } = parse(passwordInput, req.body);
    const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, id));
    if (!user) throw notFound("User doesn't exist");
    await db.transaction(async (tx) => {
      await tx.update(schema.users).set({ passwordHash: await hashPassword(password) }).where(eq(schema.users.id, id));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    });
    return reply.code(204).send();
  });
}
