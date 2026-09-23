import type { CardInstance, CardPrinting, LibraryView, RoomPlayer } from '@mtg/shared';
import { Dialog } from '../components';
import { Chip } from '../components/Chip';
import { CardSizeProvider, DEFAULT_CARD_SIZE } from './cardSize';
import { CardBack, TableCard } from './TableCard';
import { PLACED_LABEL } from './LibraryViewDialog';

/**
 * Another player is looking through their library. Top-n: that many backs,
 * turned face up as they are revealed, labelled as they are placed. Search:
 * only the cards acted on appear (backs or fronts), so the order stays secret.
 */
export function LibraryPeek({ player, view, cards, printings }: { player: RoomPlayer; view: LibraryView; cards: Record<string, CardInstance>; printings: Map<string, CardPrinting> }) {
  const ids = view.kind === 'top' ? view.cards : view.cards.filter((id) => view.placed[id] || view.revealed.includes(id));
  const title = view.kind === 'top' ? `${player.displayName} is looking at the top ${view.cards.length} card${view.cards.length === 1 ? '' : 's'} of their library` : `${player.displayName} is searching their library`;
  return (
    <Dialog title={title} onClose={() => undefined} dismissible={false}>
      <p className="mb-3 text-sm text-text-muted">{view.kind === 'search' ? `${view.cards.length} cards in the library. Cards appear here as ${player.displayName} reveals or places them.` : 'Cards turn face up when revealed; a label says where each one went. This closes when they are done.'}</p>
      <CardSizeProvider size={DEFAULT_CARD_SIZE}>
        <ul className="flex flex-wrap gap-3">
          {ids.map((id, i) => {
            const c = cards[id];
            const known = !!c && c.printingId !== null;
            const placed = view.placed[id];
            return (
              <li key={id} className="flex w-24 flex-col items-center gap-1 text-center text-xs">
                {known ? <TableCard card={c} printing={printings.get(c.printingId!)} mine={false} /> : <div style={{ width: DEFAULT_CARD_SIZE.w, height: DEFAULT_CARD_SIZE.h }}><CardBack /></div>}
                <span className="text-text-muted">{view.kind === 'top' ? `#${i + 1}` : ''}{known ? ` ${printings.get(c.printingId!)?.name ?? ''}` : ''}</span>
                {placed && <Chip type="primary">{PLACED_LABEL[placed] ?? placed}</Chip>}
              </li>
            );
          })}
          {ids.length === 0 && <li className="text-sm text-text-muted">Nothing shown yet.</li>}
        </ul>
      </CardSizeProvider>
    </Dialog>
  );
}
