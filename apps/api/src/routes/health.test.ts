import { afterAll, beforeAll, expect, it } from 'vitest';
import { testApp } from '../test/app.js';

let ctx: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => (ctx = await testApp()));
afterAll(() => ctx.close());

it('healthz and readyz respond', async () => {
  expect((await ctx.app.inject({ url: '/healthz' })).json()).toEqual({ ok: true });
  expect((await ctx.app.inject({ url: '/readyz' })).json()).toEqual({ ok: true, db: 'up' });
});
