import { useEffect, useState, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  /** Omitted for a submenu header, which expands `items` instead. */
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** A submenu; the row expands in place when chosen (works with a finger too). */
  items?: MenuItem[];
}

/** A minimal fixed-position menu; closes on outside click, Escape or selection. */
export function ContextMenu({ x, y, items, onClose, header }: { x: number; y: number; items: (MenuItem | 'sep')[]; onClose: () => void; header?: ReactNode }) {
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

  // Touch screens get taller rows (see .touch-menu-item), so the menu is measured with them.
  const rowHeight = window.matchMedia('(hover: none)').matches ? 44 : 32;
  const left = Math.max(4, Math.min(x, window.innerWidth - 220));
  const top = Math.max(4, Math.min(y, window.innerHeight - rowHeight * items.length - 24));

  return (
    <div
      className="fixed z-50 min-w-[200px] rounded-md border border-border bg-surface-raised py-1 text-sm shadow-xl"
      style={{ left, top }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      role="menu"
    >
      {header && <div className="truncate px-3 py-1 text-xs text-text-muted">{header}</div>}
      {items.map((item, i) =>
        item === 'sep' ? (
          <div key={i} className="my-1 border-t border-border" />
        ) : (
          <Row key={item.label} item={item} onClose={onClose} />
        ),
      )}
    </div>
  );
}

/** One row; a row with `items` expands them underneath instead of selecting. */
function Row({ item, onClose, depth = 0 }: { item: MenuItem; onClose: () => void; depth?: number }) {
  const [open, setOpen] = useState(false);
  const sub = item.items ?? [];
  return (
    <>
      <button
        type="button"
        role="menuitem"
        disabled={item.disabled}
        onClick={() => {
          if (sub.length > 0) return setOpen((o) => !o);
          item.onSelect?.();
          onClose();
        }}
        className={`touch-menu-item block w-full py-1.5 pr-3 text-left hover:bg-surface disabled:opacity-40 ${item.danger ? 'text-danger' : ''}`}
        style={{ paddingLeft: 12 + depth * 12 }}
      >
        {item.label}{sub.length > 0 && <span className="float-right text-text-muted">{open ? '▾' : '▸'}</span>}
      </button>
      {open && sub.map((child) => <Row key={child.label} item={child} onClose={onClose} depth={depth + 1} />)}
    </>
  );
}
