import { diffCubeVersions, type CubeCard, type CubeDiffResponse, type CubeResponse, type CubeSummary, type CubeVersionSummary } from '@mtg/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { importCubeCobra } from './cubecobra.js';
import { getPrintings } from '../cards/search.js';
import { schema, type CubeRow, type CubeVersionRow, type Db } from '../db/index.js';
import { badRequest, notFound, unauthorized } from '../errors.js';
import { parse } from '../validate.js';

const MAX_CARDS = 5000;
const cubeCard = z.object({ printingId: z.uuid(), quantity: z.number().int().min(1).max(99) });
const cardsInput = z.array(cubeCard).max(MAX_CARDS);
const createInput = z.object({ name: z.string().trim().min(1).max(80), cards: cardsInput, note: z.string().trim().max(200).optional() });
const versionInput = z.object({ cards: cardsInput, note: z.string().trim().max(200).optional() });
const renameInput = z.object({ name: z.string().trim().min(1).max(80) });
const idParam = z.object({ id: z.uuid() });
const versionQuery = z.object({ version: z.coerce.number().int().min(1).optional() });
const cobraInput = z.object({ ref: z.string().trim().min(1).max(300) });
const diffQuery = z.object({ from: z.coerce.number().int().min(1).optional(), to: z.coerce.number().int().min(1).optional() });
const restoreInput = z.object({ version: z.number().int().min(1) });

const count = (cards: { quantity: number }[]) => cards.reduce((n, c) => n + c.quantity, 0);

/** Merges duplicate printings and checks they exist. */
async function normalize(db: Db, input: CubeCard[]): Promise<CubeCard[]> {
  const merged = new Map<string, number>();
  for (const c of input) merged.set(c.printingId, (merged.get(c.printingId) ?? 0) + c.quantity);
  const cards = [...merged].map(([printingId, quantity]) => ({ printingId, quantity }));
  if (count(cards) > MAX_CARDS) throw badRequest(`A cube may hold at most ${MAX_CARDS} cards`);
  const ids = cards.map((c) => c.printingId);
  const rows = ids.length ? await db.select({ id: schema.cards.id }).from(schema.cards).where(inArray(schema.cards.id, ids)) : [];
  const missing = ids.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length > 0) throw badRequest(`Unknown printing ids: ${missing.join(', ')}`);
  return cards;
}

export async function cubeRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;

  app.addHook('preHandler', async (req) => {
    if (!req.user) throw unauthorized();
  });

  async function ownedCube(id: string, userId: string): Promise<CubeRow> {
    const [row] = await db.select().from(schema.cubes).where(and(eq(schema.cubes.id, id), eq(schema.cubes.ownerId, userId)));
    if (!row) throw notFound('Cube not found');
    return row;
  }

  async function versionSummaries(cubeId: string): Promise<CubeVersionSummary[]> {
    const rows = await db
      .select({
        v: schema.cubeVersions,
        createdByName: schema.users.displayName,
        cardCount: sql<number>`coalesce((select sum(${schema.cubeVersionCards.quantity}) from ${schema.cubeVersionCards} where ${schema.cubeVersionCards.versionId} = ${schema.cubeVersions.id}), 0)::int`,
      })
      .from(schema.cubeVersions)
      .innerJoin(schema.users, eq(schema.users.id, schema.cubeVersions.createdBy))
      .where(eq(schema.cubeVersions.cubeId, cubeId))
      .orderBy(desc(schema.cubeVersions.number));
    return rows.map((r) => ({ id: r.v.id, number: r.v.number, note: r.v.note, createdBy: r.v.createdBy, createdByName: r.createdByName, cardCount: r.cardCount, createdAt: r.v.createdAt.toISOString() }));
  }

  async function addVersion(cube: CubeRow, userId: string, cards: CubeCard[], note: string | undefined): Promise<CubeVersionRow> {
    return db.transaction(async (tx) => {
      const [last] = await tx.select({ n: sql<number>`coalesce(max(${schema.cubeVersions.number}), 0)::int` }).from(schema.cubeVersions).where(eq(schema.cubeVersions.cubeId, cube.id));
      const [version] = await tx.insert(schema.cubeVersions).values({ cubeId: cube.id, number: (last?.n ?? 0) + 1, note: note ?? null, createdBy: userId }).returning();
      if (cards.length) await tx.insert(schema.cubeVersionCards).values(cards.map((c) => ({ versionId: version!.id, cardId: c.printingId, quantity: c.quantity })));
      await tx.update(schema.cubes).set({ updatedAt: new Date() }).where(eq(schema.cubes.id, cube.id));
      return version!;
    });
  }

  async function respond(cube: CubeRow, versionNumber?: number): Promise<CubeResponse> {
    const versions = await versionSummaries(cube.id);
    const shown = versionNumber ? versions.find((v) => v.number === versionNumber) : versions[0];
    if (!shown) throw notFound('Version not found');
    const rows = await db.select().from(schema.cubeVersionCards).where(eq(schema.cubeVersionCards.versionId, shown.id));
    const cards = rows.map((r) => ({ printingId: r.cardId, quantity: r.quantity }));
    return {
      cube: { id: cube.id, name: cube.name, ownerId: cube.ownerId, createdAt: cube.createdAt.toISOString(), updatedAt: cube.updatedAt.toISOString() },
      version: { ...shown, cards },
      versions,
      printings: await getPrintings(db, cards.map((c) => c.printingId)),
    };
  }

  /** Fetches a Cube Cobra cube and returns it as a reviewable list (not saved). */
  app.post('/cubes/import/cubecobra', async (req) => {
    const { ref } = parse(cobraInput, req.body);
    return importCubeCobra(db, ref, app.cubeCobraFetch);
  });

  app.get('/cubes', async (req): Promise<CubeSummary[]> => {
    const rows = await db.select().from(schema.cubes).where(eq(schema.cubes.ownerId, req.user!.id)).orderBy(desc(schema.cubes.updatedAt));
    const out: CubeSummary[] = [];
    for (const cube of rows) {
      const [latest] = await versionSummaries(cube.id);
      out.push({ id: cube.id, name: cube.name, latestVersion: latest?.number ?? 0, cardCount: latest?.cardCount ?? 0, updatedAt: cube.updatedAt.toISOString() });
    }
    return out;
  });

  app.post('/cubes', async (req, reply) => {
    const input = parse(createInput, req.body);
    const cards = await normalize(db, input.cards);
    const [cube] = await db.insert(schema.cubes).values({ ownerId: req.user!.id, name: input.name }).returning();
    await addVersion(cube!, req.user!.id, cards, input.note ?? 'Initial list');
    return reply.code(201).send(await respond(cube!));
  });

  app.get('/cubes/:id', async (req): Promise<CubeResponse> => {
    const { id } = parse(idParam, req.params);
    const { version } = parse(versionQuery, req.query);
    return respond(await ownedCube(id, req.user!.id), version);
  });

  app.put('/cubes/:id', async (req): Promise<CubeResponse> => {
    const { id } = parse(idParam, req.params);
    const cube = await ownedCube(id, req.user!.id);
    const { name } = parse(renameInput, req.body);
    const [updated] = await db.update(schema.cubes).set({ name, updatedAt: new Date() }).where(eq(schema.cubes.id, cube.id)).returning();
    return respond(updated!);
  });

  app.post('/cubes/:id/versions', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const cube = await ownedCube(id, req.user!.id);
    const input = parse(versionInput, req.body);
    const cards = await normalize(db, input.cards);
    await addVersion(cube, req.user!.id, cards, input.note);
    return reply.code(201).send(await respond(cube));
  });

  /** Diff two versions (defaults: previous → latest). */
  app.get('/cubes/:id/diff', async (req): Promise<CubeDiffResponse> => {
    const { id } = parse(idParam, req.params);
    const q = parse(diffQuery, req.query);
    const cube = await ownedCube(id, req.user!.id);
    const versions = await versionSummaries(cube.id);
    const to = q.to ? versions.find((v) => v.number === q.to) : versions[0];
    const from = q.from ? versions.find((v) => v.number === q.from) : versions.find((v) => v.number === (to?.number ?? 0) - 1) ?? to;
    if (!from || !to) throw notFound('Version not found');
    const load = async (versionId: string) => (await db.select().from(schema.cubeVersionCards).where(eq(schema.cubeVersionCards.versionId, versionId))).map((r) => ({ printingId: r.cardId, quantity: r.quantity }));
    const [a, b] = await Promise.all([load(from.id), load(to.id)]);
    const printings = new Map((await getPrintings(db, [...a, ...b].map((c) => c.printingId))).map((p) => [p.id, p]));
    return { from, to, ...diffCubeVersions(a, b, printings) };
  });

  /** Restore an older version: a new version with its exact list. */
  app.post('/cubes/:id/restore', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { version } = parse(restoreInput, req.body);
    const cube = await ownedCube(id, req.user!.id);
    const versions = await versionSummaries(cube.id);
    const target = versions.find((v) => v.number === version);
    if (!target) throw notFound('Version not found');
    const cards = (await db.select().from(schema.cubeVersionCards).where(eq(schema.cubeVersionCards.versionId, target.id))).map((r) => ({ printingId: r.cardId, quantity: r.quantity }));
    await addVersion(cube, req.user!.id, cards, `Restored v${target.number}`);
    return reply.code(201).send(await respond(cube));
  });

  app.delete('/cubes/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    await ownedCube(id, req.user!.id);
    await db.delete(schema.cubes).where(eq(schema.cubes.id, id));
    return reply.code(204).send();
  });
}
