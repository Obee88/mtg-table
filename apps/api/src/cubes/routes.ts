import { computeCardStats, computeCardWinRates, diffCubeVersions, type CubeCard, type CubeDiffResponse, type CubeResponse, type CubeStatsResponse, type CubeSummary, type CubeVersionSummary } from '@mtg/shared';
import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
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
const membershipInput = z.object({ accept: z.boolean() });
const restoreInput = z.object({ version: z.number().int().min(1) });
const memberInput = z.object({ userId: z.uuid() });
const memberParam = z.object({ id: z.uuid(), userId: z.uuid() });
const statsQuery = z.object({ version: z.coerce.number().int().min(1).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional(), type: z.string().max(20).optional() });

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

  /** A cube the caller owns or was given access to (read-only for members). */
  async function accessibleCube(id: string, userId: string): Promise<CubeRow> {
    const [row] = await db.select().from(schema.cubes).where(eq(schema.cubes.id, id));
    if (!row) throw notFound('Cube not found');
    // The owner deleted it: gone for them; members still see it, to copy it or let it go.
    if (row.ownerId === userId) {
      if (row.deletedAt) throw notFound('Cube not found');
      return row;
    }
    const [member] = await db.select().from(schema.cubeMembers).where(and(eq(schema.cubeMembers.cubeId, id), eq(schema.cubeMembers.userId, userId), eq(schema.cubeMembers.status, 'accepted')));
    if (!member) throw notFound('Cube not found');
    return row;
  }

  async function membersOf(cubeId: string): Promise<{ id: string; displayName: string; status: 'pending' | 'accepted' }[]> {
    return db
      .select({ id: schema.users.id, displayName: schema.users.displayName, status: schema.cubeMembers.status })
      .from(schema.cubeMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.cubeMembers.userId))
      .where(eq(schema.cubeMembers.cubeId, cubeId))
      .orderBy(asc(schema.users.displayName));
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
      cube: { id: cube.id, name: cube.name, ownerId: cube.ownerId, deletedByOwner: !!cube.deletedAt, createdAt: cube.createdAt.toISOString(), updatedAt: cube.updatedAt.toISOString() },
      members: await membersOf(cube.id),
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

  /** Own cubes first, then cubes shared with the caller. */
  app.get('/cubes', async (req): Promise<CubeSummary[]> => {
    const me = req.user!.id;
    const shared = await db.select({ id: schema.cubeMembers.cubeId, status: schema.cubeMembers.status }).from(schema.cubeMembers).where(eq(schema.cubeMembers.userId, me));
    const statusOf = new Map(shared.map((s) => [s.id, s.status]));
    const rows = await db
      .select({ cube: schema.cubes, ownerName: schema.users.displayName })
      .from(schema.cubes)
      .innerJoin(schema.users, eq(schema.users.id, schema.cubes.ownerId))
      .where(shared.length ? or(eq(schema.cubes.ownerId, me), inArray(schema.cubes.id, shared.map((s) => s.id))) : eq(schema.cubes.ownerId, me))
      .orderBy(desc(schema.cubes.updatedAt));
    const out: CubeSummary[] = [];
    for (const { cube, ownerName } of rows) {
      // A cube the owner deleted stays only for the members it was shared with.
      if (cube.deletedAt && cube.ownerId === me) continue;
      const [latest] = await versionSummaries(cube.id);
      const members = await membersOf(cube.id);
      const membership = cube.ownerId === me ? 'owner' : statusOf.get(cube.id) === 'accepted' ? 'member' : 'invited';
      out.push({
        id: cube.id, name: cube.name, ownerId: cube.ownerId, ownerName, shared: cube.ownerId !== me, membership, latestVersion: latest?.number ?? 0, latestVersionId: latest?.id ?? null, cardCount: latest?.cardCount ?? 0,
        memberCount: members.filter((m) => m.status === 'accepted').length, deletedByOwner: !!cube.deletedAt, updatedAt: cube.updatedAt.toISOString(),
      });
    }
    // Invitations first, then own cubes, then the rest.
    return out.sort((a, b) => Number(a.membership === 'member') - Number(b.membership === 'member') || Number(a.membership === 'owner') - Number(b.membership === 'owner'));
  });

  /** Who may draft with this cube besides the owner. */
  app.get('/cubes/:id/members', async (req) => {
    const { id } = parse(idParam, req.params);
    await accessibleCube(id, req.user!.id);
    return { members: await membersOf(id) };
  });

  app.post('/cubes/:id/members', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { userId } = parse(memberInput, req.body);
    const cube = await ownedCube(id, req.user!.id);
    if (userId === cube.ownerId) throw badRequest('You already own this cube');
    const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId));
    if (!user) throw notFound('User not found');
    // An offer: the player sees it in their cube list and accepts or rejects it.
    await db.insert(schema.cubeMembers).values({ cubeId: id, userId, status: 'pending' }).onConflictDoNothing();
    return reply.code(201).send({ members: await membersOf(id) });
  });

  /** The invited player's answer: accept (the cube joins their list) or reject (the offer disappears). */
  app.post('/cubes/:id/membership', async (req) => {
    const { id } = parse(idParam, req.params);
    const { accept } = parse(membershipInput, req.body);
    const me = req.user!.id;
    const [member] = await db.select().from(schema.cubeMembers).where(and(eq(schema.cubeMembers.cubeId, id), eq(schema.cubeMembers.userId, me)));
    if (!member) throw notFound('No such invitation');
    if (accept) await db.update(schema.cubeMembers).set({ status: 'accepted' }).where(and(eq(schema.cubeMembers.cubeId, id), eq(schema.cubeMembers.userId, me)));
    else await db.delete(schema.cubeMembers).where(and(eq(schema.cubeMembers.cubeId, id), eq(schema.cubeMembers.userId, me)));
    return { accepted: accept };
  });

  app.delete('/cubes/:id/members/:userId', async (req) => {
    const { id, userId } = parse(memberParam, req.params);
    await ownedCube(id, req.user!.id);
    await db.delete(schema.cubeMembers).where(and(eq(schema.cubeMembers.cubeId, id), eq(schema.cubeMembers.userId, userId)));
    return { members: await membersOf(id) };
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
    return respond(await accessibleCube(id, req.user!.id), version);
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
  /** Per-card draft statistics over every version (or one), optionally within a date range. */
  app.get('/cubes/:id/stats', async (req): Promise<CubeStatsResponse> => {
    const { id } = parse(idParam, req.params);
    const { version, from, to, type: wanted } = parse(statsQuery, req.query);
    const cube = await accessibleCube(id, req.user!.id);
    const all = await versionSummaries(cube.id);
    const versions = version ? all.filter((v) => v.number === version) : all;
    if (version && versions.length === 0) throw notFound('Version not found');
    const conditions = [inArray(schema.draftPicks.cubeVersionId, versions.map((v) => v.id))];
    if (from) conditions.push(gte(schema.draftPicks.createdAt, from));
    if (to) conditions.push(lte(schema.draftPicks.createdAt, to));
    const allPicks = versions.length ? await db.select().from(schema.draftPicks).where(and(...conditions)) : [];
    // A pick position means something different in every draft type, so the numbers are read per type.
    const types = [...new Set(allPicks.map((r) => r.phaseType ?? 'unknown'))].map((t) => ({ type: t, picks: allPicks.filter((r) => (r.phaseType ?? 'unknown') === t).length })).sort((a, b) => b.picks - a.picks);
    const type = wanted ?? types[0]?.type ?? 'all';
    const rows = type === 'all' ? allPicks : allPicks.filter((r) => (r.phaseType ?? 'unknown') === type);
    const stats = computeCardStats(rows.map((r) => ({ printingId: r.cardId, pickInPack: r.pickInPack, packContents: r.packContents, double: r.doublePick })));
    // Win rates come from the games played in the rooms that drafted this cube.
    const roomIds = [...new Set(rows.map((r) => r.roomId))];
    const results = roomIds.length ? await db.select().from(schema.gameResults).where(inArray(schema.gameResults.roomId, roomIds)) : [];
    const records = computeCardWinRates(results.map((g) => ({
      roomId: g.roomId, gameNumber: g.gameNumber, winners: g.winners, mode: g.mode as '1v1' | 'ffa' | '2v2', playerCount: g.playerCount,
      commander: g.commander, draftName: g.draftName, players: g.players, reportedAt: g.reportedAt.toISOString(),
    })));
    return {
      cube: { id: cube.id, name: cube.name },
      versions,
      drafts: roomIds.length,
      picks: rows.length,
      type,
      types,
      stats,
      records,
      games: results.length,
      printings: await getPrintings(db, [...new Set([...stats.map((s) => s.printingId), ...records.map((r) => r.printingId)])]),
    };
  });

  app.get('/cubes/:id/diff', async (req): Promise<CubeDiffResponse> => {
    const { id } = parse(idParam, req.params);
    const q = parse(diffQuery, req.query);
    const cube = await accessibleCube(id, req.user!.id);
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

  /**
   * Delete means different things: the owner removes the cube for good if
   * nobody else has it, else marks it deleted and leaves it to the members;
   * a member just stops seeing it. The last member to let go of a deleted
   * cube takes it with them.
   */
  app.delete('/cubes/:id', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const me = req.user!.id;
    const [row] = await db.select().from(schema.cubes).where(eq(schema.cubes.id, id));
    if (!row) throw notFound('Cube not found');
    if (row.ownerId === me) {
      if (row.deletedAt) throw notFound('Cube not found');
      const members = await membersOf(id);
      if (members.length === 0) await db.delete(schema.cubes).where(eq(schema.cubes.id, id));
      else await db.update(schema.cubes).set({ deletedAt: new Date() }).where(eq(schema.cubes.id, id));
      return reply.code(204).send();
    }
    const [member] = await db.select().from(schema.cubeMembers).where(and(eq(schema.cubeMembers.cubeId, id), eq(schema.cubeMembers.userId, me)));
    if (!member) throw notFound('Cube not found');
    await letGo(row, me);
    return reply.code(204).send();
  });

  /** A member stops sharing a cube; a cube its owner already deleted goes for good once nobody has it. */
  async function letGo(cube: CubeRow, userId: string): Promise<void> {
    await db.delete(schema.cubeMembers).where(and(eq(schema.cubeMembers.cubeId, cube.id), eq(schema.cubeMembers.userId, userId)));
    if (cube.deletedAt && (await membersOf(cube.id)).length === 0) await db.delete(schema.cubes).where(eq(schema.cubes.id, cube.id));
  }

  /** A copy of the latest version as a new cube of the caller's. A member copying a cube its owner deleted lets the original go. */
  app.post('/cubes/:id/copy', async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const me = req.user!.id;
    const source = await accessibleCube(id, me);
    const [latest] = await versionSummaries(source.id);
    if (!latest) throw badRequest('This cube has no version to copy');
    const rows = await db.select().from(schema.cubeVersionCards).where(eq(schema.cubeVersionCards.versionId, latest.id));
    const [cube] = await db.insert(schema.cubes).values({ ownerId: me, name: `${source.name} (copy)` }).returning();
    await addVersion(cube!, me, rows.map((r) => ({ printingId: r.cardId, quantity: r.quantity })), `Copied from ${source.name} v${latest.number}`);
    if (source.ownerId !== me && source.deletedAt) await letGo(source, me);
    return reply.code(201).send(await respond(cube!));
  });
}
