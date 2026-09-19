import { decide, reduceAll, type GameCommand, type RoomEvent, type RoomState } from '@mtg/shared';
import { useCallback, useMemo, useState } from 'react';
import { CardPreviewProvider } from '../cards/CardPreview';
import { GameScreen } from '../table/GameScreen';
import { seedCards } from '../table/useCards';
import { fixtureRoom, ME } from './fixture';
import { FIXTURE_CARDS } from './fixtureCards';

/**
 * Design playground: the real game screen on a fixture game, with commands
 * applied locally through the shared decide/reduce so everything is
 * interactive without a server. Public; no real data.
 */
export function DesignPage() {
  seedCards(FIXTURE_CARDS);
  const playerCount = new URLSearchParams(window.location.search).get('players') === '4' ? 4 : 2;
  const [state, setState] = useState<RoomState>(() => fixtureRoom(playerCount));
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const send = useCallback(
    async (command: GameCommand) => {
      const d = decide(state, command, { actorId: ME, actorDisplayName: 'You', now: new Date(), random: Math.random, newId: () => crypto.randomUUID() });
      if (!d.ok) return { ok: false as const, error: d.error };
      const next = { ...reduceAll(state, d.events), seq: state.seq + d.events.length };
      const stored = d.events.map((event, i) => ({ seq: state.seq + i + 1, actorId: ME, at: new Date().toISOString(), event }));
      setState(next);
      setEvents((prev) => [...prev, ...stored].slice(-200));
      return { ok: true as const, seq: next.seq };
    },
    [state],
  );
  const room = useMemo(() => ({ state, events, status: 'open' as const, connected: Object.keys(state.players), send }), [state, events, send]);

  return (
    <CardPreviewProvider>
      <GameScreen room={room} meId={ME} />
    </CardPreviewProvider>
  );
}
