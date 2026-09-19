import type { CardInstance } from '@mtg/shared';
import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { useCardSize } from './cardSize';

/**
 * Expanded view of a pile zone (graveyard, exile): the pile's top card stays
 * in place and the rest spread towards the battlefield, each offset only
 * vertically so every card's name line stays visible. No box, no scrolling —
 * the offset shrinks until the whole zone fits.
 */
export function ZoneBrowser({ cards, towards, renderCard, onClose }: {
  /** Zone order, bottom→top (last = top of the pile). */
  cards: CardInstance[];
  /** Which way the battlefield is from the pile. */
  towards: 'up' | 'down';
  renderCard: (card: CardInstance) => ReactNode;
  onClose: () => void;
}) {
  const { w, h } = useCardSize();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onClick = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [onClose]);

  const n = cards.length;
  const maxH = typeof window === 'undefined' ? h * 4 : window.innerHeight * 0.72;
  const dy = n > 1 ? Math.min(Math.round(h * 0.13), Math.max(Math.round(h * 0.04), Math.floor((maxH - h) / (n - 1)))) : 0;
  const height = h + (n - 1) * dy;
  // k = 0 is the pile's top card, sitting exactly over the pile; higher k spreads away from it.
  // Names are on the card's top edge: spreading up, the lower card is above (covers the upper card's
  // bottom); spreading down, the lower card must be on top so the upper card's name stays visible.
  const fromTop = [...cards].reverse();
  const up = towards === 'up';

  return (
    <div className={`absolute left-0 z-50 ${up ? 'bottom-0' : 'top-0'}`} style={{ width: w, height }} onMouseDown={(e) => e.stopPropagation()}>
      {fromTop.map((c, k) => (
        <div key={c.id} className="absolute left-0 hover:z-[100]" style={{ [up ? 'bottom' : 'top']: k * dy, zIndex: up ? n - k : k + 1 }}>
          {renderCard(c)}
        </div>
      ))}
      <button
        type="button"
        onClick={onClose}
        className={`absolute left-1/2 z-[110] -translate-x-1/2 chip chip--pill chip--clickable ${up ? '-top-2' : '-bottom-2'}`}
        style={{ '--chip-bg': 'var(--chip-solid-neutral-bg)', '--chip-fg': 'var(--chip-solid-neutral-fg)', '--chip-bd': 'var(--chip-solid-neutral-bd)', '--chip-hover': 'var(--chip-solid-neutral-hover)' } as CSSProperties}
        title="Collapse"
      >
        {up ? '▼' : '▲'}
      </button>
    </div>
  );
}
