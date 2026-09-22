import { applyRoomEvent, decide, reduceAll, type ClientMessage, type GameCommand, type GameEvent, type PlayerId, type RoomEvent, type RoomState, type ServerMessage } from '@mtg/shared';
import { taplandOf } from '../cards/taplandLookup';

export interface RoomSnapshot {
  /** Confirmed state plus the effects of commands still awaiting the server. */
  state: RoomState | null;
  /** Most recent events received on this connection (newest last), for the log. */
  events: RoomEvent[];
  status: 'connecting' | 'open' | 'closed';
  connected: PlayerId[];
  lastError: string | null;
  /** Commands sent but not yet answered. */
  pending: number;
}

export type CommandResult = { ok: true; seq: number } | { ok: false; error: string };

export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface ConnectionOptions {
  /** The signed-in player; enables optimistic prediction of own commands. */
  me?: { id: string; displayName: string };
  /** Creates a socket; injectable for tests. Defaults to the browser WebSocket. */
  createSocket?: (url: string) => SocketLike;
  /** Reconnect backoff in ms; capped at the last value. */
  backoff?: number[];
  setTimeout?: typeof setTimeout;
}

const DEFAULT_BACKOFF = [500, 1000, 2000, 5000, 10000];
const EVENT_BUFFER = 500;

interface Prediction {
  id: string;
  events: GameEvent[];
}

/**
 * Keeps one room in sync over a WebSocket: applies streamed events with the
 * shared reducer, resends `hello` with the last applied seq on reconnect, and
 * matches command results to their ids.
 *
 * Optimistic updates: a command is predicted locally with the shared
 * `decide()` and layered over the confirmed state until the server answers.
 * The view is always `confirmed + pending predictions`, so a rejected or
 * differently-resolved command rolls back by itself.
 */
export class RoomConnection {
  private socket: SocketLike | null = null;
  private confirmed: RoomState | null = null;
  private predictions: Prediction[] = [];
  private snapshot: RoomSnapshot = { state: null, events: [], status: 'connecting', connected: [], lastError: null, pending: 0 };
  private listeners = new Set<() => void>();
  private resolvers = new Map<string, (r: CommandResult) => void>();
  private attempts = 0;
  private stopped = false;
  private nextId = 1;
  private readonly me: ConnectionOptions['me'];
  private readonly createSocket: (url: string) => SocketLike;
  private readonly backoff: number[];
  private readonly schedule: typeof setTimeout;

  constructor(
    private readonly url: string,
    opts: ConnectionOptions = {},
  ) {
    this.me = opts.me;
    this.createSocket = opts.createSocket ?? ((u) => new WebSocket(u) as unknown as SocketLike);
    this.backoff = opts.backoff ?? DEFAULT_BACKOFF;
    this.schedule = opts.setTimeout ?? setTimeout;
    this.connect();
  }

  getSnapshot(): RoomSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sends a command, applying its predicted effect immediately; resolves with the server's verdict. */
  send(command: GameCommand): Promise<CommandResult> {
    if (!this.socket || this.socket.readyState !== 1 || this.snapshot.status !== 'open') {
      return Promise.resolve({ ok: false, error: 'Not connected' });
    }
    const id = String(this.nextId++);
    const predicted = this.predict(command);
    if (predicted.length > 0) this.predictions.push({ id, events: predicted });
    return new Promise((resolve) => {
      this.resolvers.set(id, resolve);
      this.emit({ type: 'command', id, command });
      this.recompute();
    });
  }

  close(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
    this.update({ status: 'closed' });
  }

  /** Local guess of what the server will do. Commands needing randomness or history are not predicted. */
  private predict(command: GameCommand): GameEvent[] {
    if (!this.me || !this.snapshot.state) return [];
    // Taplands are predicted from the printings the table has already fetched, so a land lands tapped without waiting for the server.
    const d = decide(this.snapshot.state, command, { actorId: this.me.id, actorDisplayName: this.me.displayName, now: new Date(), taplands: taplandOf });
    return d.ok ? d.events : [];
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = this.createSocket(this.url);
    this.socket = socket;
    this.update({ status: 'connecting' });
    socket.onopen = () => {
      this.attempts = 0;
      this.emit({ type: 'hello', lastSeq: this.confirmed?.seq ?? 0 });
    };
    socket.onmessage = (ev) => this.handle(JSON.parse(String(ev.data)) as ServerMessage);
    socket.onerror = () => undefined;
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const resolve of this.resolvers.values()) resolve({ ok: false, error: 'Disconnected' });
      this.resolvers.clear();
      this.predictions = [];
      // 44xx are deliberate refusals (auth, origin, unknown room): do not retry.
      if (this.stopped || (ev.code >= 4400 && ev.code < 4500)) {
        this.confirmedChanged({ status: 'closed', lastError: ev.code >= 4400 ? `Connection refused (${ev.code})` : this.snapshot.lastError });
        return;
      }
      this.confirmedChanged({ status: 'connecting' });
      const delay = this.backoff[Math.min(this.attempts++, this.backoff.length - 1)] ?? 1000;
      this.schedule(() => this.connect(), delay);
    };
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'state':
        this.confirmed = msg.state;
        this.confirmedChanged({ status: 'open', lastError: null });
        return;
      case 'events': {
        if (!this.confirmed) {
          // Gap reply without a base state: cannot apply; ask for everything.
          this.emit({ type: 'hello', lastSeq: 0 });
          return;
        }
        const fresh = msg.events.filter((e) => e.seq > this.confirmed!.seq);
        for (const e of fresh) this.confirmed = applyRoomEvent(this.confirmed, e);
        this.confirmedChanged({ events: [...this.snapshot.events, ...fresh].slice(-EVENT_BUFFER), status: 'open', lastError: null });
        return;
      }
      case 'result': {
        const resolve = this.resolvers.get(msg.id);
        this.resolvers.delete(msg.id);
        this.predictions = this.predictions.filter((p) => p.id !== msg.id);
        this.recompute();
        resolve?.(msg.ok ? { ok: true, seq: msg.seq } : { ok: false, error: msg.error });
        return;
      }
      case 'presence':
        this.update({ connected: msg.connected });
        return;
      case 'error':
        this.update({ lastError: msg.message });
        return;
      case 'pong':
        return;
    }
  }

  /** Confirmed state changed: rebuild the optimistic view and publish. */
  private confirmedChanged(patch: Partial<RoomSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.recompute();
  }

  private recompute(): void {
    const state = this.confirmed ? this.predictions.reduce((s, p) => reduceAll(s, p.events), this.confirmed) : null;
    this.update({ state, pending: this.resolvers.size });
  }

  private emit(msg: ClientMessage): void {
    this.socket?.send(JSON.stringify(msg));
  }

  private update(patch: Partial<RoomSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }
}

export function roomSocketUrl(apiUrl: string, roomId: string): string {
  return `${apiUrl.replace(/^http/, 'ws')}/rooms/${roomId}/ws`;
}
