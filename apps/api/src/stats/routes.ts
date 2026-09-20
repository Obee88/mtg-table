import { computePlayerStats, type PlayerStatsResponse, type ResultRecord } from '@mtg/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getPrintings } from '../cards/search.js';
import { schema } from '../db/index.js';
import { notFound, unauthorized } from '../errors.js';
import { parse } from '../validate.js';

const idParam = z.object({ id: z.uuid() });

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  const { db } = app;

  app.addHook('preHandler', async (req) => {
    if (!req.user) throw unauthorized();
  });

  /** Any signed-in member may look at any player's record (it is a private group). */
  app.get('/players/:id/stats', async (req): Promise<PlayerStatsResponse> => {
    const { id } = parse(idParam, req.params);
    const [player] = await db.select({ id: schema.users.id, displayName: schema.users.displayName }).from(schema.users).where(eq(schema.users.id, id));
    if (!player) throw notFound('Player not found');

    const resultRows = await db.select().from(schema.gameResults).where(sql`${schema.gameResults.players} @> ${JSON.stringify([{ playerId: id }])}::jsonb`);
    const results: ResultRecord[] = resultRows.map((r) => ({
      roomId: r.roomId, gameNumber: r.gameNumber, winners: r.winners, mode: r.mode as ResultRecord['mode'], playerCount: r.playerCount, commander: r.commander,
      draftName: r.draftName, players: r.players, reportedAt: r.reportedAt.toISOString(),
    }));

    // The player's picks, plus everyone's picks of the same cards for the timing comparison.
    const mine = await db.select().from(schema.draftPicks).where(eq(schema.draftPicks.playerId, id));
    const cardIds = [...new Set(mine.map((p) => p.cardId))];
    const others = cardIds.length ? await db.select().from(schema.draftPicks).where(inArray(schema.draftPicks.cardId, cardIds)) : [];
    const seen = new Set<string>();
    const picks = [...mine, ...others]
      .filter((p) => {
        const key = `${p.roomId}:${p.overallPick}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((p) => ({ playerId: p.playerId, roomId: p.roomId, printingId: p.cardId, pickInPack: p.pickInPack, packContents: p.packContents, double: p.doublePick }));
    const printings = await getPrintings(db, cardIds);
    const stats = computePlayerStats(id, results, picks, new Map(printings.map((p) => [p.id, p])));

    const ids = new Set<string>([id, ...stats.headToHead.map((h) => h.opponentId), ...stats.deckHistory.flatMap((d) => [...d.opponents, ...d.teammates])]);
    const users = await db.select({ id: schema.users.id, displayName: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, [...ids]));
    const mostPicked = new Set(stats.draft.mostPicked.map((m) => m.printingId));
    return { player, stats, names: Object.fromEntries(users.map((u) => [u.id, u.displayName])), printings: printings.filter((p) => mostPicked.has(p.id)) };
  });
}
