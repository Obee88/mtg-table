import type { FriendsResponse, UserSummary } from '@mtg/shared';
import { and, asc, eq, ilike, inArray, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schema, type Db } from '../db/index.js';
import { badRequest, notFound, unauthorized } from '../errors.js';
import { parse } from '../validate.js';

/** Ask by id (from a picker) or by what you know about them: display name or email, exact but case-insensitive. */
const userInput = z.union([z.object({ userId: z.uuid() }), z.object({ name: z.string().trim().min(1).max(200) })]);
const userParam = z.object({ userId: z.uuid() });
const respondInput = z.object({ accept: z.boolean() });

const pair = (a: string, b: string) => or(and(eq(schema.friendships.requesterId, a), eq(schema.friendships.addresseeId, b)), and(eq(schema.friendships.requesterId, b), eq(schema.friendships.addresseeId, a)));

/** Whether two players are (accepted) friends; sharing needs it. */
export async function areFriends(db: Db, a: string, b: string): Promise<boolean> {
  const [row] = await db.select({ status: schema.friendships.status }).from(schema.friendships).where(and(pair(a, b), eq(schema.friendships.status, 'accepted')));
  return !!row;
}

/** Ids of a player's accepted friends. */
export async function friendIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.select().from(schema.friendships).where(and(or(eq(schema.friendships.requesterId, userId), eq(schema.friendships.addresseeId, userId)), eq(schema.friendships.status, 'accepted')));
  return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
}

export async function friendRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;
  app.addHook('preHandler', async (req) => {
    if (!req.user) throw unauthorized();
  });

  const summaries = async (ids: string[]): Promise<UserSummary[]> =>
    ids.length ? db.select({ id: schema.users.id, displayName: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, ids)).orderBy(asc(schema.users.displayName)) : [];

  async function overview(me: string): Promise<FriendsResponse> {
    const rows = await db.select().from(schema.friendships).where(or(eq(schema.friendships.requesterId, me), eq(schema.friendships.addresseeId, me)));
    const other = (r: (typeof rows)[number]) => (r.requesterId === me ? r.addresseeId : r.requesterId);
    return {
      friends: await summaries(rows.filter((r) => r.status === 'accepted').map(other)),
      incoming: await summaries(rows.filter((r) => r.status === 'pending' && r.addresseeId === me).map(other)),
      outgoing: await summaries(rows.filter((r) => r.status === 'pending' && r.requesterId === me).map(other)),
    };
  }

  app.get('/friends', async (req): Promise<FriendsResponse> => overview(req.user!.id));

  /** Ask to be friends; if they already asked you, that counts as accepting. */
  app.post('/friends', async (req, reply): Promise<FriendsResponse> => {
    const me = req.user!.id;
    const input = parse(userInput, req.body);
    const [user] = 'userId' in input
      ? await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, input.userId))
      : await db.select({ id: schema.users.id }).from(schema.users).where(or(ilike(schema.users.email, input.name), ilike(schema.users.displayName, input.name)));
    if (!user) throw notFound("User doesn't exist");
    const userId = user.id;
    if (userId === me) throw badRequest('That is you');
    const [existing] = await db.select().from(schema.friendships).where(pair(me, userId));
    if (existing?.status === 'pending' && existing.requesterId === userId) {
      await db.update(schema.friendships).set({ status: 'accepted' }).where(pair(me, userId));
    } else if (!existing) {
      await db.insert(schema.friendships).values({ requesterId: me, addresseeId: userId });
    }
    reply.code(201);
    return overview(me);
  });

  /** Answer a request: accept, or reject (it disappears; they may ask again). */
  app.post('/friends/:userId/respond', async (req): Promise<FriendsResponse> => {
    const me = req.user!.id;
    const { userId } = parse(userParam, req.params);
    const { accept } = parse(respondInput, req.body);
    const [row] = await db.select().from(schema.friendships).where(and(eq(schema.friendships.requesterId, userId), eq(schema.friendships.addresseeId, me), eq(schema.friendships.status, 'pending')));
    if (!row) throw notFound('No such request');
    if (accept) await db.update(schema.friendships).set({ status: 'accepted' }).where(and(eq(schema.friendships.requesterId, userId), eq(schema.friendships.addresseeId, me)));
    else await db.delete(schema.friendships).where(and(eq(schema.friendships.requesterId, userId), eq(schema.friendships.addresseeId, me)));
    return overview(me);
  });

  /** Unfriend, or take back a request. Shares already made stay as they are. */
  app.delete('/friends/:userId', async (req): Promise<FriendsResponse> => {
    const me = req.user!.id;
    const { userId } = parse(userParam, req.params);
    await db.delete(schema.friendships).where(pair(me, userId));
    return overview(me);
  });
}
