import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness: 200 as soon as the process serves HTTP. Used by the Docker HEALTHCHECK.
  app.get('/healthz', async () => ({ ok: true, sha: app.config.GIT_SHA }));

  // Readiness: also proves the database is reachable.
  app.get('/readyz', async (req, reply) => {
    try {
      await app.db.execute(sql`select 1`);
      return { ok: true, db: 'up' };
    } catch (err) {
      req.log.warn({ err }, 'readiness check failed');
      return reply.code(503).send({ ok: false, db: 'down' });
    }
  });
}
