import type { FastifyInstance } from 'fastify';
import { forbidden, unauthorized } from '../errors.js';

export async function cardAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (req) => {
    if (!req.user) throw unauthorized();
    if (!req.user.isAdmin) throw forbidden('Admins only');
  });

  app.get('/admin/cards/ingest', async () => app.cardIngest.status());

  app.post<{ Querystring: { force?: string } }>('/admin/cards/ingest', async (req, reply) => {
    const result = await app.cardIngest.start({ force: req.query.force === 'true' });
    return reply.code(result.started ? 202 : 200).send(result);
  });
}
