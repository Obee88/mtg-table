import { Children, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useCardSize } from './cardSize';

/**
 * A centred, single row of cards that overlaps (never wraps) once they no
 * longer fit, like a fanned hand. Hovering a card lifts it above its neighbours.
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

  const gap = 6;
  const needed = count * w + Math.max(0, count - 1) * gap;
  const overlap = count > 1 && width > 0 && needed > width ? Math.min(w * 0.85, (needed - width) / (count - 1) + gap) : 0;
  const items = Children.toArray(children);

  return (
    <div ref={ref} className={`flex min-w-0 flex-1 items-center justify-center overflow-visible px-2 ${className}`} style={{ height: h + 12 }} {...rest}>
      {items.map((child, i) => (
        <div key={i} className="shrink-0 transition-[margin,transform] duration-150 hover:z-50 hover:-translate-y-2" style={{ marginLeft: i === 0 ? 0 : gap - overlap, zIndex: i }}>
          {child}
        </div>
      ))}
    </div>
  );
}
