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
}

const PreviewContext = createContext<PreviewApi | null>(null);

const PREVIEW_W = 300;
const PREVIEW_H = 418;
const OFFSET = 16;

/**
 * One floating full-size card image for the whole app. Any element can opt in
 * with the handlers from `useCardPreview`.
 */
export function CardPreviewProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PreviewState | null>(null);

  const show = useCallback((src: string, e: MouseEvent) => setState({ src, x: e.clientX, y: e.clientY }), []);
  const move = useCallback((e: MouseEvent) => setState((s) => (s ? { ...s, x: e.clientX, y: e.clientY } : s)), []);
  const hide = useCallback(() => setState(null), []);
  const api = useMemo(() => ({ show, move, hide }), [show, move, hide]);

  let style: { left: number; top: number } | undefined;
  if (state) {
    const right = state.x + OFFSET + PREVIEW_W > window.innerWidth;
    const left = right ? state.x - OFFSET - PREVIEW_W : state.x + OFFSET;
    const top = Math.min(state.y - PREVIEW_H / 2, window.innerHeight - PREVIEW_H - OFFSET);
    style = { left, top: Math.max(OFFSET, top) };
  }

  return (
    <PreviewContext.Provider value={api}>
      {children}
      {state && (
        <img
          src={state.src}
          alt=""
          className="pointer-events-none fixed z-50 rounded-[4.5%] shadow-2xl"
          style={{ ...style, width: PREVIEW_W, height: PREVIEW_H }}
        />
      )}
    </PreviewContext.Provider>
  );
}

/** Returns mouse handlers that show `src` as the floating preview while hovering. */
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
