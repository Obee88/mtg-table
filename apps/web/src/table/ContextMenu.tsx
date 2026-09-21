import { useEffect, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  /** Omitted for a submenu header, which opens `items` instead. */
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** A submenu; opens beside the row. */
  items?: MenuItem[];
}

const WIDTH = 224;
/** Row height used to keep a menu inside the window; touch rows are taller (see .touch-menu-item). */
const rowHeight = () => (typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches ? 44 : 32);

/** Keeps a panel of `count` rows inside the window, preferring (x, y). */
function fit(x: number, y: number, count: number): { left: number; top: number } {
  const height = rowHeight() * count + 16;
  return {
    left: Math.max(4, Math.min(x, window.innerWidth - WIDTH - 4)),
    top: Math.max(4, Math.min(y, window.innerHeight - height - 4)),
  };
}

/** A minimal fixed-position menu; closes on outside click, Escape or selection. */
export function ContextMenu({ x, y, items, onClose, header }: { x: number; y: number; items: (MenuItem | 'sep')[]; onClose: () => void; header?: ReactNode }) {
  /** The open submenu: which row, and where its panel sits. */
  const [sub, setSub] = useState<{ index: number; left: number; top: number } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (sub ? setSub(null) : onClose());
    const onClick = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [onClose, sub]);

  /** Beside the row: to its right, or to its left when the right edge is too close. */
  const openSub = (index: number, row: DOMRect, count: number) => {
    const height = rowHeight() * count + 16;
    const right = row.right + 2;
    const left = right + WIDTH <= window.innerWidth - 4 ? right : Math.max(4, row.left - WIDTH - 2);
    setSub({ index, left, top: Math.max(4, Math.min(row.top - 4, window.innerHeight - height - 4)) });
  };

  const open = sub === null ? null : items[sub.index];
  const subItems = open && open !== 'sep' ? (open.items ?? []) : [];

  return (
    <div
      className="fixed z-50 rounded-md border border-border bg-surface-raised py-1 text-sm shadow-xl"
      style={{ ...fit(x, y, items.length + (header ? 1 : 0)), minWidth: 200, maxWidth: WIDTH }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      {header && <div className="truncate px-3 py-1 text-xs text-text-muted">{header}</div>}
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={i} className="my-1 border-t border-border" />
        ) : (
          <Row
            key={item.label}
            item={item}
            expanded={sub?.index === i}
            onOpenSub={(rect) => openSub(i, rect, item.items?.length ?? 0)}
            onHoverPlain={() => setSub(null)}
            onClose={onClose}
          />
        ),
      )}
      {sub && subItems.length > 0 && (
        <div className="fixed z-50 rounded-md border border-border bg-surface-raised py-1 text-sm shadow-xl" style={{ left: sub.left, top: sub.top, minWidth: 200, maxWidth: WIDTH }} role="menu">
          {subItems.map((child) => <Row key={child.label} item={child} expanded={false} onOpenSub={() => undefined} onHoverPlain={() => undefined} onClose={onClose} />)}
        </div>
      )}
    </div>
  );
}

function Row({ item, expanded, onOpenSub, onHoverPlain, onClose }: {
  item: MenuItem;
  expanded: boolean;
  onOpenSub: (rect: DOMRect) => void;
  onHoverPlain: () => void;
  onClose: () => void;
}) {
  const hasSub = (item.items?.length ?? 0) > 0;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onMouseEnter={(e) => (hasSub ? onOpenSub(e.currentTarget.getBoundingClientRect()) : onHoverPlain())}
      onClick={(e) => {
        if (hasSub) return onOpenSub(e.currentTarget.getBoundingClientRect());
        item.onSelect?.();
        onClose();
      }}
      title={item.label}
      className={`touch-menu-item block w-full truncate px-3 py-1.5 text-left hover:bg-surface disabled:opacity-40 ${expanded ? 'bg-surface' : ''} ${item.danger ? 'text-danger' : ''}`}
    >
      {item.label}
      {hasSub && <span className="float-right text-text-muted">▸</span>}
    </button>
  );
}
