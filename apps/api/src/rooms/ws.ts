import { clientMessageSchema, WS_CLOSE, type RoomEvent, type ServerMessage } from '@mtg/shared';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { HttpError } from '../errors.js';

/** Beyond this many missed events the server sends a full state instead of the gap. */
const MAX_GAP = 500;
const idParam = z.object({ id: z.uuid() });

/**
 * One socket per (room, browser tab). The server pushes every event of the
 * room as it happens; the client sends commands and gets a matched result.
 */
export async function roomSocketRoutes(app: FastifyInstance): Promise<void> {
  const presence = new Map<string, Map<WebSocket, string>>(); // roomId → socket → userId

  const send = (socket: WebSocket, msg: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  const broadcastPresence = (roomId: string) => {
    const sockets = presence.get(roomId);
    if (!sockets) return;
    const connected = [...new Set(sockets.values())];
    for (const s of sockets.keys()) send(s, { type: 'presence', connected });
  };

  app.get('/rooms/:id/ws', { websocket: true }, async (socket, req) => {
    // Browsers always send Origin on WebSocket upgrades; refuse other sites.
    if (req.headers.origin !== app.config.WEB_ORIGIN) return socket.close(WS_CLOSE.forbidden, 'bad origin');
    const user = req.user;
    if (!user) return socket.close(WS_CLOSE.unauthorized, 'not signed in');
    const params = idParam.safeParse(req.params);
    if (!params.success) return socket.close(WS_CLOSE.notFound, 'bad room id');
    const roomId = params.data.id;

    try {
      await app.rooms.get(roomId);
    } catch (err) {
      return socket.close(err instanceof HttpError ? WS_CLOSE.notFound : 1011, 'room unavailable');
    }

    const actor = { id: user.id, displayName: user.displayName };
    const log = req.log.child({ roomId, userId: user.id });
    let helloDone = false;

    const unsubscribe = app.rooms.subscribe(roomId, (events: RoomEvent[]) => {
      if (helloDone) send(socket, { type: 'events', events });
    });
    const sockets = presence.get(roomId) ?? new Map<WebSocket, string>();
    presence.set(roomId, sockets);
    sockets.set(socket, user.id);
    broadcastPresence(roomId);

    socket.on('message', async (raw) => {
      let parsed: ReturnType<typeof clientMessageSchema.safeParse>;
      try {
        parsed = clientMessageSchema.safeParse(JSON.parse(String(raw)));
      } catch {
        return socket.close(WS_CLOSE.badMessage, 'not json');
      }
      if (!parsed.success) return socket.close(WS_CLOSE.badMessage, 'bad message');
      const msg = parsed.data;

      try {
        switch (msg.type) {
          case 'hello': {
            const state = await app.rooms.get(roomId);
            if (msg.lastSeq > 0 && msg.lastSeq <= state.seq && state.seq - msg.lastSeq <= MAX_GAP) {
              const events = await app.rooms.eventsSince(roomId, msg.lastSeq);
              send(socket, { type: 'events', events });
            } else {
              send(socket, { type: 'state', state });
            }
            helloDone = true;
            return;
          }
          case 'command': {
            if (!helloDone) return send(socket, { type: 'result', id: msg.id, ok: false, error: 'Send hello first' });
            const result = await app.rooms.dispatch(roomId, actor, msg.command);
            if (result.ok) send(socket, { type: 'result', id: msg.id, ok: true, seq: result.state.seq });
            else send(socket, { type: 'result', id: msg.id, ok: false, error: result.error });
            return;
          }
          case 'ping':
            return send(socket, { type: 'pong' });
        }
      } catch (err) {
        log.error({ err }, 'room socket message failed');
        send(socket, { type: 'error', message: 'Internal error' });
      }
    });

    socket.on('close', () => {
      unsubscribe();
      sockets.delete(socket);
      if (sockets.size === 0) presence.delete(roomId);
      else broadcastPresence(roomId);
    });
    socket.on('error', (err) => log.warn({ err }, 'room socket error'));
  });
}
