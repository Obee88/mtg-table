import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { Chip, type ChipType } from '../components/Chip';
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

const activeStyle = (active: boolean): CSSProperties =>
  active ? { pointerEvents: 'auto', cursor: 'pointer', boxShadow: '0 0 0 2px var(--color-accent), 0 0 8px var(--color-accent)', transform: 'scale(1.1)' } : { pointerEvents: 'none' };

const sizeFor = (cardW: number) => (cardW > 120 ? 'medium' : 'small');

/** Soft rect chip on a card: notes (warning), custom token names and hints (neutral). */
export function Tag({ children, cardW, type = 'neutral', className = '', adjust }: { children: ReactNode; cardW: number; type?: ChipType; className?: string; adjust?: Adjust | undefined }) {
  return (
    <Chip type={type} emphasis="soft" size={sizeFor(cardW)} className={`shadow-md transition-transform ${className}`} style={activeStyle(!!adjust?.active)} {...adjustHandlers(adjust)}>
      {children}
    </Chip>
  );
}

/** The general counter: a solid round badge with the count (min-width = height keeps it circular). */
export function CounterBadge({ value, adjust }: { value: number; cardW?: number; adjust?: Adjust | undefined }) {
  return (
    <Chip type="neutral" shape="pill" size="medium" className="shadow-lg transition-transform" style={{ ...activeStyle(!!adjust?.active), minWidth: 26, height: 26, fontSize: 13 }} {...adjustHandlers(adjust)}>
      {value}
    </Chip>
  );
}

/** Net power/toughness modification as a solid pill: success when non-negative, error when non-positive, neutral when mixed. */
export function PTBadge({ power, toughness, cardW, adjust }: { power: number; toughness: number; cardW: number; adjust?: Adjust | undefined }) {
  const positive = power >= 0 && toughness >= 0;
  const negative = power <= 0 && toughness <= 0;
  const type: ChipType = positive ? 'success' : negative ? 'error' : 'neutral';
  const inset = Math.round(cardW * 0.06);
  return (
    <Chip type={type} shape="pill" size={sizeFor(cardW)} className="absolute shadow-lg transition-transform" style={{ top: inset, right: inset, ...activeStyle(!!adjust?.active) }} {...adjustHandlers(adjust)}>
      {signed(power)}/{signed(toughness)}
    </Chip>
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
