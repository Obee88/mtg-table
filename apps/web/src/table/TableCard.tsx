import type { CardInstance, CardPrinting } from '@mtg/shared';
import type { DragEvent } from 'react';
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

export function TableCard({ card, printing, mine, onClick }: { card: CardInstance; printing: CardPrinting | undefined; mine: boolean; onClick?: (() => void) | undefined }) {
  const src = printing ? imageFor(printing, 'small') : null;
  const preview = useCardPreview(printing && !card.faceDown ? imageFor(printing, 'normal') : null);
  const hidden = card.printingId === null || card.faceDown;

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('text/instance-id', card.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable={mine}
      onDragStart={mine ? onDragStart : undefined}
      onClick={onClick}
      {...preview}
      className={`select-none transition-transform duration-150 ${mine ? 'cursor-grab active:cursor-grabbing' : ''} ${card.tapped ? 'rotate-90' : ''}`}
      style={{ width: CARD_W, height: CARD_H }}
      title={printing?.name}
    >
      {hidden || !src ? (
        <CardBack />
      ) : (
        <img src={src} alt={printing?.name ?? ''} draggable={false} className="h-full w-full rounded-[4.5%] object-cover shadow-md" />
      )}
    </div>
  );
}
