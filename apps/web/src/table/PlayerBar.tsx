import type { GameCommand, PlayerGameState, RoomPlayer, RoomState } from '@mtg/shared';
import { useState } from 'react';
import { Button } from '../components';

type Run = (c: GameCommand) => Promise<void>;

/** Life, poison, counters, commander tracking and dice for one player. Only the owner's controls are interactive. */
export function PlayerBar({ state, player, pgs, mine, run }: { state: RoomState; player: RoomPlayer; pgs: PlayerGameState; mine: boolean; run: Run }) {
  const [dice, setDice] = useState('20');
  const shared = state.settings.mode === '2v2' && state.game?.teamLife;
  const life = shared ? (state.game!.teamLife![player.team] ?? pgs.life) : pgs.life;
  const opponents = Object.values(state.players).filter((p) => p.id !== player.id);

  const Stepper = ({ label, value, onDelta, big = false }: { label: string; value: number; onDelta: (d: number) => void; big?: boolean }) => (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-0.5">
      <span className="text-text-muted">{label}</span>
      {mine && <button type="button" className="px-1 text-text-muted hover:text-text" onClick={() => onDelta(-1)} aria-label={`${label} minus one`}>−</button>}
      <span className={`tabular-nums ${big ? 'text-base font-semibold' : ''}`}>{value}</span>
      {mine && <button type="button" className="px-1 text-text-muted hover:text-text" onClick={() => onDelta(1)} aria-label={`${label} plus one`}>+</button>}
    </span>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Stepper label={shared ? `team ${player.team + 1} life` : 'life'} value={life} onDelta={(d) => void run({ type: 'adjustLife', delta: d })} big />
      {mine && (
        <span className="flex gap-1">
          {[-5, -3, +3, +5].map((d) => (
            <button key={d} type="button" className="rounded border border-border px-1.5 text-xs text-text-muted hover:text-text" onClick={() => void run({ type: 'adjustLife', delta: d })}>{d > 0 ? `+${d}` : d}</button>
          ))}
        </span>
      )}
      <Stepper label="poison" value={pgs.poison} onDelta={(d) => void run({ type: 'adjustPoison', delta: d })} />
      {state.settings.commander && (
        <>
          <Stepper label="cmdr tax" value={pgs.commanderTax} onDelta={(d) => void run({ type: 'adjustCommanderTax', delta: d })} />
          {opponents.map((o) => (
            <Stepper key={o.id} label={`from ${o.displayName}`} value={pgs.commanderDamage[o.id] ?? 0} onDelta={(d) => void run({ type: 'adjustCommanderDamage', fromPlayerId: o.id, delta: d })} />
          ))}
        </>
      )}
      {Object.entries(pgs.counters).map(([kind, value]) => (
        <Stepper key={kind} label={kind} value={value} onDelta={(d) => void run({ type: 'adjustPlayerCounter', kind, delta: d })} />
      ))}
      {mine && (
        <>
          <Button
            variant="ghost"
            className="!px-2 !py-0.5 text-xs"
            onClick={() => {
              const kind = prompt('Counter name (energy, experience, …):');
              if (kind?.trim()) void run({ type: 'adjustPlayerCounter', kind: kind.trim(), delta: 1 });
            }}
          >
            + counter
          </Button>
          <span className="ml-auto inline-flex items-center gap-1">
            <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => void run({ type: 'rollDice', sides: 6, count: 1 })}>d6</Button>
            <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => void run({ type: 'rollDice', sides: 20, count: 1 })}>d20</Button>
            <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => void run({ type: 'flipCoin', count: 1 })}>coin</Button>
            <input value={dice} onChange={(e) => setDice(e.target.value)} className="w-16 rounded border border-border bg-surface px-1 py-0.5 text-xs" aria-label="dice expression" title="e.g. 3d6 or 100" />
            <Button
              variant="ghost"
              className="!px-2 !py-0.5 text-xs"
              onClick={() => {
                const m = /^(\d*)d?(\d+)$/i.exec(dice.trim());
                if (!m) return;
                const count = m[1] ? Number(m[1]) : 1;
                const sides = Number(m[2]);
                void run({ type: 'rollDice', sides, count });
              }}
            >
              roll
            </Button>
          </span>
        </>
      )}
    </div>
  );
}
