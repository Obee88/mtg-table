import type { GameCommand, RoomState } from '@mtg/shared';
import { isActive, manaTotal, MANA_SYMBOLS, seatedPlayers } from '@mtg/shared';
import { useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Chip, ChipButton } from '../components/Chip';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { playerColor } from './PlayerStrip';

type Run = (c: GameCommand) => Promise<void>;

/**
 * The game panel: an overlay at the left edge of the battlefield, mirroring
 * the stack on the right. Life totals for everyone at a glance (own and
 * teammates' adjustable), and the actions that end or leave the game.
 */
export function GamePanel({ state, meId, run, leaveHref, onEndGame, onNewGame, onForfeit, stackShown = false, onShowStack, onPreferences, side = 'left' }: {
  state: RoomState;
  meId: string;
  run: Run;
  leaveHref: string;
  onEndGame?: (() => void) | undefined;
  onNewGame?: (() => void) | undefined;
  onForfeit?: (() => void) | undefined;
  /** The stack overlay is a per-player preference, offered here and from its own label. */
  stackShown?: boolean;
  onShowStack?: ((show: boolean) => void) | undefined;
  /** Opens the UI preferences dialog (what this browser shows). */
  onPreferences?: (() => void) | undefined;
  /** Which edge of the battlefield it hugs; the stack takes the other one. */
  side?: 'left' | 'right';
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const navigate = useNavigate();
  const game = state.game!;
  const me = state.players[meId];
  const teams = state.settings.mode === '2v2' && game.teamLife;
  // Mirror the table: the others across from me, my own side at the bottom.
  const ownSide = (p: { id: string; team: number }) => (teams && me ? Number(p.team === me.team) : Number(p.id === meId));
  const players = [...seatedPlayers(state)].sort((a, b) => ownSide(a) - ownSide(b) || a.seat - b.seat);

  const items = (): (MenuItem | 'sep')[] => {
    const out: (MenuItem | 'sep')[] = [];
    if (onShowStack) out.push({ label: stackShown ? 'Hide the stack' : 'Show the stack', onSelect: () => onShowStack(!stackShown) });
    if (onPreferences) out.push({ label: 'UI preferences…', onSelect: onPreferences });
    // Time Walk and friends: queue an extra turn for yourself; the most recent one is taken first.
    if (me) {
      const owed = (game.extraTurns ?? []).filter((id) => id === meId).length;
      out.push({ label: owed ? `Take another extra turn (${owed} queued)` : 'Take an extra turn after this one', onSelect: () => void run({ type: 'queueExtraTurn' }) });
      if (owed) out.push({ label: 'Cancel my extra turn', onSelect: () => void run({ type: 'cancelExtraTurn' }) });
    }
    out.push('sep');
    if (onForfeit) out.push({ label: 'Forfeit this game', onSelect: onForfeit });
    if (onNewGame) out.push({ label: 'New game…', onSelect: onNewGame });
    if (onEndGame) out.push({ label: 'End game…', onSelect: onEndGame });
    if (out.length > 0) out.push('sep');
    out.push({ label: 'Leave room', onSelect: () => navigate(leaveHref) });
    return out;
  };

  const open = (e: MouseEvent) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: r.right + 4, y: r.top });
  };

  return (
    <>
      <div className={`absolute ${side === 'left' ? 'left-2' : 'right-2'} top-1/2 z-40 flex max-h-[80%] w-32 -translate-y-1/2 flex-col gap-1 overflow-y-auto rounded-xl border border-white/15 bg-black/50 p-2 shadow-2xl backdrop-blur-sm`}>
        <span className="flex items-center gap-1">
          <Chip type="neutral" className="flex-1 justify-center uppercase tracking-wider">game {game.gameNumber ?? 1}</Chip>
          <ChipButton type="neutral" onClick={open} onContextMenu={open} title="Game actions">⋯</ChipButton>
        </span>
        {players.map((p) => {
          const pgs = game.players[p.id];
          if (!pgs) return null;
          const life = teams ? (game.teamLife![p.team] ?? pgs.life) : pgs.life;
          // In 2v2 a team shares one total, so only the first seat of each team shows it.
          if (teams && players.find((x) => x.team === p.team)!.id !== p.id) return null;
          // Anyone at the table may adjust anyone's total: the attacker deals the damage.
          const mine = p.id === meId || (state.settings.mode === '2v2' && !!me && me.team === p.team);
          const who = teams ? `Team ${p.team + 1}` : p.displayName;
          return (
            <span key={p.id} className={`flex items-center gap-1 rounded-md px-1 py-0.5 ${isActive(state, p.id) ? 'bg-white/10' : ''}`} title={isActive(state, p.id) ? `${p.displayName} · their turn` : p.displayName}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: playerColor(state, p) }} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-white/70">{who}</span>
              <button
                type="button"
                disabled={!me}
                onClick={() => void run({ type: 'adjustLife', delta: 1, playerId: p.id })}
                onContextMenu={(e) => { e.preventDefault(); void run({ type: 'adjustLife', delta: -1, playerId: p.id }); }}
                className="touch-target min-w-[2.2ch] rounded px-1 text-right text-base font-semibold tabular-nums text-white enabled:hover:bg-white/10"
                title={mine ? 'Click to gain a life, right-click to lose one' : `${who}: click to add a life, right-click to take one`}
              >
                {life}
              </button>
            </span>
          );
        })}
        {players.map((p) => {
          const pgs = game.players[p.id];
          if (!pgs) return null;
          const mine = p.id === meId;
          return <Resources key={p.id} player={p} pgs={pgs} mine={mine} single={players.length === 2} run={run} />;
        })}
        <Link to={leaveHref} className="mt-0.5 text-center text-[10px] text-white/40 hover:text-white/80">leave room</Link>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items()} onClose={() => setMenu(null)} header="Game" />}
    </>
  );
}

/** Resources a player tracks besides life. At zero they are just an icon; clicking one opens its counter. */
const RESOURCES: { key: string; icon: string; label: string }[] = [
  { key: 'poison', icon: '☠', label: 'Poison' },
  { key: 'energy', icon: '⚡', label: 'Energy' },
  { key: 'experience', icon: '★', label: 'Experience' },
];

function Resources({ player, pgs, mine, single, run }: { player: { id: string; displayName: string }; pgs: NonNullable<RoomState['game']>['players'][string]; mine: boolean; single: boolean; run: Run }) {
  const [open, setOpen] = useState<string | null>(null);
  const [pool, setPool] = useState(false);
  const value = (key: string) => (key === 'poison' ? pgs.poison : (pgs.counters[key] ?? 0));
  const custom = Object.keys(pgs.counters).filter((k) => !RESOURCES.some((r) => r.key === k));
  const kinds = [...RESOURCES, ...custom.map((key) => ({ key, icon: key.slice(0, 1).toUpperCase(), label: key }))];
  const adjust = (key: string, delta: number) => void run(key === 'poison' ? { type: 'adjustPoison', delta } : { type: 'adjustPlayerCounter', kind: key, delta });
  const manaShown = pgs.manaOpen || manaTotal(pgs.mana ?? {}) > 0 || (mine && pool);

  return (
    <div className="flex flex-col gap-1 border-t border-white/10 pt-1">
      {!single && <span className="truncate text-[10px] text-white/40">{player.displayName}</span>}
      <span className="flex flex-wrap items-center gap-0.5">
        {kinds.map((r) => {
          const n = value(r.key);
          // Only what is in play shows a number; the rest stay icons until asked for.
          const showValue = n > 0 || open === r.key;
          if (!mine && n === 0) return null;
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => setOpen((o) => (o === r.key ? null : r.key))}
              className={`touch-target rounded px-1 text-[11px] leading-none ${showValue ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
              title={`${r.label}${n > 0 ? `: ${n}` : ''}`}
            >
              {r.icon}{showValue ? ` ${n}` : ''}
            </button>
          );
        })}
        {mine && (
          <>
            <button type="button" onClick={() => { setPool((v) => !v); void run({ type: 'setManaPool', open: !manaShown }); }} className="touch-target rounded px-1 text-[11px] leading-none text-white/40 hover:text-white" title="Mana pool">◎</button>
            <button
              type="button"
              onClick={() => {
                const kind = prompt('Track which counter?');
                if (kind?.trim()) adjust(kind.trim(), 1);
              }}
              className="touch-target rounded px-1 text-[11px] leading-none text-white/30 hover:text-white"
              title="Track another counter"
            >
              +
            </button>
          </>
        )}
      </span>
      {mine && open && (
        <span className="flex items-center gap-1 rounded-md bg-white/10 px-1 py-0.5">
          <span className="min-w-0 flex-1 truncate text-[10px] text-white/70">{kinds.find((r) => r.key === open)?.label ?? open}</span>
          <button
            type="button"
            onClick={() => adjust(open, 1)}
            onContextMenu={(e) => { e.preventDefault(); adjust(open, -1); }}
            className="touch-target min-w-[2ch] rounded px-1 text-right text-sm font-semibold tabular-nums text-white hover:bg-white/10"
            title="Click to add one, right-click to remove one"
          >
            {value(open)}
          </button>
        </span>
      )}
      {manaShown && <ManaPool pgs={pgs} mine={mine} run={run} />}
    </div>
  );
}

const MANA_COLOUR: Record<string, string> = { W: '#f3ead3', U: '#2f7fd0', B: '#5b4b6b', R: '#d64a3a', G: '#3f9a52', C: '#9aa2ad' };

/** Floating mana: one icon per symbol, with the amount; the owner adds, spends and empties. */
function ManaPool({ pgs, mine, run }: { pgs: NonNullable<RoomState['game']>['players'][string]; mine: boolean; run: Run }) {
  const pool = pgs.mana ?? {};
  return (
    <span className="flex flex-wrap items-center gap-0.5 rounded-md bg-black/40 p-1">
      {MANA_SYMBOLS.map((s) => {
        const n = pool[s] ?? 0;
        if (!mine && n === 0) return null;
        return (
          <button
            key={s}
            type="button"
            disabled={!mine}
            onClick={() => void run({ type: 'adjustMana', symbol: s, delta: 1 })}
            onContextMenu={(e) => { e.preventDefault(); if (mine) void run({ type: 'adjustMana', symbol: s, delta: -1 }); }}
            className={`touch-target flex items-center gap-0.5 rounded-full px-1 text-[11px] font-semibold leading-none ${n > 0 ? 'text-black' : 'text-black/40'}`}
            style={{ background: MANA_COLOUR[s], opacity: n > 0 ? 1 : 0.35 }}
            title={mine ? `${s}: click to add, right-click to spend` : `${s}: ${n}`}
          >
            {s}{n > 0 ? ` ${n}` : ''}
          </button>
        );
      })}
      {mine && manaTotal(pool) > 0 && (
        <button type="button" onClick={() => void run({ type: 'emptyManaPool' })} className="touch-target rounded px-1 text-[10px] text-white/50 hover:text-white" title="Empty the pool">empty</button>
      )}
    </span>
  );
}
