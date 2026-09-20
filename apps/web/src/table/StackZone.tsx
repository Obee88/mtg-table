import type { CardInstance, CardPrinting, GameCommand, RoomState } from '@mtg/shared';
import type { DragEvent, MouseEvent } from 'react';
import { PILE_DX, PILE_DY } from './Battlefield';
import { useCardSize } from './cardSize';
import { playerColor } from './PlayerStrip';
import { Chip } from '../components/Chip';
import { TableCard } from './TableCard';

type Run = (c: GameCommand) => Promise<void>;
const DRAG_MIME = 'text/instance-ids';
const PAD = 14;

/**
 * The shared stack: an overlay at the right edge of the battlefield beside the
 * log, centred on the hairline. Spells pile like battlefield piles (each one
 * down and to the right of the one below); the panel widens with the pile.
 * Anyone can drop their own cards here; each is edged in its owner's colour.
 */
export function StackZone({ state, meId, printings, run, onCardMenu, onCardDragStart, onCardClick, isSelected = () => false }: {
  state: RoomState;
  meId: string;
  printings: Map<string, CardPrinting>;
  run: Run;
  onCardMenu: (card: CardInstance) => (e: MouseEvent) => void;
  onCardDragStart: (card: CardInstance) => (e: DragEvent) => void;
  /** Click selects (so the g / e / h / b shortcuts and the selection menu apply). */
  onCardClick?: ((card: CardInstance, e: MouseEvent) => void) | undefined;
  isSelected?: ((id: string) => boolean) | undefined;
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

  const n = cards.length;
  const maxH = typeof window === 'undefined' ? h * 4 : window.innerHeight * 0.7;
  const dy = n > 1 ? Math.min(Math.round(h * PILE_DY), Math.max(Math.round(h * 0.08), (maxH - h) / (n - 1))) : 0;
  const dx = Math.round(w * PILE_DX);
  const pileW = w + Math.max(0, n - 1) * dx;
  const pileH = h + Math.max(0, n - 1) * dy;

  return (
    <div
      className={`absolute right-2 top-1/2 z-40 flex -translate-y-1/2 flex-col items-start rounded-xl transition-[width,background-color] duration-150 ${n === 0 ? 'border border-dashed border-white/15 bg-black/30 hover:border-white/40' : 'border border-white/15 bg-black/60 shadow-2xl backdrop-blur-sm'}`}
      style={{ width: pileW + PAD * 2, padding: `${PAD - 6}px ${PAD}px ${PAD}px`, minHeight: n === 0 ? Math.round(h * 0.9) : undefined }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      title="The stack — drop a spell here while it is being cast"
    >
      <Chip type={n > 0 ? 'primary' : 'neutral'} className="mb-1.5 self-center uppercase tracking-wider">stack{n > 0 && ` · ${n}`}</Chip>
      {n === 0 ? (
        <span className="flex w-full flex-1 items-center justify-center px-1 text-center text-[10px] leading-snug text-white/25">drop a spell here</span>
      ) : (
        <div className="relative" style={{ width: pileW, height: pileH, marginBottom: 22 }}>
          {cards.map((c, i) => {
            const mine = c.controllerId === meId;
            const owner = state.players[c.ownerId];

            const move = (to: 'battlefield' | 'graveyard' | 'exile') => (e: MouseEvent) => {
              e.stopPropagation();
              void run({ type: 'moveCard', instanceId: c.id, to });
            };
            return (
              <div key={c.id} className="group absolute rounded-[4.5%] transition-[top,left] duration-150" style={{ top: i * dy, left: i * dx, zIndex: i + 1, boxShadow: `0 0 0 2px ${owner ? playerColor(state, owner) : 'transparent'}` }}>
                <div onDoubleClick={mine ? move('battlefield') : undefined} title={mine ? 'Double-click to resolve onto the battlefield; drag or right-click for other zones' : undefined}>
                  <TableCard card={c} printing={c.printingId ? printings.get(c.printingId) : undefined} mine={mine} selected={isSelected(c.id)} onClick={mine && onCardClick ? (e) => onCardClick(c, e) : undefined} onContextMenu={mine ? onCardMenu(c) : undefined} onDragStart={mine ? onCardDragStart(c) : undefined} />
                </div>
                {mine && (
                  <div className="absolute inset-x-0 -bottom-1 z-10 flex translate-y-full justify-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button type="button" onClick={move('battlefield')} className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-bg shadow hover:bg-accent-hover" title="Resolve: put it onto the battlefield">Resolve</button>
                    <button type="button" onClick={move('graveyard')} className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white shadow hover:bg-black/90" title="To the graveyard (resolved instant/sorcery, countered)">Grave</button>
                    <button type="button" onClick={move('exile')} className="rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white shadow hover:bg-black/90" title="To exile">Exile</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
