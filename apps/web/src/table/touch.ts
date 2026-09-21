import type { PointerEvent as ReactPointerEvent } from 'react';

const MIME = 'text/instance-ids';
/** Finger travel before a press becomes a drag (px). */
export const DRAG_THRESHOLD = 8;
/** Hold time before a press becomes a context menu (ms). */
export const LONG_PRESS_MS = 450;

export type Gesture = 'press' | 'drag' | 'longpress';

/** What a touch that started `elapsed` ms ago and moved `distance` px has become. Pure, for tests. */
export function classifyGesture(distance: number, elapsed: number): Gesture {
  if (distance > DRAG_THRESHOLD) return 'drag';
  return elapsed >= LONG_PRESS_MS ? 'longpress' : 'press';
}

export function isTouchPointer(e: ReactPointerEvent): boolean {
  return e.pointerType === 'touch' || e.pointerType === 'pen';
}

/**
 * Delivers a card drop to whatever is under the finger, as if the browser's
 * drag and drop had done it: a bubbling `drop` event carrying the instance ids
 * in `dataTransfer`, so the existing React drop handlers apply unchanged.
 */
export function dispatchTouchDrop(target: Element | null, ids: string[], clientX: number, clientY: number): boolean {
  if (!target || ids.length === 0) return false;
  const data: Record<string, string> = { [MIME]: JSON.stringify(ids), 'text/dragged-id': ids[0]! };
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: { getData: (type: string) => data[type] ?? '', setData: () => undefined, types: Object.keys(data), effectAllowed: 'move', dropEffect: 'move' } },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  return target.dispatchEvent(event);
}

/** Opens the element's context menu where the finger is, as a right-click would. */
export function dispatchLongPress(target: Element, clientX: number, clientY: number): void {
  target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }));
}

/**
 * Pointer handlers that call `onLongPress` when a finger rests on the element
 * (no drag involved). Used where hovering is impossible: a held card shows its
 * full image. Mouse and pen are ignored — they have hover.
 */
export function longPressHandlers(onLongPress: () => void): {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerMove: (e: ReactPointerEvent) => void;
  onPointerCancel: () => void;
} {
  let timer: number | null = null;
  let start = { x: 0, y: 0 };
  const cancel = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  return {
    onPointerDown: (e) => {
      if (e.pointerType !== 'touch') return;
      start = { x: e.clientX, y: e.clientY };
      cancel();
      timer = window.setTimeout(() => {
        timer = null;
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerMove: (e) => {
      if (timer !== null && Math.hypot(e.clientX - start.x, e.clientY - start.y) > DRAG_THRESHOLD) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
  };
}

/**
 * Touch gestures on a card: hold for the context menu, move to drag it (a
 * translucent copy follows the finger; lifting it drops on the element
 * underneath). Call from `onPointerDown` for touch pointers only.
 */
export function startTouchGesture(el: HTMLElement, e: ReactPointerEvent, opts: { ids: () => string[]; canDrag: boolean; canMenu: boolean }): void {
  const start = { x: e.clientX, y: e.clientY };
  let ghost: HTMLElement | null = null;
  let dragging = false;
  let timer: number | null = null;

  const cleanup = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    ghost?.remove();
    ghost = null;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cleanup);
  };

  const move = (ev: PointerEvent) => {
    const distance = Math.hypot(ev.clientX - start.x, ev.clientY - start.y);
    if (!dragging && classifyGesture(distance, 0) === 'drag') {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if (!opts.canDrag) return cleanup();
      dragging = true;
      ghost = el.cloneNode(true) as HTMLElement;
      ghost.style.position = 'fixed';
      ghost.style.pointerEvents = 'none';
      ghost.style.opacity = '0.85';
      ghost.style.zIndex = '9999';
      ghost.style.margin = '0';
      ghost.style.width = `${el.offsetWidth}px`;
      ghost.style.height = `${el.offsetHeight}px`;
      document.body.appendChild(ghost);
    }
    if (dragging && ghost) {
      ev.preventDefault();
      ghost.style.left = `${ev.clientX - el.offsetWidth / 2}px`;
      ghost.style.top = `${ev.clientY - el.offsetHeight / 2}px`;
    }
  };

  const up = (ev: PointerEvent) => {
    const wasDragging = dragging;
    ghost?.remove();
    ghost = null;
    cleanup();
    if (!wasDragging) return;
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    dispatchTouchDrop(target, opts.ids(), ev.clientX, ev.clientY);
  };

  if (opts.canMenu) {
    timer = window.setTimeout(() => {
      timer = null;
      cleanup();
      // The tap that follows the hold must not count as a click.
      el.dataset.suppressClick = '1';
      window.setTimeout(() => delete el.dataset.suppressClick, 600);
      dispatchLongPress(el, start.x, start.y);
    }, LONG_PRESS_MS);
  }
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cleanup);
}
