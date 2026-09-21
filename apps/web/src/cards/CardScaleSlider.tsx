import { CARD_SCALE_MAX, CARD_SCALE_MIN } from './cardScale';

/** Compact card-size control: drag to scale, double-click to reset. */
export function CardScaleSlider({ value, onChange, className = '' }: { value: number; onChange: (v: number) => void; className?: string }) {
  return (
    <label className={`flex items-center gap-1 text-[11px] text-white/50 ${className}`} title="Card size (double-click to reset)">
      <span aria-hidden>▫</span>
      <input
        type="range"
        min={CARD_SCALE_MIN}
        max={CARD_SCALE_MAX}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(1)}
        className="h-1 w-20 cursor-pointer accent-[var(--color-accent)]"
        aria-label="Card size"
      />
      <span aria-hidden>◻</span>
    </label>
  );
}
