import { useCallback, useEffect, useState } from 'react';

const EVENT = 'mtg-table:pref';
const storageKey = (key: string) => `${EVENT}:${key}`;

/** Every on/off table preference, with its default and the label the preferences dialog shows. */
export const TABLE_PREFS = {
  commanderDamage: { label: 'Show commander damage counters in the player strips', default: false },
  sound: { label: 'Play a chime when it is my pick, my turn, or my confirmation is needed', default: false },
  notifications: { label: 'Show a browser notification for the same, when this tab is in the background', default: false },
} as const;
export type TablePref = keyof typeof TABLE_PREFS;

function read(key: TablePref): boolean {
  const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(storageKey(key));
  return raw === null ? TABLE_PREFS[key].default : raw === '1';
}

/** A persisted per-browser table preference; every reader updates when it changes. */
export function useTablePref(key: TablePref): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => read(key));
  useEffect(() => {
    const listener = (e: Event) => (e as CustomEvent<string>).detail === key && setOn(read(key));
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, [key]);
  const set = useCallback((next: boolean) => {
    localStorage.setItem(storageKey(key), next ? '1' : '0');
    window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
  }, [key]);
  return [on, set];
}
