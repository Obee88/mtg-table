import type { CardInstance, CardPrinting, GameCommand, LibraryView } from '@mtg/shared';
import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Input } from '../components';
import { CardSizeProvider, DEFAULT_CARD_SIZE } from './cardSize';
import { TableCard } from './TableCard';

type Run = (c: GameCommand) => Promise<void>;

/**
 * "Draw by name": a search where the whole library is listed alphabetically
 * (never in library order); the chosen card goes to hand, then the library is
 * shuffled (default) or just hidden again. Cancelling hides it again too.
 */
export function DrawByNameDialog({ view, cards, printings, run, onClose }: { view: LibraryView | null | undefined; cards: Record<string, CardInstance>; printings: Map<string, CardPrinting>; run: Run; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [shuffle, setShuffle] = useState(true);
  useEffect(() => {
    if (!view) void run({ type: 'openLibraryView', kind: 'search' });
  }, []);

  const name = (c: CardInstance) => (c.printingId ? (printings.get(c.printingId)?.name ?? '') : '');
  const listed = useMemo(() => (view?.cards ?? []).map((id) => cards[id]).filter((c): c is CardInstance => !!c && c.zone === 'library' && c.printingId !== null).sort((a, b) => name(a).localeCompare(name(b))), [view?.cards, cards, printings]);
  const q = query.trim().toLowerCase();
  const matches = q ? listed.filter((c) => name(c).toLowerCase().includes(q)) : listed;

  const finish = async (after: 'shuffle' | 'hide') => {
    if (view) await run({ type: 'closeLibraryView', shuffle: after === 'shuffle' });
    onClose();
  };
  const pick = async (c: CardInstance) => {
    await run({ type: 'moveCard', instanceId: c.id, to: 'hand' });
    await finish(shuffle ? 'shuffle' : 'hide');
  };

  return (
    <Dialog title="Draw by name" onClose={() => void finish('hide')}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Card name" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="type to filter; listed alphabetically" />
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
            Shuffle afterwards
          </label>
          <span className="pb-2 text-xs text-text-muted">{view ? `${listed.length} cards` : 'opening…'}</span>
        </div>
        <CardSizeProvider size={DEFAULT_CARD_SIZE}>
          <ul className="grid max-h-[60vh] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
            {matches.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => void pick(c)} className="w-full rounded-md p-1 text-left text-xs hover:bg-surface-raised">
                  <TableCard card={c} printing={printings.get(c.printingId!)} mine={false} />
                  <span className="mt-1 block truncate">{name(c)}</span>
                </button>
              </li>
            ))}
            {view && matches.length === 0 && <li className="col-span-full text-sm text-text-muted">No matching cards.</li>}
          </ul>
        </CardSizeProvider>
        <div className="flex gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={() => void finish('hide')}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}
