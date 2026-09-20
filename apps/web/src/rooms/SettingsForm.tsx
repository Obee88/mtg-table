import type { RoomSettings } from '@mtg/shared';
import { useState } from 'react';

const LIFE_PRESETS = [20, 30, 40] as const;

/** Player count, mode, starting life (20/30/40/custom) and commander toggle. */
export function SettingsForm({ value, onChange, disabled = false }: { value: RoomSettings; onChange: (s: RoomSettings) => void; disabled?: boolean }) {
  const [customLife, setCustomLife] = useState(!LIFE_PRESETS.includes(value.startingLife as (typeof LIFE_PRESETS)[number]));
  const set = (patch: Partial<RoomSettings>) => {
    const next = { ...value, ...patch };
    // Keep mode and player count consistent.
    if (next.playerCount === 2) next.mode = '1v1';
    else if (next.mode === '1v1') next.mode = 'ffa';
    onChange(next);
  };
  const select = 'rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text disabled:opacity-60';

  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <label>
        <span className="mb-1 block text-text-muted">Players</span>
        <select className={select} value={value.playerCount} disabled={disabled || !!value.draft} title={value.draft ? 'Fixed by the draft format' : undefined} onChange={(e) => set({ playerCount: Number(e.target.value) as 2 | 4 })}>
          <option value={2}>2</option>
          <option value={4}>4</option>
        </select>
      </label>
      <label>
        <span className="mb-1 block text-text-muted">Mode</span>
        <select className={select} value={value.mode} disabled={disabled || value.playerCount === 2} onChange={(e) => set({ mode: e.target.value as RoomSettings['mode'] })}>
          {value.playerCount === 2 ? <option value="1v1">1v1</option> : (
            <>
              <option value="ffa">Free-for-all</option>
              <option value="2v2">2v2 (shared life)</option>
            </>
          )}
        </select>
      </label>
      <label>
        <span className="mb-1 block text-text-muted">Starting life</span>
        <span className="flex items-center gap-1">
          <select
            className={select}
            value={customLife ? 'custom' : value.startingLife}
            disabled={disabled}
            onChange={(e) => {
              if (e.target.value === 'custom') setCustomLife(true);
              else {
                setCustomLife(false);
                set({ startingLife: Number(e.target.value) });
              }
            }}
          >
            {LIFE_PRESETS.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value="custom">custom…</option>
          </select>
          {customLife && (
            <input type="number" min={1} max={999} className={`${select} w-20`} value={value.startingLife} disabled={disabled} onChange={(e) => set({ startingLife: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })} aria-label="custom starting life" />
          )}
        </span>
      </label>
      <label className="flex items-center gap-2 pb-2">
        <input type="checkbox" checked={value.commander} disabled={disabled} onChange={(e) => set({ commander: e.target.checked })} />
        Commander (command zone, tax, commander damage)
      </label>
    </div>
  );
}
