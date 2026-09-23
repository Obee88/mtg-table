import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export function Button({ className = '', variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }) {
  const base = 'rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const look =
    variant === 'primary'
      ? 'bg-accent text-bg hover:bg-accent-hover'
      : 'bg-transparent text-text border border-border hover:bg-surface-raised';
  return <button className={`${base} ${look} ${className}`} {...props} />;
}

export function Input({ label, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-text-muted">{label}</span>
      <input
        className={`w-full rounded-md border border-border bg-surface px-3 py-2 text-text outline-none focus:border-accent ${className}`}
        {...props}
      />
    </label>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      {title && <h2 className="mb-4 text-lg font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return <p className="text-sm text-danger">{message}</p>;
}

export function Textarea({ label, className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-text-muted">{label}</span>
      <textarea
        className={`w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent ${className}`}
        {...props}
      />
    </label>
  );
}

export function Dialog({ title, onClose, children, dismissible = true }: { title: string; onClose: () => void; children: ReactNode; /** false: no Close button, no click-outside, no Escape — the content offers the ways out. */ dismissible?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismissible && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, dismissible]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={dismissible ? onClose : undefined} role="presentation">
      <div
        role="dialog"
        aria-label={title}
        className="max-h-full w-full max-w-3xl overflow-auto rounded-lg border border-border bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          {dismissible && <Button variant="ghost" onClick={onClose}>Close</Button>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** The top of every page: title, an optional line under it, actions on the right. */
export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-3 truncate text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-3 text-sm">{actions}</div>}
    </header>
  );
}

/** A list with nothing in it yet: what it is for and the one thing to do about it. */
export function EmptyState({ title, text, action }: { title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-dashed border-border px-4 py-5 text-sm">
      <p className="font-medium">{title}</p>
      {text && <p className="text-text-muted">{text}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** A labelled select in the same skin as Input. */
export function Select({ label, className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; children: ReactNode }) {
  const select = <select className={`rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-accent ${className}`} {...props}>{children}</select>;
  if (!label) return select;
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-text-muted">{label}</span>
      {select}
    </label>
  );
}
