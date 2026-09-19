import type { MouseEvent, ReactNode } from 'react';
import { signed } from './counters';

/** Hold-c interaction shared by every counter badge: click +1, right-click −1. */
export interface Adjust {
  active: boolean;
  onInc: () => void;
  onDec: () => void;
}

function adjustHandlers(adjust: Adjust | undefined) {
  if (!adjust?.active) return {};
  return {
    onClick: (e: MouseEvent) => {
      e.stopPropagation();
      adjust.onInc();
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      adjust.onDec();
    },
    onMouseDown: (e: MouseEvent) => e.stopPropagation(),
    title: 'click +1 · right-click −1',
  };
}

const ACTIVE_BOX = 'pointer-events-auto cursor-pointer ring-2 ring-accent scale-110 brightness-125';

/** A small dark tag with a hairline ring, used for notes, custom token names and legacy named counters. */
export function Tag({ children, cardW, tone = 'neutral', className = '', adjust }: { children: ReactNode; cardW: number; tone?: 'neutral' | 'accent'; className?: string; adjust?: Adjust | undefined }) {
  const size = Math.max(9, Math.round(cardW * 0.1));
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 font-medium leading-tight shadow-md ring-1 transition-transform ${tone === 'accent' ? 'bg-accent/95 text-bg ring-black/30' : 'bg-black/85 text-white/95 ring-white/20'} ${adjust?.active ? ACTIVE_BOX : 'pointer-events-none'} ${className}`}
      style={{ fontSize: size, paddingTop: 1, paddingBottom: 1 }}
      {...adjustHandlers(adjust)}
    >
      {children}
    </span>
  );
}

/** The general counter: a round dark badge with the count, top-left. Big enough to hit. */
export function CounterBadge({ value, cardW, adjust }: { value: number; cardW: number; adjust?: Adjust | undefined }) {
  const d = Math.max(22, Math.round(cardW * 0.26));
  return (
    <span
      className={`flex items-center justify-center rounded-full bg-zinc-900 font-bold tabular-nums text-white shadow-lg ring-1 ring-white/50 transition-transform ${adjust?.active ? ACTIVE_BOX : 'pointer-events-none'}`}
      style={{ width: d, height: d, fontSize: Math.round(d * 0.55) }}
      {...adjustHandlers(adjust)}
    >
      {value}
    </span>
  );
}

/** Net power/toughness modification: "+2/+2" green, "-1/-1" red, mixed neutral. Top-right, inset from the corner. */
export function PTBadge({ power, toughness, cardW, adjust }: { power: number; toughness: number; cardW: number; adjust?: Adjust | undefined }) {
  const positive = power >= 0 && toughness >= 0;
  const negative = power <= 0 && toughness <= 0;
  const tone = positive ? 'bg-emerald-600 ring-emerald-200/60' : negative ? 'bg-red-700 ring-red-200/60' : 'bg-zinc-800 ring-white/40';
  const size = Math.max(10, Math.round(cardW * 0.14));
  const inset = Math.round(cardW * 0.06);
  return (
    <span
      className={`absolute rounded-md px-1.5 font-bold tabular-nums leading-tight text-white shadow-lg ring-1 transition-transform ${tone} ${adjust?.active ? ACTIVE_BOX : 'pointer-events-none'}`}
      style={{ top: inset, right: inset, fontSize: size, paddingTop: 2, paddingBottom: 2 }}
      {...adjustHandlers(adjust)}
    >
      {signed(power)}/{signed(toughness)}
    </span>
  );
}

/**
 * The printed planeswalker loyalty shield (scalloped top, pointed bottom).
 * Path from the Mana icon font by Andrew Gioia ("loyalty-start"), SIL OFL 1.1.
 * Highlight is drawn on the outline itself, so it follows the shield shape.
 */
const LOYALTY_PATH =
  'M22.308 6.408l9.648 3.523c0 0-1.648 2.304-2.12 5.295s-0.006 5.352-0.006 5.352l-13.831 4.813-13.738-4.813c0 0 0.396-2.361 0.081-5.037s-2.3-5.61-2.3-5.61l9.608-3.431 0.069-0.001c0.665 1.74 2.739 2.587 4.338 2.904 0.889 0.177 1.162 0.164 1.941 0.189 2.027-0.029 5.556-0.81 6.308-3.184z';

export function LoyaltyBadge({ value, cardW, adjust }: { value: number; cardW: number; adjust?: Adjust | undefined }) {
  const w = Math.max(26, Math.round(cardW * 0.34));
  const inset = Math.round(cardW * 0.03);
  const active = !!adjust?.active;
  return (
    <span
      className={`absolute transition-transform ${active ? 'pointer-events-auto scale-110 cursor-pointer' : 'pointer-events-none'}`}
      style={{ bottom: inset, right: inset, width: w, height: w, filter: active ? 'drop-shadow(0 0 5px var(--color-accent))' : 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.8))' }}
      title={`${value} loyalty`}
      {...adjustHandlers(adjust)}
    >
      <svg viewBox="0 3 32 24" width={w} height={w * 0.75} aria-hidden style={{ position: 'absolute', top: w * 0.125, left: 0, overflow: 'visible' }}>
        <path d={LOYALTY_PATH} fill="#0a0a0d" stroke={active ? 'var(--color-accent)' : '#ffffff'} strokeWidth={active ? 2.2 : 1.4} strokeLinejoin="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-bold tabular-nums text-white" style={{ fontSize: Math.round(w * 0.42), paddingTop: Math.round(w * 0.06) }}>
        {value}
      </span>
    </span>
  );
}
