import { createHash, randomBytes } from 'node:crypto';
import { changePasswordSchema, emailSchema, resetPasswordSchema, type PasswordReset } from '@mtg/shared';
import { and, desc, eq, gt, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schema } from '../db/index.js';
import { badRequest, forbidden, notFound, unauthorized } from '../errors.js';
import { parse } from '../validate.js';
import { hashPassword, verifyPassword } from './password.js';
import { createSession, setSessionCookie } from './session.js';

const RESET_TTL_MS = 24 * 60 * 60 * 1000;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const forgotInput = z.object({ email: emailSchema });
const issueInput = z.object({ email: emailSchema });
const tokenParam = z.object({ token: z.string().min(10).max(200) });

/**
 * No mail goes out of this app, so a reset is a one-time link an admin makes
 * and hands over (Discord, in person). The login page lets a player ask for
 * one; the admin sees who asked and can issue a link for anyone.
 */
export async function resetRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  const secure = app.config.NODE_ENV === 'production';

  /** From the login page: "I forgot my password". Always answers the same, so it cannot be used to probe for accounts. */
  app.post('/auth/forgot', async (req, reply) => {
    const { email } = parse(forgotInput, req.body);
    const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
    if (user) {
      const [open] = await db.select({ id: schema.passwordResets.id }).from(schema.passwordResets).where(and(eq(schema.passwordResets.userId, user.id), isNull(schema.passwordResets.usedAt)));
      if (!open) await db.insert(schema.passwordResets).values({ userId: user.id });
    }
    return reply.code(202).send({ ok: true });
  });

  /** Whose password a link resets, so the page can say so; 404 when the link is unknown, used or expired. */
  app.get('/auth/reset/:token', async (req): Promise<{ displayName: string }> => {
    const { token } = parse(tokenParam, req.params);
    const [row] = await db
      .select({ displayName: schema.users.displayName })
      .from(schema.passwordResets)
      .innerJoin(schema.users, eq(schema.users.id, schema.passwordResets.userId))
      .where(and(eq(schema.passwordResets.tokenHash, hashToken(token)), isNull(schema.passwordResets.usedAt), gt(schema.passwordResets.expiresAt, new Date())));
    if (!row) throw notFound('This reset link is unknown, already used, or has expired');
    return row;
  });

  /** Sets the new password, signs every other session out, and signs this browser in. */
  app.post('/auth/reset', async (req, reply) => {
    const { token, password } = parse(resetPasswordSchema, req.body);
    const userId = await db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.passwordResets)
        .where(and(eq(schema.passwordResets.tokenHash, hashToken(token)), isNull(schema.passwordResets.usedAt), gt(schema.passwordResets.expiresAt, new Date())))
        .for('update');
      if (!row) throw badRequest('This reset link is unknown, already used, or has expired');
      await tx.update(schema.users).set({ passwordHash: await hashPassword(password) }).where(eq(schema.users.id, row.userId));
      await tx.update(schema.passwordResets).set({ usedAt: new Date() }).where(eq(schema.passwordResets.id, row.id));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, row.userId));
      return row.userId;
    });
    setSessionCookie(reply, await createSession(db, userId), secure);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    return { id: user!.id, email: user!.email, displayName: user!.displayName, isAdmin: user!.isAdmin, createdAt: user!.createdAt.toISOString() };
  });

  /** Signed in: change your own password; every other browser is signed out, this one stays. */
  app.post('/auth/password', async (req, reply) => {
    if (!req.user) throw unauthorized();
    const { current, next } = parse(changePasswordSchema, req.body);
    if (!(await verifyPassword(current, req.user.passwordHash))) throw badRequest('The current password is wrong');
    const keep = req.sessionToken ? hashToken(req.sessionToken) : null;
    await db.transaction(async (tx) => {
      await tx.update(schema.users).set({ passwordHash: await hashPassword(next) }).where(eq(schema.users.id, req.user!.id));
      await tx.delete(schema.sessions).where(keep ? and(eq(schema.sessions.userId, req.user!.id), ne(schema.sessions.tokenHash, keep)) : eq(schema.sessions.userId, req.user!.id));
    });
    return reply.code(204).send();
  });

  // ---- admin ----
  const admin = async (req: { user: { isAdmin: boolean } | null }) => {
    if (!req.user) throw unauthorized();
    if (!req.user.isAdmin) throw forbidden('Admins only');
  };
  const toReset = (r: typeof schema.passwordResets.$inferSelect, u: { displayName: string; email: string }, link: string | null): PasswordReset => ({
    id: r.id, userId: r.userId, displayName: u.displayName, email: u.email, requestedAt: r.createdAt.toISOString(), link, expiresAt: r.expiresAt?.toISOString() ?? null, usedAt: r.usedAt?.toISOString() ?? null,
  });

  /** Open requests and recently issued links (the links themselves are only shown at issue time). */
  app.get('/admin/password-resets', async (req): Promise<PasswordReset[]> => {
    await admin(req);
    const rows = await db
      .select({ r: schema.passwordResets, displayName: schema.users.displayName, email: schema.users.email })
      .from(schema.passwordResets)
      .innerJoin(schema.users, eq(schema.users.id, schema.passwordResets.userId))
      .orderBy(desc(schema.passwordResets.createdAt))
      .limit(50);
    return rows.map(({ r, displayName, email }) => toReset(r, { displayName, email }, null));
  });

  /** Issue a one-time link for a player (by email); fulfils their open request if there is one. */
  app.post('/admin/password-resets', async (req, reply): Promise<PasswordReset> => {
    await admin(req);
    const { email } = parse(issueInput, req.body);
    const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    if (!user) throw notFound("User doesn't exist");
    const token = randomBytes(24).toString('base64url');
    const values = { tokenHash: hashToken(token), issuedBy: req.user!.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) };
    const [open] = await db.select().from(schema.passwordResets).where(and(eq(schema.passwordResets.userId, user.id), isNull(schema.passwordResets.usedAt), isNull(schema.passwordResets.tokenHash)));
    const [row] = open
      ? await db.update(schema.passwordResets).set(values).where(eq(schema.passwordResets.id, open.id)).returning()
      : await db.insert(schema.passwordResets).values({ userId: user.id, ...values }).returning();
    const link = `${app.config.WEB_ORIGIN}/reset?token=${encodeURIComponent(token)}`;
    reply.code(201);
    return toReset(row!, user, link);
  });
}
