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

describe('projection over the wire', () => {
  it('hides the opponent’s hand and all libraries, reveals on play', async () => {
    const { schema } = await import('../db/index.js');
    const [card] = await ctx.app.db.insert(schema.cards).values({
      id: '22222222-2222-4222-8222-222222222222', name: 'Island', lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
      collectorNumber: '1', releasedAt: '1993-08-05', rarity: 'common', colorIdentity: ['U'], faces: [], oracleId: null,
    }).returning();
    const me = async (cookie: string) => (await ctx.app.inject({ url: '/me', headers: { cookie } })).json().id as string;
    const [aliceId, bobId] = [await me(alice), await me(bob)];
    const [deckA] = await ctx.app.db.insert(schema.decks).values({ ownerId: aliceId, name: 'A', contents: { main: [{ printingId: card!.id, quantity: 9 }], sideboard: [], commander: [] } }).returning();
    const [deckB] = await ctx.app.db.insert(schema.decks).values({ ownerId: bobId, name: 'B', contents: { main: [{ printingId: card!.id, quantity: 9 }], sideboard: [], commander: [] } }).returning();

    const created = await ctx.app.inject({ method: 'POST', url: '/rooms', headers: { origin: TEST_ORIGIN, cookie: alice }, payload: { settings } });
    const room = created.json().id as string;
    const http = (cookie: string, command: object) => ctx.app.inject({ method: 'POST', url: `/rooms/${room}/commands`, headers: { origin: TEST_ORIGIN, cookie }, payload: command });
    await http(bob, { type: 'join' });
    await http(alice, { type: 'selectDeck', deckId: deckA!.id });
    await http(bob, { type: 'selectDeck', deckId: deckB!.id });
    await http(alice, { type: 'setReady', ready: true });
    await http(bob, { type: 'setReady', ready: true });

    const b = new Client(bob, room);
    await b.open();
    b.send({ type: 'hello', lastSeq: 0 });
    await b.nextOf('state');

    const started = await http(alice, { type: 'start' });
    expect(started.statusCode).toBe(200);
    // Alice's own HTTP result is projected for her: her hand visible, Bob's not.
    const aliceView = started.json().state;
    const aHand = aliceView.game.players[aliceId].zones.hand as string[];
    const bHand = aliceView.game.players[bobId].zones.hand as string[];
    expect(aHand.every((id) => aliceView.game.cards[id].printingId === card!.id)).toBe(true);
    expect(bHand.every((id) => aliceView.game.cards[id].printingId === null)).toBe(true);

    // Bob's socket gets the gameStarted event stripped of Alice's identities.
    const ev = await b.nextOf('events');
    const gs = ev.events[0]!.event;
    if (gs.type !== 'gameStarted') throw new Error('expected gameStarted');
    expect(gs.players[aliceId]!.hand.every((c) => c.printingId === null)).toBe(true);
    expect(gs.players[bobId]!.hand.every((c) => c.printingId === card!.id)).toBe(true);
    expect(gs.players[bobId]!.library.every((c) => c.printingId === null)).toBe(true);

    // Both finish sideboarding and keep their opening hands (four event batches Bob also receives).
    await http(alice, { type: 'finishSideboarding' });
    await http(bob, { type: 'finishSideboarding' });
    await http(alice, { type: 'keepHand', bottom: [] });
    await http(bob, { type: 'keepHand', bottom: [] });
    for (let i = 0; i < 4; i++) await b.nextOf('events');
    // Alice plays a card: Bob learns its identity via `revealed`.
    await http(alice, { type: 'moveCard', instanceId: aHand[0], to: 'battlefield' });
    const played = await b.nextOf('events');
    expect(played.events[0]!.revealed).toEqual([{ instanceId: aHand[0], printingId: card!.id }]);

    // A fresh GET for Bob is projected too.
    const view = (await ctx.app.inject({ url: `/rooms/${room}`, headers: { cookie: bob } })).json();
    expect(view.game.cards[aHand[1]!].printingId).toBeNull();
    expect(view.game.cards[aHand[0]!].printingId).toBe(card!.id);
    await b.close();
  });
});

describe('draft over the wire', () => {
  it('reveals a pack only when it reaches the seat, and hides it once passed', async () => {
    const { schema } = await import('../db/index.js');
    const cardIds = [0, 1, 2, 3].map((i) => `66666666-6666-4666-8666-66666666666${i}`);
    await ctx.app.db.insert(schema.cards).values(cardIds.map((id, i) => ({
      id, name: `Pick ${i}`, lang: 'en', layout: 'normal', setCode: 'lea', setName: 'Alpha', setType: 'core',
      collectorNumber: String(10 + i), releasedAt: '1993-08-05', rarity: 'common', colorIdentity: [], faces: [], oracleId: null,
    })));
    const me = async (cookie: string) => (await ctx.app.inject({ url: '/me', headers: { cookie } })).json().id as string;
    const [aliceId, bobId] = [await me(alice), await me(bob)];
    const [cube] = await ctx.app.db.insert(schema.cubes).values({ ownerId: aliceId, name: 'Wire cube' }).returning();
    const [version] = await ctx.app.db.insert(schema.cubeVersions).values({ cubeId: cube!.id, number: 1, createdBy: aliceId }).returning();
    await ctx.app.db.insert(schema.cubeVersionCards).values(cardIds.map((cardId) => ({ versionId: version!.id, cardId, quantity: 1 })));
    const draft = { name: 'Wire', seats: 2, startDirection: 'left', phases: [{ type: 'pickAndPass', name: 'Only', poolCubeVersionId: version!.id, packSize: 2, packsPerPlayer: 1, rounds: 1, direction: 'alternate' }] };

    const created = await ctx.app.inject({ method: 'POST', url: '/rooms', headers: { origin: TEST_ORIGIN, cookie: alice }, payload: { settings: { ...settings, draft } } });
    const room = created.json().id as string;
    const http = (cookie: string, command: object) => ctx.app.inject({ method: 'POST', url: `/rooms/${room}/commands`, headers: { origin: TEST_ORIGIN, cookie }, payload: command });
    await http(bob, { type: 'join' });
    await http(alice, { type: 'setReady', ready: true });
    await http(bob, { type: 'setReady', ready: true });

    const b = new Client(bob, room);
    await b.open();
    b.send({ type: 'hello', lastSeq: 0 });
    await b.nextOf('state');

    expect((await http(alice, { type: 'start' })).statusCode).toBe(200);
    const started = await b.nextOf('events');
    const ev = started.events[0]!;
    if (ev.event.type !== 'draftStarted') throw new Error('expected draftStarted');
    expect(ev.event.packs.flatMap((p) => p.cards).every((c) => c.printingId === null)).toBe(true);
    expect(ev.draftRevealed).toHaveLength(2);
    const bobPack = ev.event.packs.find((p) => p.cards.some((c) => c.id === ev.draftRevealed![0]!.cardId))!;
    const alicePack = ev.event.packs.find((p) => p.id !== bobPack.id)!;

    // Alice picks: Bob receives the event with the identity hidden, and no reveal yet (her pack queues behind his).
    const aliceView = (await ctx.app.inject({ url: `/rooms/${room}`, headers: { cookie: alice } })).json();
    const aliceCard = aliceView.draft.packs[alicePack.id].cards[0];
    expect(aliceCard.printingId).not.toBe('');
    await http(alice, { type: 'draftPick', cardId: aliceCard.id });
    const picked = await b.nextOf('events');
    expect(picked.events[0]!.event).toMatchObject({ type: 'draftPicked', playerId: aliceId, printingId: null });
    expect(picked.events[0]!.draftRevealed).toBeUndefined();

    // Bob picks over the socket: his pack leaves (hidden) and Alice's remaining card arrives (revealed).
    b.send({ type: 'command', id: 'p1', command: { type: 'draftPick', cardId: bobPack.cards[0]!.id } });
    const own = await b.nextOf('events');
    expect(own.events[0]!.event).toMatchObject({ type: 'draftPicked', playerId: bobId, cardId: bobPack.cards[0]!.id });
    expect(own.events[0]!.draftHidden).toEqual([bobPack.cards[1]!.id]);
    expect(own.events[0]!.draftRevealed).toEqual([{ cardId: alicePack.cards[1]!.id, printingId: expect.any(String) }]);
    expect(await b.nextOf('result')).toEqual({ type: 'result', id: 'p1', ok: true, seq: own.events[0]!.seq });
    await b.close();
  });
});
