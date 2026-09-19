import type { GameCommand, PlayerGameState, RoomPlayer, RoomState } from '@mtg/shared';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Chip, ChipButton } from '../components/Chip';

type Run = (c: GameCommand) => Promise<void>;

export const seatColor = (seat: number) => `var(--color-seat-${seat % 4})`;

/**
 * One line per player at the far edge of their half: identity, life, poison,
 * counters, commander tracking, zone counts. The owner's numbers are
 * adjustable via hover/click; the owner's strip also carries the toolbar.
 */
export function PlayerStrip({ state, player, pgs, mine, connected, run, toolbar }: {
  state: RoomState;
  player: RoomPlayer;
  pgs: PlayerGameState;
  mine: boolean;
  connected: boolean;
  run: Run;
  toolbar?: ReactNode;
}) {
  const shared = state.settings.mode === '2v2' && state.game?.teamLife;
  const life = shared ? (state.game!.teamLife![player.team] ?? pgs.life) : pgs.life;
  const opponents = Object.values(state.players).filter((p) => p.id !== player.id);
  const first = state.game?.firstPlayerId === player.id;

  return (
    <div className="flex h-9 min-w-0 items-center gap-2 px-2 text-[13px] leading-none">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: connected ? seatColor(player.seat) : 'var(--color-border)' }} title={connected ? 'online' : 'offline'} />
      <span className="truncate font-semibold" style={{ color: seatColor(player.seat) }}>{player.displayName}</span>
      {first && <Chip type="primary" title="goes first">1st</Chip>}

      <Stat label={shared ? `team ${player.team + 1}` : 'life'} value={life} big mine={mine} onDelta={(d) => void run({ type: 'adjustLife', delta: d })} quick={[-5, -3, 3, 5]} />
      {(pgs.poison > 0 || mine) && <Stat label="poison" value={pgs.poison} mine={mine} onDelta={(d) => void run({ type: 'adjustPoison', delta: d })} dim={pgs.poison === 0} />}
      {state.settings.commander && (
        <>
          <Stat label="tax" value={pgs.commanderTax} mine={mine} onDelta={(d) => void run({ type: 'adjustCommanderTax', delta: d })} dim={pgs.commanderTax === 0} />
          {opponents.map((o) => (
            <Stat key={o.id} label={`⚔ ${o.displayName}`} value={pgs.commanderDamage[o.id] ?? 0} mine={mine} onDelta={(d) => void run({ type: 'adjustCommanderDamage', fromPlayerId: o.id, delta: d })} dim={!pgs.commanderDamage[o.id]} />
          ))}
        </>
      )}
      {Object.entries(pgs.counters).map(([kind, value]) => (
        <Stat key={kind} label={kind} value={value} mine={mine} onDelta={(d) => void run({ type: 'adjustPlayerCounter', kind, delta: d })} />
      ))}
      {mine && (
        <ChipButton
          type="neutral"
          className="reveal-on-hover"
          title="Add a named counter (energy, experience…)"
          onClick={() => {
            const kind = prompt('Counter name (energy, experience, …):');
            if (kind?.trim()) void run({ type: 'adjustPlayerCounter', kind: kind.trim(), delta: 1 });
          }}
        >
          + counter
        </ChipButton>
      )}

      <span className="ml-1 truncate text-text-muted">hand {pgs.zones.hand.length} · library {pgs.zones.library.length}</span>
      {toolbar && <span className="ml-auto flex shrink-0 items-center gap-1">{toolbar}</span>}
    </div>
  );
}

/** A number with a label; for the owner, hovering shows ± (and quick deltas for life). */
function Stat({ label, value, mine, onDelta, big = false, dim = false, quick = [] }: {
  label: string;
  value: number;
  mine: boolean;
  onDelta: (d: number) => void;
  big?: boolean;
  dim?: boolean;
  quick?: number[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <span ref={ref} className={`relative inline-flex items-center gap-1 ${big ? 'rounded px-1.5 py-0.5' : 'chip'} ${dim ? 'opacity-50' : ''} ${mine && big ? 'hover:bg-white/5' : ''}`} style={big ? undefined : ({ '--chip-bg': 'var(--chip-soft-neutral-bg)', '--chip-fg': 'var(--chip-soft-neutral-fg)', '--chip-bd': 'var(--chip-soft-neutral-bd)' } as CSSProperties)}>
      <button type="button" disabled={!mine} className="inline-flex items-baseline gap-1 disabled:cursor-default" onClick={() => setOpen((o) => !o)}>
        <span className={`tabular-nums ${big ? 'text-xl font-semibold text-text' : 'text-text'}`}>{value}</span>
        <span className={big ? 'text-[11px] text-text-muted' : 'opacity-80'}>{label}</span>
      </button>
      {mine && (
        <span className="reveal-on-hover inline-flex">
          <button type="button" className="px-1 text-text-muted hover:text-text" onClick={() => onDelta(-1)} aria-label={`${label} minus one`}>−</button>
          <button type="button" className="px-1 text-text-muted hover:text-text" onClick={() => onDelta(1)} aria-label={`${label} plus one`}>+</button>
        </span>
      )}
      {open && mine && quick.length > 0 && (
        <span className="absolute left-0 top-full z-40 mt-1 flex gap-1 rounded-md border border-border bg-surface-raised/95 p-1 shadow-xl backdrop-blur">
          {quick.map((d) => (
            <button key={d} type="button" className="rounded px-2 py-0.5 text-xs hover:bg-white/10" onClick={() => onDelta(d)}>{d > 0 ? `+${d}` : d}</button>
          ))}
        </span>
      )}
    </span>
  );
}
