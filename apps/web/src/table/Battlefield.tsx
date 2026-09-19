import type { CardInstance } from '@mtg/shared';
import { useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useCardSize } from './cardSize';

export interface Slot {
  /** Absolute column index; empty columns between slots stay empty. */
  col: number;
  /** Pile members bottom→top; attachments of a member are tucked behind it. */
  cards: CardInstance[];
  attachments: CardInstance[];
}

/** Groups a player's battlefield into rows of slots (piles) keyed by absolute column. */
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
    const col = Math.max(0, Math.round(pos.col));
    const row = rows[Math.min(rowCount - 1, Math.max(0, pos.row))]!;
    const slot = row.get(col) ?? { col, cards: [], attachments: [] };
    if (host === c) slot.cards.push(c);
    else slot.attachments.push(c);
    row.set(col, slot);
  }
  return rows.map((row) => [...row.values()].sort((a, b) => a.col - b.col));
}

export const GAP = 12;
/** Pile members shift down and right so the card beneath stays visible at its top and left. */
export const PILE_DX = 0.22;
export const PILE_DY = 0.16;

/** Column pitch for a row: shrinks (cards overlap) only when the used columns do not fit the width. */
export function columnStep(slots: Slot[], width: number, cardW: number): number {
  const full = cardW + GAP;
  const last = slots.length ? slots[slots.length - 1]!.col : 0;
  const needed = (last + 1) * full;
  if (width <= 0 || needed <= width || last === 0) return full;
  return Math.max(cardW * 0.3, (width - cardW) / last);
}

/** Where a drop at `x` (px, relative to the row) lands: the column under the pointer; a pile if occupied. */
export function dropSlot(slots: Slot[], x: number, step: number): { col: number; pile: boolean } {
  const col = Math.max(0, Math.floor(x / step));
  return { col, pile: slots.some((s) => s.col === col) };
}

/** Next free columns at or after `from`, for dropping several cards at once. */
export function freeColumns(slots: Slot[], from: number, count: number): number[] {
  const used = new Set(slots.map((s) => s.col));
  const out: number[] = [];
  for (let c = from; out.length < count; c++) if (!used.has(c)) out.push(c);
  return out;
}

/**
 * One battlefield row: slots at absolute columns; piles stack down-right;
 * columns compress (cards overlap) only when the row is wider than the space.
 */
export function BattlefieldRow({ slots, renderCard, onDrop, onDragOver, children }: {
  slots: Slot[];
  renderCard: (card: CardInstance, opts: { inPile: boolean; index: number }) => ReactNode;
  onDrop?: ((e: DragEvent<HTMLDivElement>, geometry: { step: number }) => void) | undefined;
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

  const step = columnStep(slots, width - 16, w);
  const dx = Math.round(w * PILE_DX);
  const dy = Math.round(h * PILE_DY);
  const tallest = Math.max(1, ...slots.map((s) => s.cards.length));

  return (
    <div
      ref={ref}
      className="relative min-w-0 px-2"
      style={{ height: h + (tallest - 1) * dy + 8 }}
      onDragOver={onDragOver}
      onDrop={onDrop ? (e) => onDrop(e, { step }) : undefined}
    >
      {slots.map((slot) => (
        <div key={slot.col} className="absolute top-1 transition-[left] duration-150" style={{ left: 8 + slot.col * step, width: w + (slot.cards.length - 1) * dx, height: h + (slot.cards.length - 1) * dy, zIndex: slot.col }}>
          {slot.attachments.map((a, k) => (
            <div key={a.id} className="absolute" style={{ left: (k + 1) * Math.round(w * 0.18), top: (k + 1) * Math.round(w * 0.18), zIndex: 0 }}>
              {renderCard(a, { inPile: true, index: -1 })}
            </div>
          ))}
          {slot.cards.map((c, k) => (
            <div key={c.id} className="absolute" style={{ left: k * dx, top: k * dy, zIndex: k + 1 }}>
              {renderCard(c, { inPile: slot.cards.length > 1, index: k })}
            </div>
          ))}
        </div>
      ))}
      {children}
    </div>
  );
}
