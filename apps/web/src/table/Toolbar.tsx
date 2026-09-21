import type { GameCommand } from '@mtg/shared';
import { useEffect, useRef, useState } from 'react';

type Run = (c: GameCommand) => Promise<void>;

const btn = 'touch-target rounded px-1.5 py-1 text-[11px] text-text-muted hover:bg-white/10 hover:text-text disabled:opacity-40';

/** Table actions: tokens, dice, undo and the shortcut list. Lives in the log column's tools row, or in the player's own strip when there is none. */
export function Toolbar({ run, onToken, onHelp, menuSide = 'up' }: { run: Run; onToken: () => void; onHelp: () => void; /** Which way the dice popover opens. */ menuSide?: 'up' | 'down' }) {
  const [dice, setDice] = useState(false);
  const [expr, setExpr] = useState('2d6');
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!dice) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setDice(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [dice]);

  const roll = (s: string) => {
    const m = /^(\d*)d?(\d+)$/i.exec(s.trim());
    if (!m) return;
    void run({ type: 'rollDice', sides: Number(m[2]), count: m[1] ? Number(m[1]) : 1 });
  };

  return (
    <span className="flex items-center gap-0.5">
      <button type="button" className={btn} onClick={onToken}>Token <kbd>t</kbd></button>
      <span ref={ref} className="relative">
        <button type="button" className={btn} onClick={() => setDice((d) => !d)}>Dice</button>
        {dice && (
          <span className={`absolute z-40 flex ${menuSide === 'down' ? 'left-0 top-full mt-1' : 'bottom-full right-0 mb-1'} items-center gap-1 rounded-md border border-border bg-surface-raised/95 p-1 shadow-xl backdrop-blur`}>
            <button type="button" className={btn} onClick={() => roll('d6')}>d6</button>
            <button type="button" className={btn} onClick={() => roll('d20')}>d20</button>
            <button type="button" className={btn} onClick={() => void run({ type: 'flipCoin', count: 1 })}>coin</button>
            <input value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && roll(expr)} className="w-14 rounded border border-border bg-surface px-1 py-0.5 text-[11px]" aria-label="dice expression" />
            <button type="button" className={btn} onClick={() => roll(expr)}>roll</button>
          </span>
        )}
      </span>
      <button type="button" className={btn} onClick={() => void run({ type: 'undo' })} title="Undo your last action if nobody acted since">Undo <kbd>⌃Z</kbd></button>
      <button type="button" className={btn} onClick={onHelp} title="Keyboard shortcuts">?</button>
    </span>
  );
}
