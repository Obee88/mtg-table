import type { RoomPlayer, RoomState } from '@mtg/shared';
import { seatedPlayers } from '@mtg/shared';

export type Corner = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

/**
 * Where each player sits on a 2×2 table from the viewer's point of view.
 * The viewer is bottom-left; seats continue clockwise: next seat top-left,
 * the seat across top-right, the previous seat bottom-right. In 2v2 the seat
 * across is the teammate (seats 0/2 vs 1/3), so partners share the diagonal.
 */
export function quadrants(state: RoomState, viewerId: string): Record<Corner, RoomPlayer | null> {
  const players = seatedPlayers(state);
  const n = state.settings.playerCount;
  const bySeat = new Map(players.map((p) => [p.seat, p]));
  const viewerSeat = players.find((p) => p.id === viewerId)?.seat ?? 0;
  const at = (offset: number) => bySeat.get((viewerSeat + offset) % n) ?? null;
  return { bottomLeft: at(0), topLeft: at(1), topRight: at(2), bottomRight: at(3) };
}

/** Seat number (1-based) → player, for the 1–4 focus keys. */
export function playerAtSeat(state: RoomState, seatNumber: number): RoomPlayer | null {
  return seatedPlayers(state).find((p) => p.seat === seatNumber - 1) ?? null;
}
