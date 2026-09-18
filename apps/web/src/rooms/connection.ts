import { applyRoomEvent, type ClientMessage, type GameCommand, type PlayerId, type RoomEvent, type RoomState, type ServerMessage } from '@mtg/shared';

export interface RoomSnapshot {
  state: RoomState | null;
  /** Most recent events received on this connection (newest last), for the log. */
  events: RoomEvent[];
  status: 'connecting' | 'open' | 'closed';
  connected: PlayerId[];
  lastError: string | null;
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
  /** Creates a socket; injectable for tests. Defaults to the browser WebSocket. */
  createSocket?: (url: string) => SocketLike;
  /** Reconnect backoff in ms; capped at the last value. */
  backoff?: number[];
  setTimeout?: typeof setTimeout;
}

const DEFAULT_BACKOFF = [500, 1000, 2000, 5000, 10000];
const EVENT_BUFFER = 500;

/**
 * Keeps one room in sync over a WebSocket: applies streamed events with the
 * shared reducer, resends `hello` with the last applied seq on reconnect, and
 * matches command results to their ids. Framework-free; see useRoom for React.
 */
export class RoomConnection {
  private socket: SocketLike | null = null;
  private snapshot: RoomSnapshot = { state: null, events: [], status: 'connecting', connected: [], lastError: null };
  private listeners = new Set<() => void>();
  private pending = new Map<string, (r: CommandResult) => void>();
  private attempts = 0;
  private stopped = false;
  private nextId = 1;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly backoff: number[];
  private readonly schedule: typeof setTimeout;

  constructor(
    private readonly url: string,
    opts: ConnectionOptions = {},
  ) {
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

  /** Sends a command; resolves with the server's verdict. */
  send(command: GameCommand): Promise<CommandResult> {
    if (!this.socket || this.socket.readyState !== 1 || this.snapshot.status !== 'open') {
      return Promise.resolve({ ok: false, error: 'Not connected' });
    }
    const id = String(this.nextId++);
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.emit({ type: 'command', id, command });
    });
  }

  close(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
    this.update({ status: 'closed' });
  }

  private connect(): void {
    if (this.stopped) return;
    const socket = this.createSocket(this.url);
    this.socket = socket;
    this.update({ status: 'connecting' });
    socket.onopen = () => {
      this.attempts = 0;
      this.emit({ type: 'hello', lastSeq: this.snapshot.state?.seq ?? 0 });
    };
    socket.onmessage = (ev) => this.handle(JSON.parse(String(ev.data)) as ServerMessage);
    socket.onerror = () => undefined;
    socket.onclose = (ev) => {
      if (this.socket !== socket) return;
      this.socket = null;
      for (const resolve of this.pending.values()) resolve({ ok: false, error: 'Disconnected' });
      this.pending.clear();
      // 44xx are deliberate refusals (auth, origin, unknown room): do not retry.
      if (this.stopped || (ev.code >= 4400 && ev.code < 4500)) {
        this.update({ status: 'closed', lastError: ev.code >= 4400 ? `Connection refused (${ev.code})` : this.snapshot.lastError });
        return;
      }
      this.update({ status: 'connecting' });
      const delay = this.backoff[Math.min(this.attempts++, this.backoff.length - 1)] ?? 1000;
      this.schedule(() => this.connect(), delay);
    };
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case 'state':
        this.update({ state: msg.state, status: 'open', lastError: null });
        return;
      case 'events': {
        let state = this.snapshot.state;
        if (!state) {
          // Gap reply without a base state: cannot apply; ask for everything.
          this.emit({ type: 'hello', lastSeq: 0 });
          return;
        }
        const fresh = msg.events.filter((e) => e.seq > state!.seq);
        for (const e of fresh) state = applyRoomEvent(state, e);
        this.update({ state, events: [...this.snapshot.events, ...fresh].slice(-EVENT_BUFFER), status: 'open', lastError: null });
        return;
      }
      case 'result': {
        const resolve = this.pending.get(msg.id);
        this.pending.delete(msg.id);
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
