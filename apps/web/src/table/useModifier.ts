import { useEffect, useState } from 'react';

/** Whether the `c` key is currently held (counter mode); resets when the window loses focus. */
export function useCounterKeyHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const isKey = (e: KeyboardEvent) => e.key === 'c' || e.key === 'C';
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => isKey(e) && !typing(e) && !e.ctrlKey && !e.metaKey && setHeld(true);
    const up = (e: KeyboardEvent) => isKey(e) && setHeld(false);
    const blur = () => setHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  return held;
}
