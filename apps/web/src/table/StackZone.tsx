import type { CardInstance, CardPrinting, GameCommand, RoomState } from '@mtg/shared';
import type { DragEvent, MouseEvent } from 'react';
import { useCardSize } from './cardSize';
import { seatColor } from './PlayerStrip';
import { TableCard } from './TableCard';

type Run = (c: GameCommand) => Promise<void>;
const DRAG_MIME = 'text/instance-ids';

/**
 * The shared stack: a narrow, tall overlay at the right edge of the battlefield
 * (beside the log), centred on the hairline. Cards stack vertically, newest
 * (top of stack) at the top, overlapping more as the stack grows. Anyone can
 * drop their own cards here; each is edged in its owner's colour.
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
  const cards = (game.stack ?? []).map((id) => game.cards[id]).filter((c): c is CardInstance => !!c).reverse();

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
  // Fit the pile into ~70% of the table height by overlapping cards vertically.
  const maxHeight = typeof window === 'undefined' ? h * 4 : window.innerHeight * 0.7;
  const step = cards.length > 1 ? Math.max(Math.round(h * 0.18), Math.min(h + 6, (maxHeight - h) / (cards.length - 1))) : 0;

  return (
    <div
      className={`absolute right-2 top-1/2 z-40 flex -translate-y-1/2 flex-col items-center rounded-xl px-2 pb-2 pt-1 transition-colors ${empty ? 'border border-dashed border-white/15 bg-black/30 hover:border-white/40' : 'border border-white/15 bg-black/60 shadow-2xl backdrop-blur-sm'}`}
      style={{ width: w + 20, minHeight: empty ? Math.round(h * 0.9) : undefined }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      title="The stack — drop a spell here while it is being cast"
    >
      <span className="mb-1 shrink-0 text-[10px] uppercase tracking-wider text-white/45">stack{!empty && ` · ${cards.length}`}</span>
      {empty ? (
        <span className="flex flex-1 items-center px-1 text-center text-[10px] leading-snug text-white/25">drop a spell here</span>
      ) : (
        <div className="relative" style={{ width: w, height: h + step * (cards.length - 1) }}>
          {cards.map((c, i) => {
            const mine = c.controllerId === meId;
            const seat = state.players[c.ownerId]?.seat ?? 0;
            return (
              <div key={c.id} className="absolute left-0 rounded-[4.5%] transition-[top] duration-150" style={{ top: i * step, zIndex: cards.length - i, boxShadow: `0 0 0 2px ${seatColor(seat)}` }}>
                <TableCard card={c} printing={c.printingId ? printings.get(c.printingId) : undefined} mine={mine} onContextMenu={mine ? onCardMenu(c) : undefined} onDragStart={mine ? onCardDragStart(c) : undefined} />
                {i === 0 && <span className="pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded bg-black/80 px-1 text-[9px] uppercase text-white/70">top</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
