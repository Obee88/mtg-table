import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keeps unsaved work from being lost: while `dirty`, `value` is written to
 * localStorage under `key` (debounced) and leaving the page asks for
 * confirmation; once saved, call `clear()`. `restored` holds what a previous
 * visit left behind, for the page to offer back.
 */
export function useUnsavedDraft<T>(key: string, value: T, dirty: boolean): { restored: T | null; clear: () => void } {
  const storageKey = `mtg-table:draft:${key}`;
  const [restored] = useState<T | null>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  });
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        // storage full or unavailable: the beforeunload warning still applies
      }
    }, 300);
    return () => clearTimeout(t);
  }, [storageKey, value, dirty]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const clear = useCallback(() => {
    dirtyRef.current = false;
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  return { restored, clear };
}
