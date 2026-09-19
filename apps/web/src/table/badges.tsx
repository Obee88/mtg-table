import type { ReactNode } from 'react';
import { signed } from './counters';

/** A small dark tag with a hairline ring, used for notes, custom counters and token names. */
export function Tag({ children, cardW, tone = 'neutral', className = '' }: { children: ReactNode; cardW: number; tone?: 'neutral' | 'accent'; className?: string }) {
  const size = Math.max(9, Math.round(cardW * 0.1));
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 font-medium leading-tight shadow-md ring-1 ${tone === 'accent' ? 'bg-accent/95 text-bg ring-black/30' : 'bg-black/85 text-white/95 ring-white/20'} ${className}`}
      style={{ fontSize: size, paddingTop: 1, paddingBottom: 1 }}
    >
      {children}
    </span>
  );
}

/** Net power/toughness modification: "+2/+2" green, "-1/-1" red, mixed neutral. Top-right, inset from the corner. */
export function PTBadge({ power, toughness, cardW }: { power: number; toughness: number; cardW: number }) {
  const positive = power >= 0 && toughness >= 0;
  const negative = power <= 0 && toughness <= 0;
  const tone = positive ? 'bg-emerald-600 ring-emerald-200/60' : negative ? 'bg-red-700 ring-red-200/60' : 'bg-zinc-800 ring-white/40';
  const size = Math.max(10, Math.round(cardW * 0.14));
  const inset = Math.round(cardW * 0.06);
  return (
    <span
      className={`absolute rounded-md px-1.5 font-bold tabular-nums leading-tight text-white shadow-lg ring-1 ${tone}`}
      style={{ top: inset, right: inset, fontSize: size, paddingTop: 2, paddingBottom: 2 }}
    >
      {signed(power)}/{signed(toughness)}
    </span>
  );
}

/** Planeswalker loyalty shield, bottom-right: flat top, straight sides, pointed bottom, thin white outline. */
export function LoyaltyBadge({ value, cardW }: { value: number; cardW: number }) {
  const w = Math.max(24, Math.round(cardW * 0.3));
  const h = Math.round(w * 1.1);
  const inset = Math.round(cardW * 0.04);
  return (
    <span className="absolute drop-shadow-lg" style={{ bottom: inset, right: inset, width: w, height: h }} title={`${value} loyalty`}>
      <svg viewBox="0 0 40 44" width={w} height={h} aria-hidden>
        <path d="M3.5 2 H36.5 C37.6 2 38.5 2.9 38.5 4 V24.5 C38.5 30 34 36 20 42.5 C6 36 1.5 30 1.5 24.5 V4 C1.5 2.9 2.4 2 3.5 2 Z" fill="#0a0a0d" stroke="#ffffff" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-bold tabular-nums text-white" style={{ fontSize: Math.round(w * 0.5), paddingBottom: Math.round(w * 0.12) }}>
        {value}
      </span>
    </span>
  );
}
