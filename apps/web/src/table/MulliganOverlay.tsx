import type { CardInstance, CardPrinting, GameCommand, RoomState } from '@mtg/shared';
import { seatedPlayers } from '@mtg/shared';
import { useState } from 'react';
import { Button } from '../components';
import { Chip } from '../components/Chip';
import { TableCard } from './TableCard';

type Run = (c: GameCommand) => Promise<void>;

/**
 * Opening-hand phase. Blocks the table until everyone has kept. The player
 * mulligans (redraw seven) or keeps; after n mulligans they choose n cards to
 * put on the bottom before keeping.
 */
export function MulliganOverlay({ state, meId, printings, run }: { state: RoomState; meId: string; printings: Map<string, CardPrinting>; run: Run }) {
  const game = state.game!;
  const me = game.mulligans[meId];
  const pgs = game.players[meId];
  const [bottom, setBottom] = useState<ReadonlySet<string>>(new Set());
  const hand = (pgs?.zones.hand ?? []).map((id) => game.cards[id]).filter((c): c is CardInstance => !!c);
  const need = me?.taken ?? 0;
  const canKeep = !!me && !me.kept && bottom.size === need;

  const toggle = (id: string) => {
    if (!me || me.kept || need === 0) return;
    setBottom((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < need) next.add(id);
      return next;
    });
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
      <div className="flex max-w-[92vw] flex-col gap-4 rounded-xl border border-white/10 bg-surface/95 p-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Opening hands</h2>
          <ul className="ml-auto flex gap-2">
            {seatedPlayers(state).map((p) => {
              const m = game.mulligans[p.id];
              return (
                <li key={p.id}>
                  <Chip type={m?.kept ? 'success' : 'neutral'}>
                    {p.displayName}{m?.kept ? ' · kept' : m && m.taken > 0 ? ` · mulligan ${m.taken}` : ' · deciding'}
                  </Chip>
                </li>
              );
            })}
          </ul>
        </div>

        {/* The roll for first happened at the deal; show it so the mulligan decision is informed. */}
        <p className="text-center text-sm">
          <span className="text-text-muted">Rolled for first: </span>
          {seatedPlayers(state).map((p, i) => (
            <span key={p.id}>
              {i > 0 && <span className="text-text-muted"> · </span>}
              <span className={p.id === game.firstPlayerId ? 'font-semibold text-text' : 'text-text-muted'}>{p.displayName} {game.openingRoll?.[p.id] ?? '?'}</span>
            </span>
          ))}
          <span className="text-text-muted"> — </span>
          <span className="font-semibold text-accent">{game.firstPlayerId === meId ? 'you go first' : `${state.players[game.firstPlayerId]?.displayName ?? 'someone'} goes first`}</span>
          {state.settings.mode === '2v2' && <span className="text-text-muted"> (their team's turn)</span>}
        </p>

        {me && !me.kept ? (
          <>
            <div className="flex flex-wrap justify-center gap-2">
              {hand.map((c) => (
                <button key={c.id} type="button" onClick={() => toggle(c.id)} className={`rounded-[4.5%] transition ${need > 0 ? 'cursor-pointer' : 'cursor-default'} ${bottom.has(c.id) ? 'opacity-40 ring-2 ring-accent' : ''}`} title={need > 0 ? (bottom.has(c.id) ? 'keep this card' : 'put on the bottom') : undefined}>
                  <TableCard card={c} printing={c.printingId ? printings.get(c.printingId) : undefined} mine={false} />
                </button>
              ))}
            </div>
            <p className="text-center text-sm text-text-muted">
              {need === 0 ? 'Keep these seven, or take a mulligan.' : `You took ${need} mulligan${need === 1 ? '' : 's'}: choose ${need} card${need === 1 ? '' : 's'} to put on the bottom, then keep.`}
            </p>
            <div className="flex justify-center gap-3">
              <Button variant="ghost" onClick={() => { setBottom(new Set()); void run({ type: 'mulligan' }); }} disabled={need >= 7}>
                Mulligan{need > 0 ? ` (to ${Math.max(0, 7 - need - 1)})` : ''}
              </Button>
              <Button onClick={() => void run({ type: 'keepHand', bottom: [...bottom] })} disabled={!canKeep}>
                Keep{need > 0 ? ` ${7 - need}` : ''}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-text-muted">{me ? 'You kept your hand. Waiting for the others…' : 'Waiting for the players to keep their hands…'}</p>
        )}
      </div>
    </div>
  );
}
