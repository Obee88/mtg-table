import type { ServerMessage } from '@mtg/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { sessionCookie, TEST_ORIGIN, testApp } from '../test/app.js';

let ctx: Awaited<ReturnType<typeof testApp>>;
let base: string;
let alice: string;
let bob: string;
let roomId: string;

const settings = { playerCount: 2, mode: '1v1', startingLife: 20, commander: false };

/** Small helper around a ws client: queue of parsed messages with awaitable next(). */
class Client {
  private queue: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];
  closed: Promise<{ code: number; reason: string }>;
  ws: WebSocket;

  constructor(cookie: string | null, room: string, origin = TEST_ORIGIN) {
    const headers: Record<string, string> = { origin };
    if (cookie) headers.cookie = cookie;
    this.ws = new WebSocket(`${base.replace('http', 'ws')}/rooms/${room}/ws`, { headers });
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as ServerMessage;
      const w = this.waiters.shift();
      if (w) w(msg);
      else this.queue.push(msg);
    });
    this.closed = new Promise((resolve) => this.ws.on('close', (code, reason) => resolve({ code, reason: String(reason) })));
    this.ws.on('error', () => undefined);
  }
  open() {
    return new Promise<void>((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
      this.ws.once('close', () => reject(new Error('closed')));
    });
  }
  send(msg: unknown) {
    this.ws.send(JSON.stringify(msg));
  }
  next(): Promise<ServerMessage> {
    const m = this.queue.shift();
    if (m) return Promise.resolve(m);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  /** Skips presence/pong noise. */
  async nextOf<T extends ServerMessage['type']>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    for (;;) {
      const m = await this.next();
      if (m.type === type) return m as Extract<ServerMessage, { type: T }>;
    }
  }
  close() {
    this.ws.close();
    return this.closed;
  }
}

beforeAll(async () => {
  ctx = await testApp();
  const addr = await ctx.app.listen({ host: '127.0.0.1', port: 0 });
  base = addr;
  const a = await ctx.app.inject({ method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN }, payload: { email: 'a@x.io', password: 'secret1', displayName: 'Alice' } });
  alice = sessionCookie(a);
  const invite = (await ctx.app.inject({ method: 'POST', url: '/invites', headers: { origin: TEST_ORIGIN, cookie: alice }, payload: {} })).json().code;
  const b = await ctx.app.inject({ method: 'POST', url: '/auth/register', headers: { origin: TEST_ORIGIN }, payload: { email: 'b@x.io', password: 'secret1', displayName: 'Bob', inviteCode: invite } });
  bob = sessionCookie(b);
  const created = await ctx.app.inject({ method: 'POST', url: '/rooms', headers: { origin: TEST_ORIGIN, cookie: alice }, payload: { settings } });
  roomId = created.json().id;
});
afterAll(() => ctx.close());

describe('room websocket', () => {
  it('refuses unauthenticated, foreign-origin and unknown-room connections', async () => {
    expect((await new Client(null, roomId).closed).code).toBe(4401);
    expect((await new Client(alice, roomId, 'https://evil.example').closed).code).toBe(4403);
    expect((await new Client(alice, '00000000-0000-4000-8000-000000000000').closed).code).toBe(4404);
  });

  it('sends full state on hello, streams events, answers commands and tracks presence', async () => {
    const a = new Client(alice, roomId);
    await a.open();
    expect(await a.nextOf('presence')).toEqual({ type: 'presence', connected: [expect.any(String)] });
    a.send({ type: 'hello', lastSeq: 0 });
    const state = await a.nextOf('state');
    expect(state.state.seq).toBe(2);

    const b = new Client(bob, roomId);
    await b.open();
    expect((await a.nextOf('presence')).connected).toHaveLength(2);
    b.send({ type: 'hello', lastSeq: 0 });
    await b.nextOf('state');

    b.send({ type: 'command', id: 'c1', command: { type: 'join' } });
    // Alice sees the event; Bob gets a result (and the event).
    const evForA = await a.nextOf('events');
    expect(evForA.events.map((e) => [e.seq, e.event.type])).toEqual([[3, 'playerJoined']]);
    expect(await b.nextOf('result')).toEqual({ type: 'result', id: 'c1', ok: true, seq: 3 });

    b.send({ type: 'command', id: 'c2', command: { type: 'join' } });
    expect(await b.nextOf('result')).toEqual({ type: 'result', id: 'c2', ok: false, error: 'Already in the room' });

    // Commands over HTTP also reach socket subscribers.
    await ctx.app.inject({ method: 'POST', url: `/rooms/${roomId}/commands`, headers: { origin: TEST_ORIGIN, cookie: bob }, payload: { type: 'selectDeck', deckId: 'd1' } });
    expect((await a.nextOf('events')).events[0]?.event.type).toBe('deckSelected');

    await b.close();
    expect((await a.nextOf('presence')).connected).toHaveLength(1);
    a.send({ type: 'ping' });
    expect(await a.nextOf('pong')).toEqual({ type: 'pong' });
    await a.close();
  });

  it('reconnecting with lastSeq receives only the gap', async () => {
    const a = new Client(alice, roomId);
    await a.open();
    a.send({ type: 'hello', lastSeq: 2 });
    const gap = await a.nextOf('events');
    expect(gap.events.map((e) => e.seq)).toEqual([3, 4]);
    await a.close();

    const ahead = new Client(alice, roomId);
    await ahead.open();
    ahead.send({ type: 'hello', lastSeq: 999 }); // ahead of the server → full state
    expect((await ahead.nextOf('state')).state.seq).toBe(4);
    await ahead.close();
  });

  it('closes on malformed messages and rejects commands before hello', async () => {
    const a = new Client(alice, roomId);
    await a.open();
    a.send({ type: 'command', id: 'x', command: { type: 'join' } });
    expect(await a.nextOf('result')).toMatchObject({ ok: false, error: 'Send hello first' });
    a.ws.send('not json');
    expect((await a.closed).code).toBe(4400);
  });
});
