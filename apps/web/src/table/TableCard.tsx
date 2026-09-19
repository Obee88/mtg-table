import type { CardInstance, CardPrinting } from '@mtg/shared';
import type { DragEvent, MouseEvent } from 'react';
import { imageFor } from '../cards/CardImage';
import { useCardPreview } from '../cards/CardPreview';
import { CounterBadge, LoyaltyBadge, PTBadge, Tag, type Adjust } from './badges';
import { useCardSize } from './cardSize';
import { counterView, GENERAL_COUNTER } from './counters';
import { useCounterKeyHeld } from './useModifier';

/** The official card back, served by Scryfall; the gradient shows until it loads. */
const CARD_BACK = {
  small: 'https://backs.scryfall.io/small/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg',
  normal: 'https://backs.scryfall.io/normal/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg',
};

export function CardBack({ className = '' }: { className?: string }) {
  const { w, h } = useCardSize();
  return (
    <div className={`overflow-hidden rounded-[4.5%] bg-[radial-gradient(circle_at_30%_30%,#3a2f6b,#1a1533_70%)] ${className}`} style={{ width: w, height: h }}>
      <img src={w > 120 ? CARD_BACK.normal : CARD_BACK.small} alt="" draggable={false} className="h-full w-full object-cover" />
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

export function TableCard({ card, printing, mine, selected = false, onClick, onContextMenu, onDragStart: onDragStartProp, onAdjustCounter }: {
  card: CardInstance;
  printing: CardPrinting | undefined;
  mine: boolean;
  selected?: boolean;
  onClick?: ((e: MouseEvent) => void) | undefined;
  onContextMenu?: ((e: MouseEvent) => void) | undefined;
  /** Override the drag payload (multi-select drags). */
  onDragStart?: ((e: DragEvent) => void) | undefined;
  /** Enables hold-c adjustment of counter badges (own cards): click +1, right-click −1. */
  onAdjustCounter?: ((kind: string, delta: number) => void) | undefined;
}) {
  const { w, h } = useCardSize();
  const counterMode = useCounterKeyHeld();
  const adjust = (inc: [string, number], dec: [string, number]): Adjust | undefined =>
    onAdjustCounter ? { active: counterMode, onInc: () => onAdjustCounter(...inc), onDec: () => onAdjustCounter(...dec) } : undefined;
  // Larger cards deserve the sharper image.
  const src = faceImage(card, printing, w > 120 ? 'normal' : 'small');
  const hidden = card.printingId === null || card.faceDown;
  const preview = useCardPreview(printing && !hidden ? faceImage(card, printing, 'normal') : mine && printing ? faceImage(card, printing, 'normal') : null);

  const onDragStart = (e: DragEvent) => {
    if (onDragStartProp) return onDragStartProp(e);
    e.dataTransfer.setData('text/instance-ids', JSON.stringify([card.id]));
    e.dataTransfer.effectAllowed = 'move';
  };

  const view = counterView(card.counters);
  const label = card.customName ?? (hidden ? null : printing?.name);
  const revealed = revealedToOthers(card);
  const badge = w > 120 ? 'text-xs' : 'text-[10px]';
  const inset = Math.round(w * 0.06);

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
            <span className="absolute inset-x-1 flex justify-center" style={{ bottom: inset + 2 }}>
              <Tag cardW={w}>{card.customName}</Tag>
            </span>
          )}
          {card.faceDown && mine && printing && (
            <span className="absolute left-1 top-1"><Tag cardW={w}>{printing.name}</Tag></span>
          )}
        </div>
      ) : (
        <img key={card.zone} src={src} alt={label ?? ''} draggable={false} className={`h-full w-full rounded-[4.5%] object-cover ${revealed ? 'card-revealed' : ''}`} />
      )}
      {card.isToken && <span className={`absolute left-0.5 top-0.5 rounded bg-accent px-1 font-semibold text-bg ${badge}`} title="token">T</span>}
      {revealed && <span className={`absolute left-0.5 bottom-5 rounded bg-success px-1 font-semibold text-bg ${badge}`} title="revealed">👁</span>}
      {view.pt && <PTBadge power={view.pt.power} toughness={view.pt.toughness} cardW={w} adjust={adjust(['+1/+1', 1], ['-1/-1', 1])} />}
      {view.loyalty !== null && <LoyaltyBadge value={view.loyalty} cardW={w} adjust={adjust(['loyalty', 1], ['loyalty', -1])} />}
      {view.other.length > 0 && (
        <div className="absolute flex max-w-[80%] flex-col items-start gap-0.5" style={{ left: inset, top: inset + (card.isToken ? Math.round(w * 0.14) : 0) }}>
          {view.other.map(([kind, value]) => (
            kind === GENERAL_COUNTER ? (
              <CounterBadge key={kind} value={value} cardW={w} adjust={adjust([kind, 1], [kind, -1])} />
            ) : (
              <Tag key={kind} cardW={w} adjust={adjust([kind, 1], [kind, -1])}>
                <span className="tabular-nums font-bold">{value}</span>
                <span className="opacity-80">{kind}</span>
              </Tag>
            )
          ))}
        </div>
      )}
      {card.note && (
        <span className="absolute inset-x-1 flex justify-center" style={{ bottom: inset + 2 }}>
          <Tag cardW={w} tone="accent">{card.note}</Tag>
        </span>
      )}
    </div>
  );
}

/** True when a normally hidden card is currently revealed beyond its owner. */
function revealedToOthers(card: CardInstance): boolean {
  if (card.zone !== 'hand' && card.zone !== 'library' && !card.faceDown) return false;
  return card.visibleTo === 'all' || (Array.isArray(card.visibleTo) && card.visibleTo.length > 1);
}
