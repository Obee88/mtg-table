import { draftConfigSchema, type DraftConfigResponse, type DraftConfigSummary, type DraftPoolInfo } from '@mtg/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schema, type Db, type DraftConfigRow } from '../db/index.js';
import { badRequest, notFound, unauthorized } from '../errors.js';
import { parse } from '../validate.js';

const configInput = z.object({ name: z.string().trim().min(1).max(80), config: draftConfigSchema });
const idParam = z.object({ id: z.uuid() });

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

  /** Every pool must be a version of one of the caller's cubes. */
  async function checkPools(config: z.infer<typeof draftConfigSchema>, userId: string): Promise<DraftPoolInfo[]> {
    const ids = [...new Set(config.phases.map((p) => p.poolCubeVersionId))];
    const pools = await poolInfo(db, ids);
    const mine = await db.select({ id: schema.cubes.id }).from(schema.cubes).where(eq(schema.cubes.ownerId, userId));
    const missing = ids.filter((id) => !pools.some((p) => p.versionId === id && mine.some((c) => c.id === p.cubeId)));
    if (missing.length > 0) throw badRequest('Every phase must draw from a version of one of your cubes');
    return pools;
  }

  const toResponse = (row: DraftConfigRow, pools: DraftPoolInfo[]): DraftConfigResponse => ({
    id: row.id, ownerId: row.ownerId, name: row.name, config: row.config, pools, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  });

  app.get('/draft-configs', async (req): Promise<DraftConfigSummary[]> => {
    const rows = await db.select().from(schema.draftConfigs).where(eq(schema.draftConfigs.ownerId, req.user!.id)).orderBy(desc(schema.draftConfigs.updatedAt));
    return rows.map((r) => ({ id: r.id, name: r.name, seats: r.config.seats, phaseCount: r.config.phases.length, updatedAt: r.updatedAt.toISOString() }));
  });

  app.post('/draft-configs', async (req, reply) => {
    const input = parse(configInput, req.body);
    const pools = await checkPools(input.config, req.user!.id);
    const config = { ...input.config, name: input.name };
    const [row] = await db.insert(schema.draftConfigs).values({ ownerId: req.user!.id, name: input.name, config }).returning();
    return reply.code(201).send(toResponse(row!, pools));
  });

  app.get('/draft-configs/:id', async (req): Promise<DraftConfigResponse> => {
    const { id } = parse(idParam, req.params);
    const row = await owned(id, req.user!.id);
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
