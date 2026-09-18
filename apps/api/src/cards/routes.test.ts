import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import { sessionCookie, TEST_ORIGIN } from '../test/app.js';
import { fakeSource, rawCard } from '../test/cards.js';
import { testDb } from '../test/db.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let close: () => Promise<void>;

beforeAll(async () => {
  const t = await testDb();
  const config: Config = {
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: 0, DATABASE_URL: 'pglite', WEB_ORIGIN: TEST_ORIGIN,
    LOG_LEVEL: 'fatal', GIT_SHA: 'test', SCRYFALL_INGEST_CRON: '',
  };
  app = await buildApp(config, t.db, { cardSource: fakeSource([rawCard()]) });
  close = async () => {
    await app.close();
    await t.close();
  };
});
afterAll(() => close());

describe('card admin routes', () => {
  it('requires an admin', async () => {
    expect((await app.inject({ url: '/admin/cards/ingest' })).statusCode).toBe(401);
    const admin = await app.inject({
      method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN },
      payload: { email: 'a@x.io', password: 'a-long-enough-password', displayName: 'Admin' },
    });
    const invite = await app.inject({ method: 'POST', url: '/invites', headers: { origin: TEST_ORIGIN, cookie: sessionCookie(admin) }, payload: {} });
    const user = await app.inject({
      method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN },
      payload: { email: 'b@x.io', password: 'a-long-enough-password', displayName: 'Bee', inviteCode: invite.json().code },
    });
    expect((await app.inject({ url: '/admin/cards/ingest', headers: { cookie: sessionCookie(user) } })).statusCode).toBe(403);
  });

  it('admin can trigger and observe an ingest', async () => {
    const login = await app.inject({ method: 'POST', url: '/auth/login', headers: { origin: TEST_ORIGIN }, payload: { email: 'a@x.io', password: 'a-long-enough-password' } });
    const cookie = sessionCookie(login);

    const before = await app.inject({ url: '/admin/cards/ingest', headers: { cookie } });
    expect(before.json()).toEqual({ cardCount: 0, latest: null });

    const start = await app.inject({ method: 'POST', url: '/admin/cards/ingest', headers: { origin: TEST_ORIGIN, cookie }, payload: {} });
    expect(start.statusCode).toBe(202);
    await app.cardIngest.wait();

    const after = await app.inject({ url: '/admin/cards/ingest', headers: { cookie } });
    expect(after.json()).toMatchObject({ cardCount: 1, latest: { status: 'success', processed: 1 } });

    const again = await app.inject({ method: 'POST', url: '/admin/cards/ingest', headers: { origin: TEST_ORIGIN, cookie }, payload: {} });
    expect(again.statusCode).toBe(200);
    expect(again.json().reason).toBe('bulk data unchanged');
  });
});
