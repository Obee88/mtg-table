import type { CardInstance } from '@mtg/shared';
import { useEffect, type ReactNode } from 'react';
import { useCardSize } from './cardSize';

/**
 * Expanded view of a pile zone (graveyard, exile): every card, stacked with
 * only a vertical offset so each card's name line stays visible. Anchored to
 * the pile and growing towards the battlefield.
 */
export function ZoneBrowser({ cards, towards, renderCard, onClose }: {
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
  const maxH = typeof window === 'undefined' ? h * 4 : window.innerHeight * 0.75;
  // Enough of each card to read its name; squeeze when the zone is large.
  const dy = n > 1 ? Math.min(Math.round(h * 0.13), Math.max(Math.round(h * 0.07), (maxH - h) / (n - 1))) : 0;
  // Newest (top of the pile) nearest the pile; the stack grows towards the battlefield.
  const ordered = towards === 'up' ? [...cards].reverse() : cards;

  return (
    <div
      className={`absolute left-0 z-50 rounded-lg border border-white/15 bg-black/80 p-2 shadow-2xl backdrop-blur-sm ${towards === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'}`}
      style={{ width: w + 16, maxHeight: maxH + 16, overflowY: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="relative" style={{ width: w, height: h + (n - 1) * dy }}>
        {ordered.map((c, i) => (
          <div key={c.id} className="absolute left-0 hover:z-[100]" style={{ top: i * dy, zIndex: i + 1 }}>
            {renderCard(c)}
          </div>
        ))}
      </div>
    </div>
  );
}
