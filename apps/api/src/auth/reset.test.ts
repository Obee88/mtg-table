import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookie, TEST_ORIGIN, testApp } from '../test/app.js';

let app: FastifyInstance;
let close: () => Promise<void>;
beforeAll(async () => ({ app, close } = await testApp()));
afterAll(() => close());

const post = (url: string, payload: object, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'POST', url, payload, headers: { origin: TEST_ORIGIN, ...headers } });

describe('password reset', () => {
  it('a player asks, the admin issues a one-time link, the player sets a new password and old sessions die', async () => {
    const admin = sessionCookie(await post('/auth/register', { email: 'admin@x.io', password: 'admin-password', displayName: 'Admin' }));
    const invite = (await post('/invites', {}, { cookie: admin })).json().code;
    const bobFirst = await post('/auth/register', { email: 'bob@x.io', password: 'old-password', displayName: 'Bob', inviteCode: invite });
    const bobOld = sessionCookie(bobFirst);

    // Asking never says whether the account exists.
    expect((await post('/auth/forgot', { email: 'bob@x.io' })).statusCode).toBe(202);
    expect((await post('/auth/forgot', { email: 'nobody@x.io' })).statusCode).toBe(202);
    const asked = await app.inject({ url: '/admin/password-resets', headers: { cookie: admin } });
    expect(asked.json()).toEqual([expect.objectContaining({ email: 'bob@x.io', displayName: 'Bob', link: null, usedAt: null })]);
    expect((await app.inject({ url: '/admin/password-resets', headers: { cookie: bobOld } })).statusCode).toBe(403);

    // The admin issues the link (fulfilling Bob's request), and hands it over out of band.
    expect((await post('/admin/password-resets', { email: 'ghost@x.io' }, { cookie: admin })).statusCode).toBe(404);
    const issued = await post('/admin/password-resets', { email: 'bob@x.io' }, { cookie: admin });
    expect(issued.statusCode).toBe(201);
    const link = issued.json().link as string;
    const token = new URL(link).searchParams.get('token')!;
    expect((await app.inject({ url: '/admin/password-resets', headers: { cookie: admin } })).json()).toHaveLength(1); // same request, now issued

    expect((await app.inject({ url: `/auth/reset/${token}` })).json()).toEqual({ displayName: 'Bob' });
    expect((await app.inject({ url: '/auth/reset/not-a-real-token-at-all' })).statusCode).toBe(404);

    const reset = await post('/auth/reset', { token, password: 'new-password' });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toMatchObject({ email: 'bob@x.io' });
    const bobNew = sessionCookie(reset);
    expect((await app.inject({ url: '/me', headers: { cookie: bobNew } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/me', headers: { cookie: bobOld } })).statusCode).toBe(401); // signed out everywhere else
    expect((await post('/auth/login', { email: 'bob@x.io', password: 'old-password' })).statusCode).toBe(401);
    expect((await post('/auth/login', { email: 'bob@x.io', password: 'new-password' })).statusCode).toBe(200);
    // One-time.
    expect((await post('/auth/reset', { token, password: 'another-one' })).statusCode).toBe(400);
    expect((await post('/auth/reset', { token, password: 'short' })).statusCode).toBe(400);
  });
});

describe('change password', () => {
  it('needs the current password, keeps this session and drops the others', async () => {
    const invite = (await post('/invites', {}, { cookie: sessionCookie(await post('/auth/login', { email: 'admin@x.io', password: 'admin-password' })) })).json().code;
    const carolA = sessionCookie(await post('/auth/register', { email: 'carol@x.io', password: 'first-password', displayName: 'Carol', inviteCode: invite }));
    const carolB = sessionCookie(await post('/auth/login', { email: 'carol@x.io', password: 'first-password' }));
    expect((await post('/auth/password', { current: 'wrong', next: 'second-password' }, { cookie: carolA })).statusCode).toBe(400);
    expect((await post('/auth/password', { current: 'first-password', next: 'second-password' }, { cookie: carolA })).statusCode).toBe(204);
    expect((await app.inject({ url: '/me', headers: { cookie: carolA } })).statusCode).toBe(200);
    expect((await app.inject({ url: '/me', headers: { cookie: carolB } })).statusCode).toBe(401);
    expect((await post('/auth/login', { email: 'carol@x.io', password: 'second-password' })).statusCode).toBe(200);
    expect((await post('/auth/password', { current: 'x', next: 'y-long-enough' })).statusCode).toBe(401);
  });
});
