import { useEffect, useRef, useState } from 'react';
import { Button } from '../components';

/**
 * Copies `text` to the clipboard and says so: the label turns into
 * "Copied ✓" for a moment (or "Copy failed" if the browser refused).
 */
export function CopyButton({ text, children = 'Copy', copiedLabel = 'Copied ✓', className = '', title }: { text: string | (() => string); children?: string; copiedLabel?: string; className?: string; title?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(typeof text === 'function' ? text() : text);
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1800);
  };
  return (
    <Button variant="ghost" onClick={() => void copy()} className={`${state === 'copied' ? '!border-success !text-success' : state === 'failed' ? '!border-danger !text-danger' : ''} ${className}`} title={title} aria-live="polite">
      {state === 'copied' ? copiedLabel : state === 'failed' ? 'Copy failed' : children}
    </Button>
  );
}
