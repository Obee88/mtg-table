import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useCardSize } from './cardSize';

/**
 * A single row of cards that overlaps them (never wraps) once they no longer
 * fit the available width, like a fanned hand.
 */
export function Hand({ count, children, className = '', ...rest }: { count: number; children: ReactNode; className?: string } & Record<string, unknown>) {
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

  const gap = 8;
  const needed = count * w + Math.max(0, count - 1) * gap;
  const overlap = count > 1 && width > 0 && needed > width ? Math.min(w * 0.8, (needed - width) / (count - 1) + gap) : 0;

  return (
    <div ref={ref} className={`flex min-w-0 flex-1 items-center overflow-hidden px-1 ${className}`} style={{ height: h + 12 }} {...rest}>
      {Array.isArray(children)
        ? children.map((child, i) => (
            <div key={i} className="shrink-0 transition-[margin] duration-150" style={{ marginLeft: i === 0 ? 0 : gap - overlap, zIndex: i }}>
              {child}
            </div>
          ))
        : children}
    </div>
  );
}
