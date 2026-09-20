import { gameCommandSchema, projectEvents, projectState, roomSettingsSchema, type DraftPickSummary, type RoomListItem, type RoomState } from '@mtg/shared';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schema } from '../db/index.js';
import { badRequest, unauthorized } from '../errors.js';
import { parse } from '../validate.js';

const idParam = z.object({ id: z.uuid() });
const createInput = z.object({ settings: roomSettingsSchema });
const sinceQuery = z.object({ after: z.coerce.number().int().min(0).default(0) });


export async function roomRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;

  app.addHook('preHandler', async (req) => {
    if (!req.user) throw unauthorized();
  });

  const actor = (req: { user: { id: string; displayName: string } | null }) => ({ id: req.user!.id, displayName: req.user!.displayName });

  app.post('/rooms', async (req, reply) => {
    const { settings } = parse(createInput, req.body);
    const state = await app.rooms.create(actor(req), settings);
    return reply.code(201).send(state);
  });

  /** Rooms the caller is seated in, plus open lobbies. */
  app.get('/rooms', async (req): Promise<RoomListItem[]> => {
    const mine = await db.select({ roomId: schema.roomPlayers.roomId }).from(schema.roomPlayers).where(eq(schema.roomPlayers.userId, req.user!.id));
    const rows = await db
      .select()
      .from(schema.rooms)
      .where(mine.length ? inArray(schema.rooms.id, mine.map((m) => m.roomId)) : eq(schema.rooms.phase, 'lobby'))
      .orderBy(desc(schema.rooms.updatedAt))
      .limit(50);
    const open = mine.length ? await db.select().from(schema.rooms).where(eq(schema.rooms.phase, 'lobby')).orderBy(desc(schema.rooms.updatedAt)).limit(50) : [];
    // Finished rooms drop out of the list; open lobbies are visible to everyone.
    const all = [...rows.filter((r) => r.phase !== 'ended'), ...open.filter((o) => !rows.some((r) => r.id === o.id))];
    const counts = all.length
      ? await db.select({ roomId: schema.roomPlayers.roomId }).from(schema.roomPlayers).where(inArray(schema.roomPlayers.roomId, all.map((r) => r.id)))
      : [];
    return all.map((r) => ({
      id: r.id,
      phase: r.phase,
      settings: r.settings,
      ownerId: r.ownerId,
      playerCount: counts.filter((c) => c.roomId === r.id).length,
      createdAt: r.createdAt.toISOString(),
    }));
  });

  app.get('/rooms/:id', async (req): Promise<RoomState> => {
    const { id } = parse(idParam, req.params);
    return projectState(await app.rooms.get(id), req.user!.id);
  });

  app.get('/rooms/:id/events', async (req) => {
    const { id } = parse(idParam, req.params);
    const { after } = parse(sinceQuery, req.query);
    const base = await app.rooms.stateAt(id, after);
    return projectEvents(await app.rooms.eventsSince(id, after), req.user!.id, base);
  });

  /** The full pick log of a finished draft, for everyone who drafted; hidden while picks are still secret. */
  app.get('/rooms/:id/draft/picks', async (req): Promise<DraftPickSummary[]> => {
    const { id } = parse(idParam, req.params);
    const state = await app.rooms.get(id);
    if (!state.players[req.user!.id]) throw badRequest('Not in the room');
    if (state.draft?.status !== 'finished') throw badRequest('The draft is not over yet');
    const rows = await db.select().from(schema.draftPicks).where(eq(schema.draftPicks.roomId, id)).orderBy(asc(schema.draftPicks.overallPick));
    return rows.map((r) => ({ n: r.overallPick, playerId: r.playerId, printingId: r.cardId, phase: r.phase, round: r.round, packId: r.packId, pickInPack: r.pickInPack, packContents: r.packContents, double: r.doublePick }));
  });

  app.post('/rooms/:id/commands', async (req) => {
    const { id } = parse(idParam, req.params);
    const command = parse(gameCommandSchema, req.body);
    const result = await app.rooms.dispatch(id, actor(req), command);
    if (!result.ok) throw badRequest(result.error);
    return { events: projectEvents(result.events, req.user!.id, result.before), state: projectState(result.state, req.user!.id) };
  });
}
