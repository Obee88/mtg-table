import type { CardInstance, CardPrinting } from '@mtg/shared';
import type { CSSProperties, DragEvent, MouseEvent, PointerEvent } from 'react';
import { isTouchPointer, startTouchGesture } from './touch';
import { imageFor } from '../cards/CardImage';
import { useCardPreview } from '../cards/CardPreview';
import { Chip } from '../components/Chip';
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

export function TableCard({ card, printing, mine, selected = false, onClick, onContextMenu, onDragStart: onDragStartProp, onAdjustCounter, groupCount, targetColors = [] }: {
  /** Seat colours of the players pointing at this card, if any. */
  targetColors?: string[];
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
  /** Rendered as a stand-in for this many identical tokens. */
  groupCount?: number | undefined;
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
  /** The ids a drag of this card carries (the selection, when it is part of one), via the same handler. */
  const dragIds = (): string[] => {
    const data: Record<string, string> = {};
    onDragStart({ dataTransfer: { setData: (k: string, v: string) => { data[k] = v; }, effectAllowed: 'move' } } as unknown as DragEvent);
    try {
      return JSON.parse(data['text/instance-ids'] ?? '[]') as string[];
    } catch {
      return [card.id];
    }
  };
  // Touch: hold for the menu, move to drag; a click right after a long press is ignored.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!isTouchPointer(e) || (!mine && !onContextMenu)) return;
    startTouchGesture(e.currentTarget, e, { ids: dragIds, canDrag: mine, canMenu: !!onContextMenu });
  };
  const onClickGuarded = onClick
    ? (e: MouseEvent) => {
        const el = e.currentTarget as HTMLElement;
        if (el.dataset.suppressClick) {
          delete el.dataset.suppressClick;
          return;
        }
        onClick(e);
      }
    : undefined;

  const view = counterView(card.counters);
  const label = card.customName ?? (hidden ? null : printing?.name);
  const revealed = revealedToOthers(card);
  const inset = Math.round(w * 0.06);

  return (
    <div
      draggable={mine}
      onDragStart={mine ? onDragStart : undefined}
      onPointerDown={onPointerDown}
      onClick={onClickGuarded}
      onContextMenu={onContextMenu}
      {...preview}
      data-instance-id={card.id}
      className={`card-enter card-shadow card-lift relative select-none touch-none rounded-[4.5%] transition-[transform,box-shadow] duration-150 ${mine ? 'cursor-grab active:cursor-grabbing' : ''} ${card.tapped ? 'rotate-90' : ''} ${card.flipped ? 'rotate-180' : ''} ${selected ? 'rounded-[4.5%] ring-2 ring-accent ring-offset-1 ring-offset-bg' : ''} ${targetColors.length > 0 ? 'card-targeted' : ''}`}
      style={{ width: w, height: h, ...(targetColors.length > 0 ? { '--target-color': targetColors[0] } as CSSProperties : {}) }}
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
      {targetColors.length > 0 && (
        <span className="absolute -top-1 left-1/2 flex -translate-x-1/2 gap-0.5" title="targeted">
          {targetColors.map((c, i) => <span key={i} className="h-2.5 w-2.5 rounded-full border border-black/50" style={{ background: c }} />)}
        </span>
      )}
      {card.noUntap && (
        <Chip type="warning" shape="pill" className="absolute right-0.5 top-0.5 shadow" title={card.noUntap === 'always' ? 'Does not untap' : `Skips ${card.noUntap} untap step${card.noUntap === 1 ? '' : 's'}`}>
          {card.noUntap === 'always' ? '∅' : `∅${card.noUntap}`}
        </Chip>
      )}
      {card.isToken && !groupCount && <Chip type="primary" shape="pill" className="absolute left-0.5 top-0.5 shadow" title="token">T</Chip>}
      {groupCount && groupCount > 1 && <Chip type="primary" size="medium" className="absolute left-1 top-1 shadow-lg" title={`${groupCount} identical tokens`}>×{groupCount}</Chip>}
      {revealed && <Chip type="success" shape="pill" className="absolute left-0.5 bottom-5 shadow" title="revealed">👁</Chip>}
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
          <Tag cardW={w} type="warning">{card.note}</Tag>
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
