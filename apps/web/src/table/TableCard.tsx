import type { CardInstance, CardPrinting } from '@mtg/shared';
import type { DragEvent, MouseEvent } from 'react';
import { imageFor } from '../cards/CardImage';
import { useCardPreview } from '../cards/CardPreview';
import { useCardSize } from './cardSize';

export function CardBack({ className = '' }: { className?: string }) {
  const { w, h } = useCardSize();
  return (
    <div className={`rounded-[4.5%] border border-border bg-[radial-gradient(circle_at_30%_30%,#3a2f6b,#1a1533_70%)] ${className}`} style={{ width: w, height: h }}>
      <div className="m-[10%] h-[80%] rounded-[6%] border border-white/10" />
    </div>
  );
}

/** Image for the face currently showing (front, or back when transformed). */
export function faceImage(card: CardInstance, printing: CardPrinting | undefined, size: 'small' | 'normal'): string | null {
  if (!printing) return null;
  const back = card.transformed ? printing.faces[1] : undefined;
  if (back?.imageUris) return back.imageUris[size] ?? back.imageUris.normal ?? null;
  return imageFor(printing, size);
}

export function TableCard({ card, printing, mine, selected = false, onClick, onContextMenu, onDragStart: onDragStartProp }: {
  card: CardInstance;
  printing: CardPrinting | undefined;
  mine: boolean;
  selected?: boolean;
  onClick?: ((e: MouseEvent) => void) | undefined;
  onContextMenu?: ((e: MouseEvent) => void) | undefined;
  /** Override the drag payload (multi-select drags). */
  onDragStart?: ((e: DragEvent) => void) | undefined;
}) {
  const { w, h } = useCardSize();
  // Larger cards deserve the sharper image.
  const src = faceImage(card, printing, w > 120 ? 'normal' : 'small');
  const hidden = card.printingId === null || card.faceDown;
  const preview = useCardPreview(printing && !hidden ? faceImage(card, printing, 'normal') : mine && printing ? faceImage(card, printing, 'normal') : null);

  const onDragStart = (e: DragEvent) => {
    if (onDragStartProp) return onDragStartProp(e);
    e.dataTransfer.setData('text/instance-ids', JSON.stringify([card.id]));
    e.dataTransfer.effectAllowed = 'move';
  };

  const counters = Object.entries(card.counters);
  const label = card.customName ?? (hidden ? null : printing?.name);
  const revealed = revealedToOthers(card);
  const badge = w > 120 ? 'text-xs' : 'text-[10px]';

  return (
    <div
      draggable={mine}
      onDragStart={mine ? onDragStart : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...preview}
      data-instance-id={card.id}
      className={`card-enter card-shadow card-lift relative select-none rounded-[4.5%] transition-[transform,box-shadow] duration-150 ${mine ? 'cursor-grab active:cursor-grabbing' : ''} ${card.tapped ? 'rotate-90' : ''} ${card.flipped ? 'rotate-180' : ''} ${selected ? 'rounded-[4.5%] ring-2 ring-accent ring-offset-1 ring-offset-bg' : ''}`}
      style={{ width: w, height: h }}
      title={label ?? undefined}
    >
      {hidden || !src ? (
        <div className="relative">
          <CardBack />
          {card.customName && (
            <span className={`absolute inset-x-1 bottom-1 truncate rounded bg-black/70 px-1 text-center text-text ${badge}`}>{card.customName}</span>
          )}
          {card.faceDown && mine && printing && (
            <span className={`absolute left-1 top-1 rounded bg-black/70 px-1 text-text-muted ${badge}`}>{printing.name}</span>
          )}
        </div>
      ) : (
        <img key={card.zone} src={src} alt={label ?? ''} draggable={false} className={`h-full w-full rounded-[4.5%] object-cover ${revealed ? 'card-revealed' : ''}`} />
      )}
      {card.isToken && <span className={`absolute right-0.5 top-0.5 rounded bg-accent px-1 font-semibold text-bg ${badge}`}>T</span>}
      {revealed && <span className={`absolute right-0.5 bottom-5 rounded bg-success px-1 font-semibold text-bg ${badge}`} title="revealed">👁</span>}
      {counters.length > 0 && (
        <div className="absolute left-0.5 top-0.5 flex flex-col gap-0.5">
          {counters.map(([kind, value]) => (
            <span key={kind} className={`rounded bg-black/80 px-1 font-semibold text-text shadow ${badge}`}>{value} {kind}</span>
          ))}
        </div>
      )}
      {card.note && <span className={`absolute inset-x-0.5 bottom-0.5 truncate rounded bg-accent/90 px-1 text-center text-bg ${badge}`}>{card.note}</span>}
    </div>
  );
}

/** True when a normally hidden card is currently revealed beyond its owner. */
function revealedToOthers(card: CardInstance): boolean {
  if (card.zone !== 'hand' && card.zone !== 'library' && !card.faceDown) return false;
  return card.visibleTo === 'all' || (Array.isArray(card.visibleTo) && card.visibleTo.length > 1);
}
