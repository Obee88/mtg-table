import { gameCommandSchema, roomSettingsSchema, type RoomState } from '@mtg/shared';
import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { schema } from '../db/index.js';
import { badRequest, unauthorized } from '../errors.js';
import { parse } from '../validate.js';

const idParam = z.object({ id: z.uuid() });
const createInput = z.object({ settings: roomSettingsSchema });
const sinceQuery = z.object({ after: z.coerce.number().int().min(0).default(0) });

export interface RoomListItem {
  id: string;
  phase: RoomState['phase'];
  settings: RoomState['settings'];
  ownerId: string;
  playerCount: number;
  createdAt: string;
}

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
    const all = [...rows, ...open.filter((o) => !rows.some((r) => r.id === o.id))];
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
    return app.rooms.get(id);
  });

  app.get('/rooms/:id/events', async (req) => {
    const { id } = parse(idParam, req.params);
    const { after } = parse(sinceQuery, req.query);
    await app.rooms.get(id); // 404 if unknown
    return app.rooms.eventsSince(id, after);
  });

  app.post('/rooms/:id/commands', async (req) => {
    const { id } = parse(idParam, req.params);
    const command = parse(gameCommandSchema, req.body);
    const result = await app.rooms.dispatch(id, actor(req), command);
    if (!result.ok) throw badRequest(result.error);
    return { events: result.events, state: result.state };
  });
}
