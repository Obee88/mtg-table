import type { CardInstance, CardPrinting, GameCommand, LibraryView } from '@mtg/shared';
import { useMemo, useState } from 'react';
import { Button, Dialog, Input } from '../components';
import { Chip } from '../components/Chip';
import { CardSizeProvider, DEFAULT_CARD_SIZE } from './cardSize';
import { TableCard } from './TableCard';

type Run = (c: GameCommand) => Promise<void>;

export const PLACED_LABEL: Record<string, string> = { top: 'Top of library', bottom: 'Bottom of library', library: 'Into the library', hand: 'To hand', battlefield: 'To the battlefield', graveyard: 'To the graveyard', exile: 'Exiled', stack: 'Cast', command: 'To the command zone', sideboard: 'To the sideboard' };

/**
 * The owner looking through their library: the top n cards in order, or the
 * whole library alphabetically (a search never shows the order). Each card can
 * go to the top, the bottom, the hand, the battlefield, the graveyard or exile,
 * or be revealed to everyone. The only ways out are Done and Shuffle & close.
 */
export function LibraryViewDialog({ view, cards, printings, run }: { view: LibraryView; cards: Record<string, CardInstance>; printings: Map<string, CardPrinting>; run: Run }) {
  const [query, setQuery] = useState('');
  const name = (c: CardInstance) => (c.printingId ? (printings.get(c.printingId)?.name ?? '') : '');
  const onView = useMemo(() => {
    const list = view.cards.map((id) => cards[id]).filter((c): c is CardInstance => !!c);
    return view.kind === 'search' ? [...list].sort((a, b) => name(a).localeCompare(name(b))) : list;
  }, [view.cards, view.kind, cards, printings]);
  const q = query.trim().toLowerCase();
  const shown = q ? onView.filter((c) => name(c).toLowerCase().includes(q)) : onView;
  const pending = onView.filter((c) => !view.placed[c.id] && c.zone === 'library' && !view.revealed.includes(c.id));
  const move = (c: CardInstance, to: 'top' | 'bottom' | 'hand' | 'battlefield' | 'graveyard' | 'exile') =>
    void run(to === 'top' || to === 'bottom' ? { type: 'moveCard', instanceId: c.id, to: 'library', libraryPosition: to } : { type: 'moveCard', instanceId: c.id, to });
  const reveal = (ids: string[]) => ids.length > 0 && void run({ type: 'revealCards', instanceIds: ids, to: 'all', until: 'dismissed' });
  const btn = '!px-2 !py-0.5 text-xs';

  return (
    <Dialog title={view.kind === 'search' ? `Searching your library · ${view.cards.length} cards` : `Looking at the top ${view.cards.length} card${view.cards.length === 1 ? '' : 's'}`} onClose={() => undefined} dismissible={false}>
      <div className="flex flex-col gap-3">
        {view.kind === 'search' && <Input label="Filter by name" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="type to filter; cards are listed alphabetically, not in library order" />}
        <CardSizeProvider size={DEFAULT_CARD_SIZE}>
          <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
            {shown.map((c, i) => {
              const placed = view.placed[c.id];
              const revealed = view.revealed.includes(c.id);
              return (
                <li key={c.id} className="flex items-center gap-3 rounded-md bg-surface-raised p-2 text-sm">
                  {view.kind === 'top' && <span className="w-6 text-text-muted">{i + 1}</span>}
                  <TableCard card={c} printing={c.printingId ? printings.get(c.printingId) : undefined} mine={false} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{name(c)}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {placed && <Chip type="primary">{PLACED_LABEL[placed] ?? placed}</Chip>}
                      {revealed && <Chip type="warning">revealed to everyone</Chip>}
                    </span>
                  </span>
                  {!placed && c.zone === 'library' && (
                    <span className="flex flex-wrap justify-end gap-1">
                      <Button variant="ghost" className={btn} onClick={() => move(c, 'top')}>Top</Button>
                      <Button variant="ghost" className={btn} onClick={() => move(c, 'bottom')}>Bottom</Button>
                      <Button variant="ghost" className={btn} onClick={() => move(c, 'hand')}>Hand</Button>
                      <Button variant="ghost" className={btn} onClick={() => move(c, 'battlefield')}>Battlefield</Button>
                      <Button variant="ghost" className={btn} onClick={() => move(c, 'graveyard')}>Graveyard</Button>
                      <Button variant="ghost" className={btn} onClick={() => move(c, 'exile')}>Exile</Button>
                      {!revealed && <Button variant="ghost" className={btn} onClick={() => reveal([c.id])}>Reveal</Button>}
                    </span>
                  )}
                </li>
              );
            })}
            {shown.length === 0 && <li className="text-sm text-text-muted">No matching cards.</li>}
          </ul>
        </CardSizeProvider>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={() => reveal(pending.map((c) => c.id))} disabled={pending.length === 0} title="Reveal every card still on view to everyone">Reveal all</Button>
          <span className="flex-1" />
          <Button variant="ghost" onClick={() => void run({ type: 'closeLibraryView', shuffle: false })}>Done (hide again)</Button>
          <Button onClick={() => void run({ type: 'closeLibraryView', shuffle: true })}>Shuffle and close</Button>
        </div>
      </div>
    </Dialog>
  );
}
