import type { CardInstance, CardPrinting, GameCommand, RoomState } from '@mtg/shared';
import type { DragEvent, MouseEvent } from 'react';
import { useCardSize } from './cardSize';
import { seatColor } from './PlayerStrip';
import { TableCard } from './TableCard';

type Run = (c: GameCommand) => Promise<void>;
const DRAG_MIME = 'text/instance-ids';

/**
 * The shared stack, overlaid on the middle of the table across the hairline.
 * Cards run left→right in cast order; the rightmost is the top of the stack.
 * Anyone can drop their own cards here; each is edged in its owner's colour.
 */
export function StackZone({ state, meId, printings, run, onCardMenu, onCardDragStart }: {
  state: RoomState;
  meId: string;
  printings: Map<string, CardPrinting>;
  run: Run;
  onCardMenu: (card: CardInstance) => (e: MouseEvent) => void;
  onCardDragStart: (card: CardInstance) => (e: DragEvent) => void;
}) {
  const { w, h } = useCardSize();
  const game = state.game!;
  const cards = (game.stack ?? []).map((id) => game.cards[id]).filter((c): c is CardInstance => !!c);

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

  const empty = cards.length === 0;
  return (
    <div
      className={`absolute left-1/2 top-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-xl px-3 py-2 transition-colors ${empty ? 'border border-dashed border-white/15 bg-black/30 hover:border-white/40' : 'border border-white/15 bg-black/60 shadow-2xl backdrop-blur-sm'}`}
      style={empty ? { width: w + 24, height: Math.round(h * 0.45) } : { minHeight: h + 28 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      title="The stack — drop a spell here while it is being cast"
    >
      {empty ? (
        <span className="w-full text-center text-[10px] uppercase tracking-wider text-white/40">stack</span>
      ) : (
        <>
          <span className="shrink-0 self-start text-[10px] uppercase tracking-wider text-white/50">stack · {cards.length}</span>
          {cards.map((c, i) => {
            const mine = c.controllerId === meId;
            const seat = state.players[c.ownerId]?.seat ?? 0;
            const top = i === cards.length - 1;
            return (
              <div key={c.id} className="relative shrink-0 rounded-[4.5%]" style={{ boxShadow: `0 0 0 2px ${seatColor(seat)}`, marginLeft: i === 0 ? 0 : -Math.round(w * 0.35), zIndex: i }}>
                <TableCard card={c} printing={c.printingId ? printings.get(c.printingId) : undefined} mine={mine} onContextMenu={mine ? onCardMenu(c) : undefined} onDragStart={mine ? onCardDragStart(c) : undefined} />
                {top && <span className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-black/80 px-1 text-[9px] uppercase text-white/70">top</span>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
