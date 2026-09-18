import type { CardInstance, GameCommand, PlayerGameState, RoomPlayer, RoomState, ZoneName } from '@mtg/shared';
import { seatedPlayers } from '@mtg/shared';
import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { Button, ErrorText } from '../components';
import type { CommandResult } from '../rooms/connection';
import { CARD_H, CARD_W, CardBack, TableCard } from './TableCard';
import { useCards } from './useCards';

type Send = (command: GameCommand) => Promise<CommandResult>;

export function Table({ state, meId, send }: { state: RoomState; meId: string; send: Send }) {
  const game = state.game!;
  const players = seatedPlayers(state);
  const me = players.find((p) => p.id === meId);
  const opponents = players.filter((p) => p.id !== meId);
  const printings = useCards(Object.values(game.cards).map((c) => c.printingId));
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (command: GameCommand) => {
      setError(null);
      const r = await send(command);
      if (!r.ok) setError(r.error);
    },
    [send],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!me) return;
      if (e.key === 'd') void run({ type: 'draw', count: 1 });
      if (e.key === 'u') void run({ type: 'untapAll' });
      if (e.key === 's') void run({ type: 'shuffleLibrary' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, me]);

  return (
    <div className="flex flex-col gap-3">
      {opponents.map((p) => (
        <PlayerArea key={p.id} player={p} pgs={game.players[p.id]!} cards={game.cards} printings={printings} mine={false} run={run} flipped />
      ))}
      {me && <PlayerArea player={me} pgs={game.players[me.id]!} cards={game.cards} printings={printings} mine run={run} />}
      <ErrorText error={error} />
    </div>
  );
}

function PlayerArea({ player, pgs, cards, printings, mine, run, flipped = false }: {
  player: RoomPlayer;
  pgs: PlayerGameState;
  cards: Record<string, CardInstance>;
  printings: ReturnType<typeof useCards>;
  mine: boolean;
  run: (c: GameCommand) => Promise<void>;
  flipped?: boolean;
}) {
  const zoneCards = (zone: ZoneName) => pgs.zones[zone].map((id) => cards[id]).filter((c): c is CardInstance => !!c);

  const dropTo = (zone: ZoneName) => (e: DragEvent<HTMLDivElement>) => {
    if (!mine) return;
    e.preventDefault();
    const instanceId = e.dataTransfer.getData('text/instance-id');
    if (!instanceId) return;
    const command: GameCommand = { type: 'moveCard', instanceId, to: zone };
    if (zone === 'battlefield') {
      const rect = e.currentTarget.getBoundingClientRect();
      command.position = {
        x: Math.max(0, Math.min(100, ((e.clientX - rect.left - CARD_W / 2) / rect.width) * 100)),
        y: Math.max(0, Math.min(100, ((e.clientY - rect.top - CARD_H / 2) / rect.height) * 100)),
      };
    }
    void run(command);
  };
  const allowDrop = mine ? (e: DragEvent) => e.preventDefault() : undefined;

  const battlefield = (
    <div
      className="relative min-h-[220px] flex-1 rounded-lg border border-border bg-surface/60"
      onDragOver={allowDrop}
      onDrop={dropTo('battlefield')}
    >
      {zoneCards('battlefield').map((c) => (
        <div key={c.id} className="absolute" style={{ left: `${c.position?.x ?? 50}%`, top: `${c.position?.y ?? 50}%` }}>
          <TableCard card={c} printing={c.printingId ? printings.get(c.printingId) : undefined} mine={mine} onClick={mine ? () => void run({ type: 'tapCard', instanceId: c.id, tapped: !c.tapped }) : undefined} />
        </div>
      ))}
      {pgs.zones.battlefield.length === 0 && <span className="absolute inset-0 flex items-center justify-center text-xs text-text-muted">{mine ? 'drag cards here' : 'battlefield'}</span>}
    </div>
  );

  const hand = (
    <div className="flex min-h-[calc(112px+1rem)] flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/60 p-2" onDragOver={allowDrop} onDrop={dropTo('hand')}>
      {zoneCards('hand').map((c) => (
        <TableCard key={c.id} card={mine ? c : { ...c, printingId: null }} printing={c.printingId ? printings.get(c.printingId) : undefined} mine={mine} />
      ))}
      {pgs.zones.hand.length === 0 && <span className="px-2 text-xs text-text-muted">empty hand</span>}
    </div>
  );

  const piles = (
    <div className="flex shrink-0 gap-2">
      <Pile label="Library" count={pgs.zones.library.length} onDragOver={allowDrop} onDrop={dropTo('library')}>
        {pgs.zones.library.length > 0 && <CardBack />}
      </Pile>
      <Pile label="Graveyard" count={pgs.zones.graveyard.length} onDragOver={allowDrop} onDrop={dropTo('graveyard')}>
        {topCard(zoneCards('graveyard'), printings)}
      </Pile>
      <Pile label="Exile" count={pgs.zones.exile.length} onDragOver={allowDrop} onDrop={dropTo('exile')}>
        {topCard(zoneCards('exile'), printings)}
      </Pile>
      {pgs.zones.command.length > 0 && (
        <Pile label="Command" count={pgs.zones.command.length} onDragOver={allowDrop} onDrop={dropTo('command')}>
          {topCard(zoneCards('command'), printings)}
        </Pile>
      )}
    </div>
  );

  return (
    <section className={`flex flex-col gap-2 ${flipped ? 'flex-col-reverse' : ''}`}>
      <div className="flex items-center gap-3 text-sm">
        <span className="font-medium">{player.displayName}{mine && ' (you)'}</span>
        <span className="text-text-muted">life {pgs.life} · hand {pgs.zones.hand.length} · library {pgs.zones.library.length}</span>
        {mine && (
          <span className="ml-auto flex gap-2">
            <Button variant="ghost" className="!py-1" onClick={() => void run({ type: 'draw', count: 1 })} disabled={pgs.zones.library.length === 0}>Draw (d)</Button>
            <Button variant="ghost" className="!py-1" onClick={() => void run({ type: 'untapAll' })}>Untap all (u)</Button>
            <Button variant="ghost" className="!py-1" onClick={() => void run({ type: 'shuffleLibrary' })}>Shuffle (s)</Button>
            <Button
              variant="ghost"
              className="!py-1"
              onClick={() => {
                const count = Math.max(0, pgs.zones.hand.length - 1);
                if (confirm(`Mulligan to ${count}?`)) void run({ type: 'mulligan', count });
              }}
            >
              Mulligan
            </Button>
          </span>
        )}
      </div>
      <div className="flex gap-3">
        {piles}
        {battlefield}
      </div>
      {hand}
    </section>
  );
}

function Pile({ label, count, children, ...drop }: { label: string; count: number; children?: ReactNode; onDragOver?: ((e: DragEvent) => void) | undefined; onDrop?: ((e: DragEvent<HTMLDivElement>) => void) | undefined }) {
  return (
    <div className="flex flex-col items-center gap-1 text-xs text-text-muted" {...drop}>
      <div className="flex items-center justify-center rounded-[4.5%] border border-dashed border-border" style={{ width: CARD_W, height: CARD_H }}>
        {children}
      </div>
      <span>{label} · {count}</span>
    </div>
  );
}

function topCard(cards: CardInstance[], printings: ReturnType<typeof useCards>) {
  const top = cards[cards.length - 1];
  if (!top) return null;
  return <TableCard card={top} printing={top.printingId ? printings.get(top.printingId) : undefined} mine={false} />;
}
