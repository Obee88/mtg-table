import type { GameCommand, RoomState } from '@mtg/shared';
import { isActive, seatedPlayers } from '@mtg/shared';
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
export function GamePanel({ state, meId, run, leaveHref, onEndGame, onNewGame, onForfeit }: {
  state: RoomState;
  meId: string;
  run: Run;
  leaveHref: string;
  onEndGame?: (() => void) | undefined;
  onNewGame?: (() => void) | undefined;
  onForfeit?: (() => void) | undefined;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const navigate = useNavigate();
  const game = state.game!;
  const players = seatedPlayers(state);
  const me = state.players[meId];
  const teams = state.settings.mode === '2v2' && game.teamLife;

  const items = (): (MenuItem | 'sep')[] => {
    const out: (MenuItem | 'sep')[] = [];
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
      <div className="absolute left-2 top-1/2 z-40 flex w-28 -translate-y-1/2 flex-col gap-1 rounded-xl border border-white/15 bg-black/50 p-2 shadow-2xl backdrop-blur-sm">
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
          const mine = p.id === meId || (state.settings.mode === '2v2' && !!me && me.team === p.team);
          return (
            <span key={p.id} className={`flex items-center gap-1 rounded-md px-1 py-0.5 ${isActive(state, p.id) ? 'bg-white/10' : ''}`} title={isActive(state, p.id) ? `${p.displayName} · their turn` : p.displayName}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: playerColor(state, p) }} />
              <span className="min-w-0 flex-1 truncate text-[11px] text-white/70">{teams ? `Team ${p.team + 1}` : p.displayName}</span>
              <span className="min-w-[2.2ch] text-right text-base font-semibold tabular-nums text-white">{life}</span>
              {mine && (
                <span className="flex flex-col leading-none">
                  <button type="button" className="touch-target px-0.5 text-[10px] text-white/50 hover:text-white" onClick={() => void run({ type: 'adjustLife', delta: 1 })} aria-label="life plus one">▲</button>
                  <button type="button" className="touch-target px-0.5 text-[10px] text-white/50 hover:text-white" onClick={() => void run({ type: 'adjustLife', delta: -1 })} aria-label="life minus one">▼</button>
                </span>
              )}
            </span>
          );
        })}
        <Link to={leaveHref} className="mt-0.5 text-center text-[10px] text-white/40 hover:text-white/80">leave room</Link>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items()} onClose={() => setMenu(null)} header="Game" />}
    </>
  );
}
