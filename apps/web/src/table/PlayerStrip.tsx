import type { GameCommand, PlayerGameState, RoomPlayer, RoomState } from '@mtg/shared';
import { colorIndex, isActive } from '@mtg/shared';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Chip } from '../components/Chip';
import { PhaseTracker } from './PhaseTracker';

type Run = (c: GameCommand) => Promise<void>;

export const seatColor = (seat: number) => `var(--color-seat-${seat % 4})`;
/** A player's colour: team colour in 2v2 (partners match), seat colour otherwise. */
export const playerColor = (state: RoomState, player: RoomPlayer) => seatColor(colorIndex(state, player));

/**
 * One line per player at the far edge of their half: identity, life, poison,
 * counters, commander tracking, zone counts. The owner's numbers are
 * adjustable via hover/click; the owner's strip also carries the toolbar.
 */
export function PlayerStrip({ state, player, pgs, mine, connected, run, toolbar, onFocus, focused = false }: {
  /** Click the name to focus/unfocus this board (3+ players). */
  onFocus?: (() => void) | undefined;
  focused?: boolean;
  state: RoomState;
  player: RoomPlayer;
  pgs: PlayerGameState;
  mine: boolean;
  connected: boolean;
  run: Run;
  toolbar?: ReactNode;
}) {
  // Each player counts their own turns.
  const turn = state.game?.turns?.[player.id] ?? state.game?.turn ?? 1;
  const opponents = Object.values(state.players).filter((p) => p.id !== player.id);
  const first = state.game?.firstPlayerId === player.id;
  const myTurn = isActive(state, player.id);
  const team = state.settings.mode === '2v2';
  const extra = (state.game?.extraTurns ?? []).filter((id) => id === player.id).length;

  return (
    <div className="flex h-9 min-w-0 items-center gap-2 px-2 text-[13px] leading-none">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: connected ? playerColor(state, player) : 'var(--color-border)' }} title={connected ? 'online' : 'offline'} />
      {onFocus ? (
        <button type="button" onClick={onFocus} className={`truncate font-semibold hover:underline ${focused ? 'underline' : ''}`} style={{ color: playerColor(state, player) }} title={focused ? 'Back to all boards (Esc)' : `Focus this board (${player.seat + 1})`}>
          {player.displayName}{focused ? ' ⤢' : ''}
        </button>
      ) : (
        <span className="truncate font-semibold" style={{ color: playerColor(state, player) }}>{player.displayName}</span>
      )}
      {first && !myTurn && <Chip type="neutral" title="rolled highest">1st</Chip>}
      {team && <Chip type="neutral" title="team">team {player.team + 1}</Chip>}
      {myTurn && <Chip type="primary" title={`their own turn ${turn}`}>{mine ? (team ? "Your team's turn" : 'Your turn') : team ? `Team ${player.team + 1}'s turn` : `${player.displayName}'s turn`} · {turn}</Chip>}
      {extra > 0 && <Chip type="warning" title="owed an extra turn after the current one">extra turn{extra > 1 ? ` ×${extra}` : ''}</Chip>}
      {/* Life, poison and the other resources live in the game panel now. */}
      <PhaseTracker step={state.game?.step ?? 'main1'} active={myTurn} mine={mine} run={run} />
      {state.settings.commander && (
        <>
          <Stat label="tax" value={pgs.commanderTax} mine={mine} onDelta={(d) => void run({ type: 'adjustCommanderTax', delta: d })} dim={pgs.commanderTax === 0} />
          {opponents.map((o) => (
            <Stat key={o.id} label={`⚔ ${o.displayName}`} value={pgs.commanderDamage[o.id] ?? 0} mine={mine} onDelta={(d) => void run({ type: 'adjustCommanderDamage', fromPlayerId: o.id, delta: d })} dim={!pgs.commanderDamage[o.id]} />
          ))}
        </>
      )}
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
        <span className={`inline-block text-center tabular-nums ${big ? 'min-w-[2.2ch] text-xl font-semibold text-text' : 'min-w-[1.4ch] text-text'}`}>{value}</span>
        <span className={big ? 'text-[11px] text-text-muted' : 'opacity-80'}>{label}</span>
      </button>
      {mine && (
        <span className="reveal-on-hover inline-flex">
          <button type="button" className="touch-target px-1 text-text-muted hover:text-text" onClick={() => onDelta(-1)} aria-label={`${label} minus one`}>−</button>
          <button type="button" className="touch-target px-1 text-text-muted hover:text-text" onClick={() => onDelta(1)} aria-label={`${label} plus one`}>+</button>
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
