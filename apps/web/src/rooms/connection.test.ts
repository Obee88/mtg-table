import type { RoomEvent, RoomState, ServerMessage } from '@mtg/shared';
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
  id: 'r', ownerId: 'a', settings: { playerCount: 2, mode: '1v1', startingLife: 20, commander: false }, phase: 'lobby', players: {}, game: null, seq,
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
