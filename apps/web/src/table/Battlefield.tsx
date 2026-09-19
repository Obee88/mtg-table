import type { CardInstance } from '@mtg/shared';
import { useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useCardSize } from './cardSize';

export interface Slot {
  col: number;
  /** Pile members bottom→top; attachments of a member are tucked behind it. */
  cards: CardInstance[];
  attachments: CardInstance[];
}

/** Groups a player's battlefield into rows of slots (piles), in column order. */
export function layoutRows(cards: CardInstance[], all: Record<string, CardInstance>, rowCount = 2): Slot[][] {
  const rows: Map<number, Slot>[] = Array.from({ length: rowCount }, () => new Map());
  const hostOf = (c: CardInstance): CardInstance => {
    let cur = c;
    for (let i = 0; i < 5 && cur.attachedTo && all[cur.attachedTo]; i++) cur = all[cur.attachedTo]!;
    return cur;
  };
  for (const c of cards) {
    const host = hostOf(c);
    const pos = host.position ?? { row: 0, col: 0 };
    const row = rows[Math.min(rowCount - 1, Math.max(0, pos.row))]!;
    const slot = row.get(pos.col) ?? { col: pos.col, cards: [], attachments: [] };
    if (host === c) slot.cards.push(c);
    else slot.attachments.push(c);
    row.set(pos.col, slot);
  }
  return rows.map((row) => [...row.values()].sort((a, b) => a.col - b.col));
}

/** Where a drop at `x` (px, relative to the row) lands: onto a pile, or between two columns. */
export function dropSlot(slots: Slot[], x: number, cardW: number, gap: number, overlap: number): { row?: undefined; col: number; pile: boolean } {
  const step = cardW + gap - overlap;
  const idx = Math.floor(x / step);
  const within = x - idx * step;
  if (slots.length === 0) return { col: 0, pile: false };
  if (idx >= slots.length) return { col: slots[slots.length - 1]!.col + 1, pile: false };
  const target = slots[idx]!;
  // The middle 60% of a card means "join this pile"; the edges mean "insert beside it".
  if (within > cardW * 0.2 && within < cardW * 0.8) return { col: target.col, pile: true };
  if (within <= cardW * 0.2) {
    const prev = slots[idx - 1];
    return { col: prev ? (prev.col + target.col) / 2 : target.col - 1, pile: false };
  }
  const next = slots[idx + 1];
  return { col: next ? (target.col + next.col) / 2 : target.col + 1, pile: false };
}

const GAP = 8;
const PILE_STEP = 22;

/**
 * One battlefield row: slots left to right; piles stack upward with an
 * offset; cards overlap when the row is fuller than the width allows.
 */
export function BattlefieldRow({ slots, renderCard, onDrop, onDragOver, children }: {
  slots: Slot[];
  renderCard: (card: CardInstance, opts: { inPile: boolean; index: number }) => ReactNode;
  onDrop?: ((e: DragEvent<HTMLDivElement>, geometry: { cardW: number; gap: number; overlap: number }) => void) | undefined;
  onDragOver?: ((e: DragEvent) => void) | undefined;
  children?: ReactNode;
}) {
  const { w, h } = useCardSize();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const n = slots.length;
  const needed = n * w + Math.max(0, n - 1) * GAP;
  const overlap = n > 1 && width > 0 && needed > width ? Math.min(w * 0.7, (needed - width) / (n - 1) + GAP) : 0;
  const tallest = Math.max(1, ...slots.map((s) => s.cards.length));

  return (
    <div
      ref={ref}
      className="relative flex min-w-0 items-end px-2"
      style={{ height: h + (tallest - 1) * PILE_STEP + 8 }}
      onDragOver={onDragOver}
      onDrop={onDrop ? (e) => onDrop(e, { cardW: w, gap: GAP, overlap }) : undefined}
    >
      {slots.map((slot, i) => (
        <div key={slot.col} className="relative shrink-0 transition-[margin] duration-150" style={{ width: w, height: h + (slot.cards.length - 1) * PILE_STEP, marginLeft: i === 0 ? 0 : GAP - overlap, zIndex: i }}>
          {slot.attachments.map((a, k) => (
            <div key={a.id} className="absolute" style={{ left: (k + 1) * Math.round(w * 0.18), top: (k + 1) * Math.round(w * 0.18), zIndex: 0 }}>
              {renderCard(a, { inPile: true, index: -1 })}
            </div>
          ))}
          {slot.cards.map((c, k) => (
            <div key={c.id} className="absolute left-0" style={{ bottom: k * PILE_STEP, zIndex: k + 1 }}>
              {renderCard(c, { inPile: slot.cards.length > 1, index: k })}
            </div>
          ))}
        </div>
      ))}
      {children}
    </div>
  );
}
