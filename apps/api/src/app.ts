import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { authRoutes } from './auth/routes.js';
import { findSessionUser, SESSION_COOKIE } from './auth/session.js';
import type { Config } from './config.js';
import type { Db, UserRow } from './db/index.js';
import { HttpError } from './errors.js';
import { healthRoutes } from './routes/health.js';
import { inviteRoutes } from './routes/invites.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
  }
  interface FastifyRequest {
    user: UserRow | null;
    sessionToken: string | null;
  }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(config: Config, db: Db): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);

  // CSRF: browsers always send Origin on cross-site mutating requests.
  app.addHook('onRequest', async (req) => {
    if (!MUTATING.has(req.method)) return;
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== config.WEB_ORIGIN) {
      throw new HttpError(403, 'bad_origin', 'Request origin not allowed');
    }
  });

  app.addHook('preHandler', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    req.sessionToken = token;
    req.user = await findSessionUser(db, token);
  });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
      return reply.code(500).send({ error: 'internal', message: 'Internal error' });
    }
    const message = err instanceof Error ? err.message : 'Bad request';
    return reply.code(status).send({ error: 'bad_request', message });
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(inviteRoutes);

  return app;
}
