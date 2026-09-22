import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookie, TEST_ORIGIN, testApp } from '../test/app.js';
import { fakeSource, rawCard } from '../test/cards.js';

let ctx: Awaited<ReturnType<typeof testApp>>;
let cookie: string;
const FALLS = '33333333-3333-4333-8333-333333333301';
const VENTS = '33333333-3333-4333-8333-333333333302';

beforeAll(async () => {
  ctx = await testApp({
    cardSource: fakeSource([
      rawCard(),
      rawCard({ id: FALLS, oracle_id: '44444444-4444-4444-8444-444444444401', name: 'Thornwood Falls', type_line: 'Land', mana_cost: '', oracle_text: 'Thornwood Falls enters tapped.\nWhen Thornwood Falls enters, you gain 1 life.\n{T}: Add {G} or {U}.' }),
      rawCard({ id: VENTS, oracle_id: '44444444-4444-4444-8444-444444444402', name: 'Steam Vents', type_line: 'Land — Island Mountain', mana_cost: '', oracle_text: 'As Steam Vents enters, you may pay 2 life. If you don\'t, it enters tapped.' }),
    ]),
  });
  await ctx.app.cardIngest.start();
  await ctx.app.cardIngest.wait();
  const res = await ctx.app.inject({ method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN }, payload: { email: 'a@x.io', password: 'a-long-enough-password', displayName: 'Ann' } });
  cookie = sessionCookie(res);
});
afterAll(() => ctx.close());

describe('taplands', () => {
  it('suggests unconditional taplands, marks them by name, and serves the flag on printings', async () => {
    const suggest = await ctx.app.inject({ method: 'POST', url: '/cards/taplands/suggest', headers: { cookie, origin: TEST_ORIGIN }, payload: { ids: [FALLS, VENTS, '11111111-1111-4111-8111-111111111111'] } });
    expect(suggest.statusCode).toBe(200);
    expect(suggest.json().suggestions.map((s: { printing: { name: string }; face: string }) => [s.printing.name, s.face])).toEqual([['Thornwood Falls', 'front']]);

    const before = await ctx.app.inject({ method: 'POST', url: '/cards/lookup', headers: { cookie, origin: TEST_ORIGIN }, payload: { ids: [FALLS] } });
    expect(before.json().printings[0].entersTapped).toBeNull();

    const put = await ctx.app.inject({ method: 'PUT', url: '/cards/taplands', headers: { cookie, origin: TEST_ORIGIN }, payload: { name: 'Thornwood Falls', face: 'front' } });
    expect(put.statusCode).toBe(200);
    expect((await ctx.app.inject({ url: '/cards/taplands', headers: { cookie } })).json()).toEqual({ taplands: [{ name: 'Thornwood Falls', face: 'front' }] });
    const after = await ctx.app.inject({ method: 'POST', url: '/cards/lookup', headers: { cookie, origin: TEST_ORIGIN }, payload: { ids: [FALLS] } });
    expect(after.json().printings[0].entersTapped).toBe('front');
    // Marked cards drop out of the suggestions.
    const again = await ctx.app.inject({ method: 'POST', url: '/cards/taplands/suggest', headers: { cookie, origin: TEST_ORIGIN }, payload: { ids: [FALLS] } });
    expect(again.json().suggestions).toEqual([]);

    await ctx.app.inject({ method: 'PUT', url: '/cards/taplands', headers: { cookie, origin: TEST_ORIGIN }, payload: { name: 'Thornwood Falls', face: null } });
    expect((await ctx.app.inject({ url: '/cards/taplands', headers: { cookie } })).json()).toEqual({ taplands: [] });
    expect((await ctx.app.inject({ url: '/cards/taplands' })).statusCode).toBe(401);
  });
});
