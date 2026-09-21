import { useEffect, type ReactNode } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
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
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className={`block w-full px-3 py-1.5 text-left hover:bg-surface disabled:opacity-40 touch-menu-item ${item.danger ? 'text-danger' : ''}`}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
