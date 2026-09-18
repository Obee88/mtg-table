import { z } from 'zod';
import { gameCommandSchema } from './commands.js';
import type { RoomEvent } from './events.js';
import type { PlayerId, RoomState } from './types.js';

/** Client → server messages on a room socket. */
export const clientMessageSchema = z.discriminatedUnion('type', [
  /** First message after connecting; `lastSeq` is the last event the client has applied (0 = none). */
  z.object({ type: z.literal('hello'), lastSeq: z.number().int().min(0) }),
  z.object({ type: z.literal('command'), id: z.string().min(1).max(64), command: gameCommandSchema }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** Server → client messages. */
export type ServerMessage =
  /** Full state; sent when the client is too far behind or has nothing. */
  | { type: 'state'; state: RoomState }
  /** Events after the client's last seq, in order. */
  | { type: 'events'; events: RoomEvent[] }
  /** Outcome of a `command` message, matched by id. `seq` is the last event it produced. */
  | { type: 'result'; id: string; ok: true; seq: number }
  | { type: 'result'; id: string; ok: false; error: string }
  /** Who currently has a socket open on this room. */
  | { type: 'presence'; connected: PlayerId[] }
  | { type: 'error'; message: string }
  | { type: 'pong' };

/** Close codes the server uses on room sockets. */
export const WS_CLOSE = {
  unauthorized: 4401,
  forbidden: 4403,
  notFound: 4404,
  badMessage: 4400,
} as const;
