import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { config } from '../lib/config';
import { RoomConnection, roomSocketUrl } from './connection';

/** Live room state over the room socket, plus a `send` for commands (predicted locally when `me` is known). */
export function useRoom(roomId: string, me?: { id: string; displayName: string }) {
  const meId = me?.id;
  const meName = me?.displayName;
  const connection = useMemo(
    () => new RoomConnection(roomSocketUrl(config.apiUrl, roomId), meId && meName ? { me: { id: meId, displayName: meName } } : {}),
    [roomId, meId, meName],
  );
  useEffect(() => () => connection.close(), [connection]);
  const snapshot = useSyncExternalStore(
    (cb) => connection.subscribe(cb),
    () => connection.getSnapshot(),
  );
  return { ...snapshot, send: connection.send.bind(connection) };
}
