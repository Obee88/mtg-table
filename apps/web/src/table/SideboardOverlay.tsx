import type { DeckContents, GameCommand, RoomState } from '@mtg/shared';
import { seatedPlayers } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { CardImage } from '../cards/CardImage';
import { Button } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { useCards } from './useCards';

type Run = (c: GameCommand) => Promise<void>;

/**
 * Sideboarding, before the opening hands. The deck list comes from the server
 * (the library itself is hidden even from its owner); clicking a card moves one
 * copy across. Finishing with changes redraws the hand.
 */
export function SideboardOverlay({ state, meId, run }: { state: RoomState; meId: string; run: Run }) {
  const game = state.game!;
  const me = game.sideboarding?.[meId];
  const deck = useQuery({
    queryKey: ['rooms', state.id, 'deck', game.gameNumber, state.seq],
    queryFn: () => api<DeckContents>(`/rooms/${state.id}/deck`),
    enabled: !!me && !me.done,
    placeholderData: (prev) => prev,
  });
  const printings = useCards([...(deck.data?.main ?? []), ...(deck.data?.sideboard ?? [])].map((c) => c.printingId));
  const name = (id: string) => printings.get(id)?.name ?? '…';
  const sorted = (cards: { printingId: string; quantity: number }[]) => [...cards].sort((a, b) => name(a.printingId).localeCompare(name(b.printingId)));
  const count = (cards: { quantity: number }[] | undefined) => (cards ?? []).reduce((n, c) => n + c.quantity, 0);

  const column = (title: string, cards: { printingId: string; quantity: number }[] | undefined, dir: 'toSide' | 'toMain') => (
    <div className="flex min-h-0 flex-1 flex-col">
      <h3 className="mb-2 text-sm font-medium">{title} · {count(cards)}</h3>
      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-1">
        {sorted(cards ?? []).map((c) => {
          const p = printings.get(c.printingId);
          return (
            <li key={c.printingId}>
              <button
                type="button"
                onClick={() => void run(dir === 'toSide' ? { type: 'sideboardSwap', toMain: [], toSide: [{ printingId: c.printingId, quantity: 1 }] } : { type: 'sideboardSwap', toMain: [{ printingId: c.printingId, quantity: 1 }], toSide: [] })}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm hover:bg-surface-raised"
                title={dir === 'toSide' ? 'Move one copy to the sideboard' : 'Move one copy into the deck'}
              >
                {p && <CardImage card={p} className="w-6 shrink-0" />}
                <span className="w-6 text-right tabular-nums text-text-muted">{c.quantity}×</span>
                <span className="min-w-0 flex-1 truncate">{name(c.printingId)}</span>
                <span className="text-text-muted">{dir === 'toSide' ? '→' : '←'}</span>
              </button>
            </li>
          );
        })}
        {cards && cards.length === 0 && <li className="text-sm text-text-muted">Empty.</li>}
      </ul>
    </div>
  );

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px]">
      <div className="flex h-[min(80vh,640px)] w-[min(92vw,900px)] flex-col gap-4 rounded-xl border border-white/10 bg-surface/95 p-5 shadow-2xl">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">Sideboarding · game {game.gameNumber ?? 1}</h2>
          <ul className="ml-auto flex gap-2">
            {seatedPlayers(state).map((p) => {
              const s = game.sideboarding?.[p.id];
              return (
                <li key={p.id}>
                  <Chip type={s?.done ? 'success' : 'neutral'}>{p.displayName}{s?.done ? ' · done' : s?.changed ? ' · changing' : ' · looking'}</Chip>
                </li>
              );
            })}
          </ul>
        </div>
        {me && !me.done ? (
          <>
            <div className="flex min-h-0 flex-1 gap-6">
              {column('Deck', deck.data?.main, 'toSide')}
              {column('Sideboard', deck.data?.sideboard, 'toMain')}
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm text-text-muted">{me.changed ? 'Your hand will be redrawn when you finish.' : 'Click a card to move one copy across. Finish with no changes to keep your hand.'}</p>
              <Button className="ml-auto" onClick={() => void run({ type: 'finishSideboarding' })}>{me.changed ? 'Finish & redraw' : 'No changes'}</Button>
            </div>
          </>
        ) : (
          <p className="text-center text-sm text-text-muted">{me ? 'You are done. Waiting for the others…' : 'Waiting for the players to finish sideboarding…'}</p>
        )}
      </div>
    </div>
  );
}
