import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionCookie, TEST_ORIGIN, testApp } from '../test/app.js';

let app: FastifyInstance;
let close: () => Promise<void>;

beforeAll(async () => ({ app, close } = await testApp()));
afterAll(() => close());

const post = (url: string, payload: object, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> =>
  app.inject({ method: 'POST', url, payload, headers: { origin: TEST_ORIGIN, ...headers } });

describe('auth', () => {
  let adminCookie: string;
  let inviteCode: string;

  it('first registration needs no invite and becomes admin', async () => {
    const res = await post('/auth/register', {
      email: 'Admin@Example.com',
      password: 'a-long-enough-password',
      displayName: 'Admin',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: 'admin@example.com', displayName: 'Admin', isAdmin: true });
    adminCookie = sessionCookie(res);
  });

  it('second registration without an invite is rejected', async () => {
    const res = await post('/auth/register', {
      email: 'b@example.com',
      password: 'a-long-enough-password',
      displayName: 'Bee',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/invite/i);
  });

  it('/me returns the session user', async () => {
    const res = await app.inject({ method: 'GET', url: '/me', headers: { cookie: adminCookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe('admin@example.com');
  });

  it('/me without a session is 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
  });

  it('admin can create an invite', async () => {
    const res = await post('/invites', {}, { cookie: adminCookie });
    expect(res.statusCode).toBe(201);
    inviteCode = res.json().code;
    expect(inviteCode.length).toBeGreaterThan(8);
  });

  it('registration with the invite works and is not admin', async () => {
    const res = await post('/auth/register', {
      email: 'b@example.com',
      password: 'a-long-enough-password',
      displayName: 'Bee',
      inviteCode,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().isAdmin).toBe(false);
  });

  it('a used invite cannot be reused', async () => {
    const res = await post('/auth/register', {
      email: 'c@example.com',
      password: 'a-long-enough-password',
      displayName: 'Cee',
      inviteCode,
    });
    expect(res.statusCode).toBe(400);
  });

  it('duplicate email is a conflict', async () => {
    const invite = (await post('/invites', {}, { cookie: adminCookie })).json().code;
    const res = await post('/auth/register', {
      email: 'b@example.com',
      password: 'a-long-enough-password',
      displayName: 'Bee 2',
      inviteCode: invite,
    });
    expect(res.statusCode).toBe(409);
  });

  it('non-admin cannot create invites', async () => {
    const login = await post('/auth/login', { email: 'b@example.com', password: 'a-long-enough-password' });
    expect(login.statusCode).toBe(200);
    const res = await post('/invites', {}, { cookie: sessionCookie(login) });
    expect(res.statusCode).toBe(403);
  });

  it('login with the wrong password is 401', async () => {
    const res = await post('/auth/login', { email: 'b@example.com', password: 'nope-nope-nope' });
    expect(res.statusCode).toBe(401);
  });

  it('logout invalidates the session', async () => {
    const login = await post('/auth/login', { email: 'b@example.com', password: 'a-long-enough-password' });
    const cookie = sessionCookie(login);
    expect((await post('/auth/logout', {}, { cookie })).statusCode).toBe(204);
    const me = await app.inject({ method: 'GET', url: '/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('mutating requests from a foreign origin are refused', async () => {
    const res = await post('/auth/login', { email: 'b@example.com', password: 'a-long-enough-password' }, { origin: 'https://evil.example' });
    expect(res.statusCode).toBe(403);
  });

  it('validation errors are 400 with a message', async () => {
    const res = await post('/auth/register', { email: 'not-an-email', password: 'abc', displayName: 'x' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation');
  });
});

describe('password policy', () => {
  it('accepts six lowercase letters and rejects five', async () => {
    const login = await post('/auth/login', { email: 'admin@example.com', password: 'a-long-enough-password' });
    const invite = (await post('/invites', {}, { cookie: sessionCookie(login) })).json().code;
    const ok = await post('/auth/register', { email: 'six@example.com', password: 'abcdef', displayName: 'Six', inviteCode: invite });
    expect(ok.statusCode).toBe(201);
    const short = await post('/auth/register', { email: 'five@example.com', password: 'abcde', displayName: 'Five', inviteCode: invite });
    expect(short.statusCode).toBe(400);
  });
});
