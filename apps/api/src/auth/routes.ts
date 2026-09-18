import { loginSchema, registerSchema, type User } from '@mtg/shared';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { schema, type UserRow } from '../db/index.js';
import { badRequest, conflict, unauthorized } from '../errors.js';
import { parse } from '../validate.js';
import { hashPassword, verifyPassword } from './password.js';
import { clearSessionCookie, createSession, deleteSession, setSessionCookie } from './session.js';

export const toUser = (row: UserRow): User => ({
  id: row.id,
  email: row.email,
  displayName: row.displayName,
  isAdmin: row.isAdmin,
  createdAt: row.createdAt.toISOString(),
});

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const secure = app.config.NODE_ENV === 'production';

  app.post('/auth/register', async (req, reply) => {
    const input = parse(registerSchema, req.body);
    const passwordHash = await hashPassword(input.password);

    const created = await db.transaction(async (tx) => {
      const [counted] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.users);
      // Bootstrap: the very first account needs no invite and becomes admin.
      const isFirst = (counted?.count ?? 0) === 0;

      let inviteCode: string | null = null;
      if (!isFirst) {
        if (!input.inviteCode) throw badRequest('An invite code is required');
        const [invite] = await tx
          .select()
          .from(schema.invites)
          .where(
            and(
              eq(schema.invites.code, input.inviteCode),
              isNull(schema.invites.usedBy),
              gt(schema.invites.expiresAt, new Date()),
            ),
          )
          .for('update');
        if (!invite) throw badRequest('Invite code is invalid, used, or expired');
        inviteCode = invite.code;
      }

      const [existing] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, input.email));
      if (existing) throw conflict('An account with this email already exists');

      const [user] = await tx
        .insert(schema.users)
        .values({ email: input.email, passwordHash, displayName: input.displayName, isAdmin: isFirst })
        .returning();
      if (!user) throw new Error('insert returned no row');

      if (inviteCode) {
        await tx
          .update(schema.invites)
          .set({ usedBy: user.id, usedAt: new Date() })
          .where(eq(schema.invites.code, inviteCode));
      }
      return user;
    });

    setSessionCookie(reply, await createSession(db, created.id), secure);
    return reply.code(201).send(toUser(created));
  });

  app.post('/auth/login', async (req, reply) => {
    const input = parse(loginSchema, req.body);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, input.email));
    // Verify against a dummy hash when the user is missing so timing does not reveal existence.
    const ok = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Wrong email or password');
    setSessionCookie(reply, await createSession(db, user.id), secure);
    return toUser(user);
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.sessionToken) await deleteSession(db, req.sessionToken);
    clearSessionCookie(reply, secure);
    return reply.code(204).send();
  });

  app.get('/me', async (req) => {
    if (!req.user) throw unauthorized();
    return toUser(req.user);
  });
}

const DUMMY_HASH = await hashPassword('dummy-password-for-constant-time-login');
