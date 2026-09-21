import { decide, initialRoomState, reduce, reduceAll, type RoomEvent, type RoomState, type ServerMessage } from '@mtg/shared';
import { describe, expect, it } from 'vitest';
import { RoomConnection, type SocketLike } from './connection';

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: unknown[] = [];
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onclose: SocketLike['onclose'] = null;
  onerror: SocketLike['onerror'] = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
  open() {
    this.readyState = 1;
    this.onopen?.(undefined);
  }
  receive(msg: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

const state = (seq: number): RoomState => ({
  id: 'r', ownerId: 'a', settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false }, phase: 'lobby', players: {}, game: null, draft: null, results: [], seq,
});
const joined = (seq: number, playerId: string): RoomEvent => ({ seq, actorId: playerId, at: 'now', event: { type: 'playerJoined', playerId, displayName: playerId, seat: 0, team: 0 } });

function setup() {
  const sockets: FakeSocket[] = [];
  const timers: (() => void)[] = [];
  const conn = new RoomConnection('ws://x', {
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    backoff: [1],
    setTimeout: ((fn: () => void) => {
      timers.push(fn);
      return 0;
    }) as unknown as typeof setTimeout,
  });
  return { conn, sockets, timers };
}

describe('RoomConnection', () => {
  it('says hello with lastSeq 0, applies state then events', () => {
    const { conn, sockets } = setup();
    const s = sockets[0]!;
    s.open();
    expect(s.sent).toEqual([{ type: 'hello', lastSeq: 0 }]);
    s.receive({ type: 'state', state: state(2) });
    expect(conn.getSnapshot()).toMatchObject({ status: 'open', state: { seq: 2 } });
    s.receive({ type: 'events', events: [joined(3, 'b')] });
    expect(conn.getSnapshot().state?.seq).toBe(3);
    expect(conn.getSnapshot().events.map((e) => e.seq)).toEqual([3]);
    expect(conn.getSnapshot().state?.players.b?.displayName).toBe('b');
    // duplicates are ignored
    s.receive({ type: 'events', events: [joined(3, 'b')] });
    expect(conn.getSnapshot().state?.seq).toBe(3);
    expect(conn.getSnapshot().events).toHaveLength(1);
  });

  it('resolves command results by id and fails pending commands on disconnect', async () => {
    const { conn, sockets } = setup();
    const s = sockets[0]!;
    s.open();
    s.receive({ type: 'state', state: state(2) });
    const p1 = conn.send({ type: 'join' });
    expect(s.sent[1]).toEqual({ type: 'command', id: '1', command: { type: 'join' } });
    s.receive({ type: 'result', id: '1', ok: true, seq: 3 });
    expect(await p1).toEqual({ ok: true, seq: 3 });
    const p2 = conn.send({ type: 'leave' });
    s.drop();
    expect(await p2).toEqual({ ok: false, error: 'Disconnected' });
    expect(await conn.send({ type: 'leave' })).toEqual({ ok: false, error: 'Not connected' });
  });

  it('reconnects with the last applied seq and stops on 44xx refusals', () => {
    const { conn, sockets, timers } = setup();
    sockets[0]!.open();
    sockets[0]!.receive({ type: 'state', state: state(5) });
    sockets[0]!.drop();
    expect(conn.getSnapshot().status).toBe('connecting');
    timers.shift()?.();
    const s2 = sockets[1]!;
    s2.open();
    expect(s2.sent).toEqual([{ type: 'hello', lastSeq: 5 }]);
    s2.drop(4401);
    expect(conn.getSnapshot().status).toBe('closed');
    expect(conn.getSnapshot().lastError).toContain('4401');
    expect(timers).toHaveLength(0);
    expect(sockets).toHaveLength(2);
  });

  it('tracks presence and notifies subscribers', () => {
    const { conn, sockets } = setup();
    let calls = 0;
    conn.subscribe(() => calls++);
    sockets[0]!.open();
    sockets[0]!.receive({ type: 'presence', connected: ['a', 'b'] });
    expect(conn.getSnapshot().connected).toEqual(['a', 'b']);
    expect(calls).toBeGreaterThan(0);
    conn.close();
    expect(conn.getSnapshot().status).toBe('closed');
  });
});

describe('optimistic updates', () => {
  const me = { id: 'a', displayName: 'A' };
  const settings = { playerCount: 2 as const, mode: '1v1' as const, startingLife: 20, commander: false };

  /** A running 1v1 game where `a` has 7 cards in hand and 3 in the library. */
  function playingState(): RoomState {
    let n = 0;
    let s = reduce(initialRoomState('r'), { type: 'roomCreated', ownerId: 'a', settings });
    for (const p of ['a', 'b']) {
      for (const c of [{ type: 'join' as const }, { type: 'selectDeck' as const, deckId: 'd' }, { type: 'setReady' as const, ready: true }]) {
        const d = decide(s, c, { actorId: p, actorDisplayName: p, now: new Date(0) });
        if (!d.ok) throw new Error(d.error);
        s = reduceAll(s, d.events);
      }
    }
    const decks = { a: { main: [{ printingId: 'bolt', quantity: 10 }], sideboard: [], commander: [] }, b: { main: [{ printingId: 'isle', quantity: 8 }], sideboard: [], commander: [] } };
    let r = 0;
    const d = decide(s, { type: 'start' }, { actorId: 'a', actorDisplayName: 'A', now: new Date(0), decks, random: () => ((r += 7) % 11) / 11, newId: () => `c${++n}` });
    if (!d.ok) throw new Error(d.error);
    let dealt = reduceAll(s, d.events);
    for (const command of [{ type: 'finishSideboarding' } as const, { type: 'keepHand', bottom: [] } as const]) {
      for (const p of ['a', 'b']) {
        const k = decide(dealt, command, { actorId: p, actorDisplayName: p, now: new Date(0) });
        if (!k.ok) throw new Error(k.error);
        dealt = reduceAll(dealt, k.events);
      }
    }
    return { ...dealt, seq: 10 };
  }

  function setupPlaying() {
    const sockets: FakeSocket[] = [];
    const conn = new RoomConnection('ws://x', { me, createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; }, backoff: [1], setTimeout: (() => 0) as unknown as typeof setTimeout });
    const s = sockets[0]!;
    s.open();
    const base = playingState();
    s.receive({ type: 'state', state: base });
    return { conn, s, base };
  }

  it('shows the predicted effect immediately and settles on the server events', async () => {
    const { conn, s, base } = setupPlaying();
    const hand = base.game!.players.a!.zones.hand[0]!;
    const p = conn.send({ type: 'moveCard', instanceId: hand, to: 'battlefield', position: { row: 0, col: 0 } });
    expect(conn.getSnapshot().state!.game!.cards[hand]!.zone).toBe('battlefield');
    expect(conn.getSnapshot().pending).toBe(1);
    // Server confirms with the real event, then the result.
    const ev: RoomEvent = { seq: 11, actorId: 'a', at: '', event: { type: 'cardMoved', instanceId: hand, from: 'hand', to: 'battlefield', position: { row: 0, col: 0 }, libraryPosition: null } };
    s.receive({ type: 'events', events: [ev] });
    expect(conn.getSnapshot().state!.game!.players.a!.zones.battlefield).toEqual([hand]); // no double-apply
    s.receive({ type: 'result', id: '1', ok: true, seq: 11 });
    expect(await p).toEqual({ ok: true, seq: 11 });
    expect(conn.getSnapshot().pending).toBe(0);
    expect(conn.getSnapshot().state!.seq).toBe(11);
    expect(conn.getSnapshot().state!.game!.cards[hand]!.zone).toBe('battlefield');
  });

  it('rolls back a prediction the server rejects', async () => {
    const { conn, s, base } = setupPlaying();
    const hand = base.game!.players.a!.zones.hand[0]!;
    const p = conn.send({ type: 'moveCard', instanceId: hand, to: 'graveyard' });
    expect(conn.getSnapshot().state!.game!.cards[hand]!.zone).toBe('graveyard');
    s.receive({ type: 'result', id: '1', ok: false, error: 'Nope' });
    expect(await p).toEqual({ ok: false, error: 'Nope' });
    expect(conn.getSnapshot().state!.game!.cards[hand]!.zone).toBe('hand');
    expect(conn.getSnapshot().state).toEqual(base);
  });

  it('keeps later predictions while earlier ones settle, and drops all on disconnect', async () => {
    const { conn, s, base } = setupPlaying();
    const [h0, h1] = base.game!.players.a!.zones.hand;
    void conn.send({ type: 'moveCard', instanceId: h0!, to: 'battlefield' });
    void conn.send({ type: 'moveCard', instanceId: h1!, to: 'battlefield' });
    expect(conn.getSnapshot().state!.game!.players.a!.zones.battlefield).toEqual([h0, h1]);
    s.receive({ type: 'events', events: [{ seq: 11, actorId: 'a', at: '', event: { type: 'cardMoved', instanceId: h0!, from: 'hand', to: 'battlefield', position: { row: 0, col: 0 }, libraryPosition: null } }] });
    s.receive({ type: 'result', id: '1', ok: true, seq: 11 });
    expect(conn.getSnapshot().state!.game!.players.a!.zones.battlefield).toEqual([h0, h1]);
    expect(conn.getSnapshot().pending).toBe(1);
    s.drop();
    expect(conn.getSnapshot().state!.game!.players.a!.zones.battlefield).toEqual([h0]); // confirmed only
    expect(conn.getSnapshot().pending).toBe(0);
  });

  it('does not predict commands that need the server (shuffle, dice, undo) or invalid ones', () => {
    const { conn, base } = setupPlaying();
    void conn.send({ type: 'shuffleLibrary' });
    void conn.send({ type: 'rollDice', sides: 6, count: 1 });
    void conn.send({ type: 'undo' });
    void conn.send({ type: 'moveCard', instanceId: 'nope', to: 'graveyard' });
    expect(conn.getSnapshot().state).toEqual(base);
    expect(conn.getSnapshot().pending).toBe(4);
  });
});
