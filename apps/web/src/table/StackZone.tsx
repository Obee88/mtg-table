import type { CardInstance, CardPrinting, GameCommand, RoomState } from '@mtg/shared';
import type { DragEvent, MouseEvent } from 'react';
import { useCardSize } from './cardSize';
import { seatColor } from './PlayerStrip';
import { TableCard } from './TableCard';

type Run = (c: GameCommand) => Promise<void>;
const DRAG_MIME = 'text/instance-ids';

/**
 * The shared stack: a full-height column beside the battlefield. Newest (top
 * of stack) at the top. Anyone can drop their own cards here; each card is
 * edged in its owner's seat colour.
 */
export function StackZone({ state, meId, printings, run, onCardMenu, onCardDragStart }: {
  state: RoomState;
  meId: string;
  printings: Map<string, CardPrinting>;
  run: Run;
  onCardMenu: (card: CardInstance) => (e: MouseEvent) => void;
  onCardDragStart: (card: CardInstance) => (e: DragEvent) => void;
}) {
  const { w } = useCardSize();
  const game = state.game!;
  const order = [...(game.stack ?? [])].reverse();
  const cards = order.map((id) => game.cards[id]).filter((c): c is CardInstance => !!c);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    let ids: string[];
    try {
      ids = JSON.parse(e.dataTransfer.getData(DRAG_MIME) || '[]') as string[];
    } catch {
      ids = [];
    }
    const mine = ids.filter((id) => game.cards[id]?.controllerId === meId);
    if (mine.length > 0) void run({ type: 'moveCards', instanceIds: mine, to: 'stack' });
  };

  return (
    <div
      className="flex h-full min-h-0 shrink-0 flex-col items-center gap-2 overflow-hidden border-l border-white/10 bg-black/20 px-2 py-2"
      style={{ width: w + 24 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      title="The stack"
    >
      <span className="shrink-0 text-[10px] uppercase tracking-wider text-white/35">stack{cards.length > 0 && ` · ${cards.length}`}</span>
      {cards.map((c, i) => {
        const mine = c.controllerId === meId;
        const seat = state.players[c.ownerId]?.seat ?? 0;
        return (
          <div key={c.id} className="relative shrink-0 rounded-[4.5%]" style={{ boxShadow: `0 0 0 2px ${seatColor(seat)}` }}>
            <TableCard card={c} printing={c.printingId ? printings.get(c.printingId) : undefined} mine={mine} onContextMenu={mine ? onCardMenu(c) : undefined} onDragStart={mine ? onCardDragStart(c) : undefined} />
            {i === 0 && <span className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-black/80 px-1 text-[9px] uppercase text-white/70">top</span>}
          </div>
        );
      })}
      {cards.length === 0 && <span className="mt-6 px-1 text-center text-[11px] leading-snug text-white/25">drop a spell here while it's being cast</span>}
    </div>
  );
}
