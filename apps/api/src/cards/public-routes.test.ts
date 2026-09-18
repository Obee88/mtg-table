import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookie, TEST_ORIGIN, testApp } from '../test/app.js';
import { fakeSource, rawCard } from '../test/cards.js';

let ctx: Awaited<ReturnType<typeof testApp>>;
let cookie: string;

beforeAll(async () => {
  ctx = await testApp({ cardSource: fakeSource([rawCard()]) });
  await ctx.app.cardIngest.start();
  await ctx.app.cardIngest.wait();
  const res = await ctx.app.inject({
    method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN },
    payload: { email: 'a@x.io', password: 'a-long-enough-password', displayName: 'Ann' },
  });
  cookie = sessionCookie(res);
});
afterAll(() => ctx.close());

describe('card routes', () => {
  it('require a session', async () => {
    expect((await ctx.app.inject({ url: '/cards/search?q=bolt' })).statusCode).toBe(401);
  });

  it('search, printings and single printing', async () => {
    const search = await ctx.app.inject({ url: '/cards/search?q=bolt', headers: { cookie } });
    expect(search.statusCode).toBe(200);
    expect(search.json().results).toHaveLength(1);
    const { id, oracleId } = search.json().results[0];

    const printings = await ctx.app.inject({ url: `/cards/oracle/${oracleId}/printings`, headers: { cookie } });
    expect(printings.json().printings.map((p: { id: string }) => p.id)).toEqual([id]);

    expect((await ctx.app.inject({ url: `/cards/${id}`, headers: { cookie } })).json().name).toBe('Lightning Bolt');
    expect((await ctx.app.inject({ url: '/cards/00000000-0000-4000-8000-000000000000', headers: { cookie } })).statusCode).toBe(404);
  });

  it('validates the query', async () => {
    expect((await ctx.app.inject({ url: '/cards/search', headers: { cookie } })).statusCode).toBe(400);
    expect((await ctx.app.inject({ url: '/cards/search?q=bolt&limit=999', headers: { cookie } })).statusCode).toBe(400);
    expect((await ctx.app.inject({ url: '/cards/not-a-uuid', headers: { cookie } })).statusCode).toBe(400);
  });
});
