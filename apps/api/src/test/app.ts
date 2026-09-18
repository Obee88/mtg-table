import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import { testDb } from './db.js';

export const TEST_ORIGIN = 'http://localhost:5173';

export async function testApp(): Promise<{ app: FastifyInstance; close: () => Promise<void> }> {
  const { db, close } = await testDb();
  const config: Config = {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 0,
    DATABASE_URL: 'pglite',
    WEB_ORIGIN: TEST_ORIGIN,
    LOG_LEVEL: 'fatal',
    GIT_SHA: 'test',
    SCRYFALL_INGEST_CRON: '',
  };
  const app = await buildApp(config, db);
  return {
    app,
    close: async () => {
      await app.close();
      await close();
    },
  };
}

/** Extracts the session cookie from a register/login response for reuse. */
export function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'];
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string') throw new Error('no set-cookie header');
  return first.split(';')[0]!;
}
