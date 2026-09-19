import { createContext, useCallback, useContext, useMemo, useState, type MouseEvent, type ReactNode } from 'react';

interface PreviewState {
  src: string;
  x: number;
  y: number;
}

interface PreviewApi {
  show: (src: string, e: MouseEvent) => void;
  move: (e: MouseEvent) => void;
  hide: () => void;
  /** Currently shown image (panel mode keeps the last hovered card). */
  src: string | null;
}

const PreviewContext = createContext<PreviewApi | null>(null);

const OFFSET = 16;

/** Preview as large as the viewport comfortably allows (about 60% of its height). */
function previewSize(): { w: number; h: number } {
  const h = Math.max(300, Math.min(window.innerHeight * 0.6, 720));
  return { w: Math.round(h * (5 / 7)), h: Math.round(h) };
}

/**
 * Card preview for the app. `floating` (default) shows one image following
 * the pointer; `panel` keeps the last hovered card for a <PreviewPanel /> to
 * render somewhere fixed (the game screen's log column).
 */
export function CardPreviewProvider({ children, mode = 'floating' }: { children: ReactNode; mode?: 'floating' | 'panel' }) {
  const [state, setState] = useState<PreviewState | null>(null);

  const show = useCallback((src: string, e: MouseEvent) => setState({ src, x: e.clientX, y: e.clientY }), []);
  const move = useCallback((e: MouseEvent) => setState((s) => (s ? { ...s, x: e.clientX, y: e.clientY } : s)), []);
  const hide = useCallback(() => {
    if (mode === 'floating') setState(null);
  }, [mode]);
  const api = useMemo(() => ({ show, move, hide, src: state?.src ?? null }), [show, move, hide, state?.src]);

  let style: { left: number; top: number; width: number; height: number } | undefined;
  if (state && mode === 'floating') {
    const { w, h } = previewSize();
    const right = state.x + OFFSET + w > window.innerWidth;
    const left = right ? state.x - OFFSET - w : state.x + OFFSET;
    const top = Math.min(state.y - h / 2, window.innerHeight - h - OFFSET);
    style = { left, top: Math.max(OFFSET, top), width: w, height: h };
  }

  return (
    <PreviewContext.Provider value={api}>
      {children}
      {style && state && <img src={state.src} alt="" className="pointer-events-none fixed z-50 rounded-[4.5%] shadow-2xl" style={style} />}
    </PreviewContext.Provider>
  );
}

/** Returns mouse handlers that show `src` as the preview while hovering. */
export function useCardPreview(src: string | null | undefined) {
  const api = useContext(PreviewContext);
  if (!api) throw new Error('useCardPreview must be used inside CardPreviewProvider');
  return useMemo(
    () =>
      src
        ? {
            onMouseEnter: (e: MouseEvent) => api.show(src, e),
            onMouseMove: api.move,
            onMouseLeave: api.hide,
          }
        : {},
    [api, src],
  );
}

/** Fixed preview surface for panel mode: the last hovered card, or a placeholder. */
export function PreviewPanel({ className = '' }: { className?: string }) {
  const api = useContext(PreviewContext);
  if (!api) throw new Error('PreviewPanel must be used inside CardPreviewProvider');
  return (
    <div className={`aspect-[5/7] w-full overflow-hidden rounded-[4.5%] bg-black/40 ${className}`}>
      {api.src ? <img src={api.src} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[11px] text-white/25">hover a card</div>}
    </div>
  );
}
