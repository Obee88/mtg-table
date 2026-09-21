import { draftConfigSchema, type DraftConfigResponse, type DraftConfigSummary, type DraftPoolInfo } from '@mtg/shared';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schema, type Db, type DraftConfigRow } from '../db/index.js';
import { badRequest, notFound, unauthorized } from '../errors.js';
import { parse } from '../validate.js';

const configInput = z.object({ name: z.string().trim().min(1).max(80), config: draftConfigSchema });
const idParam = z.object({ id: z.uuid() });
const memberInput = z.object({ userId: z.uuid() });
const memberParam = z.object({ id: z.uuid(), userId: z.uuid() });

/** Cube and size of each referenced version, for display and validation. */
export async function poolInfo(db: Db, versionIds: string[]): Promise<DraftPoolInfo[]> {
  const ids = [...new Set(versionIds)];
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      versionId: schema.cubeVersions.id,
      cubeId: schema.cubes.id,
      cubeName: schema.cubes.name,
      versionNumber: schema.cubeVersions.number,
      cardCount: sql<number>`coalesce((select sum(${schema.cubeVersionCards.quantity}) from ${schema.cubeVersionCards} where ${schema.cubeVersionCards.versionId} = ${schema.cubeVersions.id}), 0)::int`,
    })
    .from(schema.cubeVersions)
    .innerJoin(schema.cubes, eq(schema.cubes.id, schema.cubeVersions.cubeId))
    .where(inArray(schema.cubeVersions.id, ids));
  return rows;
}

export async function draftConfigRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;

  app.addHook('preHandler', async (req) => {
    if (!req.user) throw unauthorized();
  });

  async function owned(id: string, userId: string): Promise<DraftConfigRow> {
    const [row] = await db.select().from(schema.draftConfigs).where(and(eq(schema.draftConfigs.id, id), eq(schema.draftConfigs.ownerId, userId)));
    if (!row) throw notFound('Draft configuration not found');
    return row;
  }

  /** A format the caller owns or was given access to (read-only for members). */
  async function accessible(id: string, userId: string): Promise<DraftConfigRow> {
    const [row] = await db.select().from(schema.draftConfigs).where(eq(schema.draftConfigs.id, id));
    if (!row) throw notFound('Draft configuration not found');
    if (row.ownerId === userId) return row;
    const [member] = await db.select().from(schema.draftConfigMembers).where(and(eq(schema.draftConfigMembers.configId, id), eq(schema.draftConfigMembers.userId, userId)));
    if (!member) throw notFound('Draft configuration not found');
    return row;
  }

  async function membersOf(configId: string): Promise<{ id: string; displayName: string }[]> {
    return db
      .select({ id: schema.users.id, displayName: schema.users.displayName })
      .from(schema.draftConfigMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.draftConfigMembers.userId))
      .where(eq(schema.draftConfigMembers.configId, configId))
      .orderBy(asc(schema.users.displayName));
  }

  /** Every pool must be a version of one of the caller's cubes. */
  async function checkPools(config: z.infer<typeof draftConfigSchema>, userId: string): Promise<DraftPoolInfo[]> {
    const ids = [...new Set(config.phases.map((p) => p.poolCubeVersionId))];
    const pools = await poolInfo(db, ids);
    const mine = await db.select({ id: schema.cubes.id }).from(schema.cubes).where(eq(schema.cubes.ownerId, userId));
    const shared = await db.select({ id: schema.cubeMembers.cubeId }).from(schema.cubeMembers).where(eq(schema.cubeMembers.userId, userId));
    const allowed = new Set([...mine, ...shared].map((c) => c.id));
    const missing = ids.filter((id) => !pools.some((p) => p.versionId === id && allowed.has(p.cubeId)));
    if (missing.length > 0) throw badRequest('Every phase must draw from a version of one of your cubes, or a cube shared with you');
    return pools;
  }

  const toResponse = async (row: DraftConfigRow, pools: DraftPoolInfo[]): Promise<DraftConfigResponse> => ({
    id: row.id, ownerId: row.ownerId, name: row.name, config: row.config, pools, members: await membersOf(row.id), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  });

  /** Own formats first, then formats shared with the caller. */
  app.get('/draft-configs', async (req): Promise<DraftConfigSummary[]> => {
    const me = req.user!.id;
    const shared = await db.select({ id: schema.draftConfigMembers.configId }).from(schema.draftConfigMembers).where(eq(schema.draftConfigMembers.userId, me));
    const rows = await db
      .select({ row: schema.draftConfigs, ownerName: schema.users.displayName })
      .from(schema.draftConfigs)
      .innerJoin(schema.users, eq(schema.users.id, schema.draftConfigs.ownerId))
      .where(shared.length ? or(eq(schema.draftConfigs.ownerId, me), inArray(schema.draftConfigs.id, shared.map((s) => s.id))) : eq(schema.draftConfigs.ownerId, me))
      .orderBy(desc(schema.draftConfigs.updatedAt));
    return rows
      .map(({ row: r, ownerName }) => ({ id: r.id, name: r.name, ownerId: r.ownerId, ownerName, shared: r.ownerId !== me, seats: r.config.seats, phaseCount: r.config.phases.length, updatedAt: r.updatedAt.toISOString() }))
      .sort((a, b) => Number(a.shared) - Number(b.shared));
  });

  app.get('/draft-configs/:id/members', async (req) => {
    const { id } = parse(idParam, req.params);
    await accessible(id, req.user!.id);
    return { members: await membersOf(id) };
  });

  app.post('/draft-configs/:id/members', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { userId } = parse(memberInput, req.body);
    const row = await owned(id, req.user!.id);
    if (userId === row.ownerId) throw badRequest('You already own this format');
    const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw notFound('User not found');
    await db.insert(schema.draftConfigMembers).values({ configId: id, userId }).onConflictDoNothing();
    return reply.code(201).send({ members: await membersOf(id) });
  });

  app.delete('/draft-configs/:id/members/:userId', async (req) => {
    const { id, userId } = parse(memberParam, req.params);
    await owned(id, req.user!.id);
    await db.delete(schema.draftConfigMembers).where(and(eq(schema.draftConfigMembers.configId, id), eq(schema.draftConfigMembers.userId, userId)));
    return { members: await membersOf(id) };
  });

  app.post('/draft-configs', async (req, reply) => {
    const input = parse(configInput, req.body);
    const pools = await checkPools(input.config, req.user!.id);
    const config = { ...input.config, name: input.name };
    const [row] = await db.insert(schema.draftConfigs).values({ ownerId: req.user!.id, name: input.name, config }).returning();
    return reply.code(201).send(await toResponse(row!, pools));
  });

  app.get('/draft-configs/:id', async (req): Promise<DraftConfigResponse> => {
    const { id } = parse(idParam, req.params);
    const row = await accessible(id, req.user!.id);
    return toResponse(row, await poolInfo(db, row.config.phases.map((p) => p.poolCubeVersionId)));
  });

  app.put('/draft-configs/:id', async (req): Promise<DraftConfigResponse> => {
    const { id } = parse(idParam, req.params);
    await owned(id, req.user!.id);
    const input = parse(configInput, req.body);
    const pools = await checkPools(input.config, req.user!.id);
    const config = { ...input.config, name: input.name };
    const [row] = await db.update(schema.draftConfigs).set({ name: input.name, config, updatedAt: new Date() }).where(eq(schema.draftConfigs.id, id)).returning();
    return toResponse(row!, pools);
  });

  app.delete('/draft-configs/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await owned(id, req.user!.id);
    await db.delete(schema.draftConfigs).where(eq(schema.draftConfigs.id, id));
    return reply.code(204).send();
  });
}
