import type { MouseEvent, ReactNode } from 'react';
import { signed } from './counters';

/** Hold-c interaction shared by every counter badge: click +1, right-click −1. */
export interface Adjust {
  active: boolean;
  onInc: () => void;
  onDec: () => void;
}

function adjustProps(adjust: Adjust | undefined) {
  if (!adjust?.active) return { className: 'pointer-events-none', handlers: {} };
  return {
    className: 'pointer-events-auto cursor-pointer ring-2 ring-accent scale-110 brightness-125',
    handlers: {
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
    },
  };
}

/** A small dark tag with a hairline ring, used for notes, custom counters and token names. */
export function Tag({ children, cardW, tone = 'neutral', className = '', adjust }: { children: ReactNode; cardW: number; tone?: 'neutral' | 'accent'; className?: string; adjust?: Adjust | undefined }) {
  const size = Math.max(9, Math.round(cardW * 0.1));
  const a = adjustProps(adjust);
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 font-medium leading-tight shadow-md ring-1 transition-transform ${tone === 'accent' ? 'bg-accent/95 text-bg ring-black/30' : 'bg-black/85 text-white/95 ring-white/20'} ${a.className} ${className}`}
      style={{ fontSize: size, paddingTop: 1, paddingBottom: 1 }}
      {...a.handlers}
    >
      {children}
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
  const a = adjustProps(adjust);
  return (
    <span
      className={`absolute rounded-md px-1.5 font-bold tabular-nums leading-tight text-white shadow-lg ring-1 transition-transform ${tone} ${a.className}`}
      style={{ top: inset, right: inset, fontSize: size, paddingTop: 2, paddingBottom: 2 }}
      {...a.handlers}
    >
      {signed(power)}/{signed(toughness)}
    </span>
  );
}

/** Planeswalker loyalty shield, bottom-right: flat top, straight sides, pointed bottom, thin white outline. */
export function LoyaltyBadge({ value, cardW, adjust }: { value: number; cardW: number; adjust?: Adjust | undefined }) {
  const w = Math.max(24, Math.round(cardW * 0.3));
  const h = Math.round(w * 1.1);
  const inset = Math.round(cardW * 0.04);
  const a = adjustProps(adjust);
  return (
    <span className={`absolute rounded-md drop-shadow-lg transition-transform ${a.className}`} style={{ bottom: inset, right: inset, width: w, height: h }} title={`${value} loyalty`} {...a.handlers}>
      <svg viewBox="0 0 40 44" width={w} height={h} aria-hidden>
        <path d="M3.5 2 H36.5 C37.6 2 38.5 2.9 38.5 4 V24.5 C38.5 30 34 36 20 42.5 C6 36 1.5 30 1.5 24.5 V4 C1.5 2.9 2.4 2 3.5 2 Z" fill="#0a0a0d" stroke="#ffffff" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-bold tabular-nums text-white" style={{ fontSize: Math.round(w * 0.5), paddingBottom: Math.round(w * 0.12) }}>
        {value}
      </span>
    </span>
  );
}
