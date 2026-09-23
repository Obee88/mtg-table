import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from 'react';

export type ChipType = 'primary' | 'success' | 'error' | 'warning' | 'neutral';

export interface ChipProps {
  type?: ChipType;
  /** `soft` (default) = the tinted pill every label and counter wears; `solid` = the loud, saturated pill for an ask waiting on you. */
  emphasis?: 'soft' | 'solid';
  /** Kept for compatibility: every chip is a pill now. */
  shape?: 'rect' | 'pill';
  size?: 'small' | 'medium';
  className?: string;
  style?: CSSProperties;
  title?: string;
  children: ReactNode;
}

function chipClass({ size = 'medium', clickable = false, className = '' }: { size?: 'small' | 'medium'; clickable?: boolean; className?: string }) {
  return ['chip', size === 'small' && 'chip--small', clickable && 'chip--clickable', className].filter(Boolean).join(' ');
}

function chipVars(type: ChipType, emphasis: 'soft' | 'solid'): CSSProperties {
  const p = `--chip-${emphasis}-${type}`;
  return { '--chip-bg': `var(${p}-bg)`, '--chip-fg': `var(${p}-fg)`, '--chip-bd': `var(${p}-bd)`, '--chip-hover': `var(${p}-hover)`, '--chip-icon': `var(${p}-icon)` } as CSSProperties;
}

/** The one label/badge look: a 24px pill in the styleguide's medium alternative style (small: 20px). */
export function Chip({ type = 'neutral', emphasis = 'soft', size = 'medium', className, style, title, children, shape: _shape, ...rest }: ChipProps & Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className' | 'style' | 'title'>) {
  return (
    <span className={chipClass({ size, className: className ?? '' })} style={{ ...chipVars(type, emphasis), ...style }} title={title} {...rest}>
      {children}
    </span>
  );
}

/** A chip that is a real button (clickable is a state derived from having onClick). */
export function ChipButton({ type = 'neutral', emphasis = 'soft', size = 'medium', className, style, title, children, shape: _shape, ...rest }: ChipProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'style' | 'title' | 'type'>) {
  return (
    <button type="button" className={chipClass({ size, clickable: true, className: className ?? '' })} style={{ ...chipVars(type, emphasis), ...style }} title={title} {...rest}>
      {children}
    </button>
  );
}
