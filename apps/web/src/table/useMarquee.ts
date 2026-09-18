import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Rubber-band selection on a container: pointer down on empty space starts a
 * rectangle; on release, `onSelect` gets the ids of `[data-instance-id]`
 * children whose boxes intersect it.
 */
export function useMarquee(onSelect: (ids: string[], additive: boolean) => void) {
  const [rect, setRect] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number; additive: boolean; container: HTMLElement } | null>(null);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    start.current = { x: e.clientX, y: e.clientY, additive: e.shiftKey || e.ctrlKey || e.metaKey, container: e.currentTarget };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    const s = start.current;
    if (!s) return;
    const box = s.container.getBoundingClientRect();
    setRect({
      left: Math.min(s.x, e.clientX) - box.left,
      top: Math.min(s.y, e.clientY) - box.top,
      width: Math.abs(e.clientX - s.x),
      height: Math.abs(e.clientY - s.y),
    });
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      s.container.releasePointerCapture(e.pointerId);
      setRect(null);
      const l = Math.min(s.x, e.clientX);
      const t = Math.min(s.y, e.clientY);
      const r = Math.max(s.x, e.clientX);
      const b = Math.max(s.y, e.clientY);
      if (r - l < 4 && b - t < 4) {
        onSelect([], s.additive); // plain click on empty space clears
        return;
      }
      const ids: string[] = [];
      for (const el of s.container.querySelectorAll<HTMLElement>('[data-instance-id]')) {
        const box = el.getBoundingClientRect();
        if (box.left < r && box.right > l && box.top < b && box.bottom > t) ids.push(el.dataset.instanceId!);
      }
      onSelect(ids, s.additive);
    },
    [onSelect],
  );

  return { rect, handlers: { onPointerDown, onPointerMove, onPointerUp } };
}
