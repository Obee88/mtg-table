import type { CardInstance, CardPrinting } from '@mtg/shared';
import type { DragEvent, MouseEvent } from 'react';
import { imageFor } from '../cards/CardImage';
import { useCardPreview } from '../cards/CardPreview';

export const CARD_W = 80;
export const CARD_H = Math.round(CARD_W * 7 / 5);

export function CardBack({ className = '' }: { className?: string }) {
  return (
    <div className={`rounded-[4.5%] border border-border bg-[radial-gradient(circle_at_30%_30%,#3a2f6b,#1a1533_70%)] ${className}`} style={{ width: CARD_W, height: CARD_H }}>
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

export function TableCard({ card, printing, mine, onClick, onContextMenu }: {
  card: CardInstance;
  printing: CardPrinting | undefined;
  mine: boolean;
  onClick?: (() => void) | undefined;
  onContextMenu?: ((e: MouseEvent) => void) | undefined;
}) {
  const src = faceImage(card, printing, 'small');
  const hidden = card.printingId === null || card.faceDown;
  const preview = useCardPreview(printing && !hidden ? faceImage(card, printing, 'normal') : mine && printing ? faceImage(card, printing, 'normal') : null);

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('text/instance-id', card.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const counters = Object.entries(card.counters);
  const label = card.customName ?? (hidden ? null : printing?.name);

  return (
    <div
      draggable={mine}
      onDragStart={mine ? onDragStart : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      {...preview}
      className={`relative select-none transition-transform duration-150 ${mine ? 'cursor-grab active:cursor-grabbing' : ''} ${card.tapped ? 'rotate-90' : ''} ${card.flipped ? 'rotate-180' : ''}`}
      style={{ width: CARD_W, height: CARD_H }}
      title={label ?? undefined}
    >
      {hidden || !src ? (
        <div className="relative">
          <CardBack />
          {card.customName && (
            <span className="absolute inset-x-1 bottom-1 truncate rounded bg-black/70 px-1 text-center text-[10px] text-text">{card.customName}</span>
          )}
          {card.faceDown && mine && printing && (
            <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] text-text-muted">{printing.name}</span>
          )}
        </div>
      ) : (
        <img src={src} alt={label ?? ''} draggable={false} className="h-full w-full rounded-[4.5%] object-cover shadow-md" />
      )}
      {card.isToken && <span className="absolute right-0.5 top-0.5 rounded bg-accent px-1 text-[9px] font-semibold text-bg">T</span>}
      {counters.length > 0 && (
        <div className="absolute left-0.5 top-0.5 flex flex-col gap-0.5">
          {counters.map(([kind, value]) => (
            <span key={kind} className="rounded bg-black/80 px-1 text-[10px] font-semibold text-text shadow">{value} {kind}</span>
          ))}
        </div>
      )}
      {card.note && <span className="absolute inset-x-0.5 bottom-0.5 truncate rounded bg-accent/90 px-1 text-center text-[9px] text-bg">{card.note}</span>}
    </div>
  );
}
