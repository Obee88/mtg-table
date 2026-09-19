import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from 'react';

export type ChipType = 'primary' | 'success' | 'error' | 'warning' | 'neutral';

export interface ChipProps {
  type?: ChipType;
  /** `soft` = quiet label (deep fill); `solid` = loud badge (white fill). */
  emphasis?: 'soft' | 'solid';
  shape?: 'rect' | 'pill';
  size?: 'small' | 'medium';
  className?: string;
  style?: CSSProperties;
  title?: string;
  children: ReactNode;
}

function chipClass({ shape = 'rect', size = 'small', clickable = false, className = '' }: { shape?: 'rect' | 'pill'; size?: 'small' | 'medium'; clickable?: boolean; className?: string }) {
  return ['chip', shape === 'pill' && 'chip--pill', size === 'medium' && 'chip--medium', clickable && 'chip--clickable', className].filter(Boolean).join(' ');
}

function chipVars(type: ChipType, emphasis: 'soft' | 'solid'): CSSProperties {
  const p = `--chip-${emphasis}-${type}`;
  return { '--chip-bg': `var(${p}-bg)`, '--chip-fg': `var(${p}-fg)`, '--chip-bd': `var(${p}-bd)`, '--chip-hover': `var(${p}-hover)`, '--chip-icon': `var(${p}-icon)` } as CSSProperties;
}

/** Label/badge chip. Soft rect = label, solid pill = badge; mix the axes as needed. */
export function Chip({ type = 'neutral', emphasis = 'soft', shape = 'rect', size = 'small', className, style, title, children, ...rest }: ChipProps & Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'className' | 'style' | 'title'>) {
  return (
    <span className={chipClass({ shape, size, className: className ?? '' })} style={{ ...chipVars(type, emphasis), ...style }} title={title} {...rest}>
      {children}
    </span>
  );
}

/** A chip that is a real button (clickable is a state derived from having onClick). */
export function ChipButton({ type = 'neutral', emphasis = 'soft', shape = 'rect', size = 'small', className, style, title, children, ...rest }: ChipProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'style' | 'title' | 'type'>) {
  return (
    <button type="button" className={chipClass({ shape, size, clickable: true, className: className ?? '' })} style={{ ...chipVars(type, emphasis), ...style }} title={title} {...rest}>
      {children}
    </button>
  );
}
