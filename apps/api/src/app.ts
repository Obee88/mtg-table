import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { authRoutes } from './auth/routes.js';
import { findSessionUser, SESSION_COOKIE } from './auth/session.js';
import { CardIngestService } from './cards/ingest.js';
import { cardRoutes } from './cards/public-routes.js';
import { cardAdminRoutes } from './cards/routes.js';
import { scryfallSource, type CardSource } from './cards/scryfall.js';
import type { Config } from './config.js';
import { cubeRoutes } from './cubes/routes.js';
import { deckRoutes } from './decks/routes.js';
import type { Db, UserRow } from './db/index.js';
import { HttpError } from './errors.js';
import { healthRoutes } from './routes/health.js';
import { inviteRoutes } from './routes/invites.js';
import { roomRoutes } from './rooms/routes.js';
import { RoomService } from './rooms/service.js';
import { roomSocketRoutes } from './rooms/ws.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    cardIngest: CardIngestService;
    rooms: RoomService;
  }
  interface FastifyRequest {
    user: UserRow | null;
    sessionToken: string | null;
  }
}

export interface AppDeps {
  /** Card data source; defaults to Scryfall. Tests inject a fake. */
  cardSource?: CardSource;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(config: Config, db: Db, deps: AppDeps = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: true,
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('cardIngest', new CardIngestService(db, deps.cardSource ?? scryfallSource, app.log));
  app.decorate('rooms', new RoomService(db, app.log));
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  await app.register(cors, {
    origin: config.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

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
  await app.register(cardAdminRoutes);
  await app.register(cardRoutes);
  await app.register(deckRoutes);
  await app.register(cubeRoutes);
  await app.register(roomRoutes);
  await app.register(roomSocketRoutes);

  return app;
}
