import type { CardInstance } from '@mtg/shared';
import { useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useCardSize } from './cardSize';

export interface Slot {
  /** Absolute column index; empty columns between slots stay empty. */
  col: number;
  /** Pile members bottom→top. A card attached to another (legacy data) joins its host's pile. */
  cards: CardInstance[];
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
    const pos = normalizePosition(hostOf(c).position);
    const col = pos.col;
    const row = rows[Math.min(rowCount - 1, pos.row)]!;
    const slot = row.get(col) ?? { col, cards: [] };
    slot.cards.push(c);
    row.set(col, slot);
  }
  return rows.map((row) => [...row.values()].sort((a, b) => a.col - b.col));
}
/** Gap between columns: a tapped card overhangs its slot by 20% of its width on each side, so 40% keeps two tapped neighbours apart. */
export const gapFor = (cardW: number) => Math.round(cardW * 0.4);
/** Pile members shift down and right so the card beneath stays visible at its top and left. */
export const PILE_DX = 0.22;
export const PILE_DY = 0.16;

/** Column pitch for a row: shrinks (cards overlap) only when the used columns do not fit the width. */
export function columnStep(slots: Slot[], width: number, cardW: number): number {
  const full = cardW + gapFor(cardW);
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
export function BattlefieldRow({ row, slots, renderCard, onDrop, onDragOver, children }: {
  /** Row index, exposed as data-row for the battlefield drop handler. */
  row?: number;
  slots: Slot[];
  /** `group` lists every card of an identical-token pile rendered as one card. */
  renderCard: (card: CardInstance, opts: { inPile: boolean; index: number; group?: CardInstance[] }) => ReactNode;
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
  const tallest = Math.max(1, ...slots.map((s) => (tokenGroup(s) ? 1 : s.cards.length)));

  return (
    <div
      ref={ref}
      className="relative min-w-0 px-2"
      data-row={row}
      style={{ height: h + (tallest - 1) * dy + 8 }}
      onDragOver={onDragOver}
      onDrop={onDrop ? (e) => onDrop(e, { step }) : undefined}
    >
      {slots.map((slot) => (
        <div key={slot.col} className="absolute top-1 transition-[left] duration-150" style={{ left: 8 + slot.col * step, width: tokenGroup(slot) ? w : w + (slot.cards.length - 1) * dx, height: tokenGroup(slot) ? h : h + (slot.cards.length - 1) * dy, zIndex: slot.col }}>
          {(() => {
            const group = tokenGroup(slot);
            if (group) {
              return (
                <div className="absolute" style={{ left: 0, top: 0, zIndex: 1 }}>
                  {renderCard(group[group.length - 1]!, { inPile: false, index: 0, group })}
                </div>
              );
            }
            return slot.cards.map((c, k) => (
              <div key={c.id} className="absolute" style={{ left: k * dx, top: k * dy, zIndex: k + 1 }}>
                {renderCard(c, { inPile: slot.cards.length > 1, index: k })}
              </div>
            ));
          })()}
        </div>
      ))}
      {children}
    </div>
  );
}

/**
 * Rows/columns for any stored position, including legacy free-placement
 * `{ x, y }` percentages from rooms created before the row model.
 */
export function normalizePosition(pos: unknown): { row: number; col: number } {
  const p = (pos ?? {}) as Record<string, unknown>;
  if (typeof p.row === 'number' && Number.isFinite(p.row) && typeof p.col === 'number' && Number.isFinite(p.col)) {
    return { row: Math.max(0, Math.round(p.row)), col: Math.max(0, Math.round(p.col)) };
  }
  if (typeof p.x === 'number' && typeof p.y === 'number') {
    return { row: p.y >= 50 ? 1 : 0, col: Math.max(0, Math.round(p.x / 12)) };
  }
  return { row: 0, col: 0 };
}

/** Lands go to the back row (1); everything else to the front row (0). */
export function defaultRow(printing: { typeLine: string | null } | undefined): number {
  return printing?.typeLine?.split('—')[0]?.includes('Land') ? 1 : 0;
}

/** Identity for grouping: identical tokens in one slot render as one card with a ×N badge. */
export function tokenGroupKey(card: CardInstance): string | null {
  if (!card.isToken) return null;
  const counters = Object.entries(card.counters).sort().map(([k, v]) => `${k}=${v}`).join(',');
  return [card.printingId ?? `custom:${card.customName ?? ''}`, card.tapped ? 'T' : 'U', card.faceDown ? 'D' : '', card.transformed ? 'X' : '', card.flipped ? 'F' : '', card.note ?? '', counters].join('|');
}

/** All cards of a slot when they are interchangeable tokens, else null. */
export function tokenGroup(slot: Slot): CardInstance[] | null {
  if (slot.cards.length < 2) return null;
  const key = tokenGroupKey(slot.cards[0]!);
  if (key === null) return null;
  return slot.cards.every((c) => tokenGroupKey(c) === key) ? slot.cards : null;
}
