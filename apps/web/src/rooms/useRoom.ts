import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { config } from '../lib/config';
import { RoomConnection, roomSocketUrl } from './connection';

/** Live room state over the room socket, plus a `send` for commands. */
export function useRoom(roomId: string) {
  const connection = useMemo(() => new RoomConnection(roomSocketUrl(config.apiUrl, roomId)), [roomId]);
  useEffect(() => () => connection.close(), [connection]);
  const snapshot = useSyncExternalStore(
    (cb) => connection.subscribe(cb),
    () => connection.getSnapshot(),
  );
  return { ...snapshot, send: connection.send.bind(connection) };
}
