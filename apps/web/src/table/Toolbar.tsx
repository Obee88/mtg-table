import type { GameCommand } from '@mtg/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../components';

type Run = (c: GameCommand) => Promise<void>;

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
    <span className="flex items-center gap-1">
      <Button variant="tertiary" className="touch-target" onClick={onToken}>Token <kbd className="rounded border border-white/20 px-1 text-[10px] opacity-70">t</kbd></Button>
      <span ref={ref} className="relative">
        <Button variant="tertiary" className={`touch-target ${dice ? 'active' : ''}`} onClick={() => setDice((d) => !d)} aria-expanded={dice}>Dice</Button>
        {dice && (
          <span className={`absolute z-40 flex ${menuSide === 'down' ? 'left-0 top-full mt-1' : 'bottom-full right-0 mb-1'} items-center gap-1 rounded-md border border-border bg-surface-raised/95 p-1 shadow-xl backdrop-blur`}>
            <Button variant="secondary" onClick={() => roll('d6')}>d6</Button>
            <Button variant="secondary" onClick={() => roll('d20')}>d20</Button>
            <Button variant="secondary" onClick={() => void run({ type: 'flipCoin', count: 1 })}>coin</Button>
            <input value={expr} onChange={(e) => setExpr(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && roll(expr)} className="w-14 rounded border border-border bg-surface px-1 py-0.5 text-sm" aria-label="dice expression" />
            <Button variant="primary" onClick={() => roll(expr)}>roll</Button>
          </span>
        )}
      </span>
      <Button variant="tertiary" className="touch-target" onClick={() => void run({ type: 'undo' })} title="Undo your last action if nobody acted since">Undo <kbd className="rounded border border-white/20 px-1 text-[10px] opacity-70">⌃Z</kbd></Button>
      <Button variant="tertiary" className="touch-target" onClick={onHelp} title="Keyboard shortcuts" iconOnly>?</Button>
    </span>
  );
}
