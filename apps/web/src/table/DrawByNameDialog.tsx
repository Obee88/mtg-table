import type { CardInstance, CardPrinting, GameCommand } from '@mtg/shared';
import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, Input } from '../components';
import { CardSizeProvider, DEFAULT_CARD_SIZE } from './cardSize';
import { TableCard } from './TableCard';

type Run = (c: GameCommand) => Promise<void>;

/**
 * "Draw by name": the whole library is revealed to its owner (a search), the
 * chosen card goes to hand, then the library is shuffled (default) or just
 * hidden again. Closing without a pick also hides it again.
 */
export function DrawByNameDialog({ library, cards, printings, run, onClose }: {
  library: string[];
  cards: Record<string, CardInstance>;
  printings: Map<string, CardPrinting>;
  run: Run;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [shuffle, setShuffle] = useState(true);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (library.length > 0) void run({ type: 'lookAtTop', count: library.length });
  }, []);

  const visible = useMemo(() => library.map((id) => cards[id]).filter((c): c is CardInstance => !!c && c.printingId !== null), [library, cards]);
  const q = query.trim().toLowerCase();
  const matches = q ? visible.filter((c) => (printings.get(c.printingId!)?.name ?? '').toLowerCase().includes(q)) : visible;
  const unresolved = library.length - visible.length;

  const finish = (after: 'shuffle' | 'hide') => {
    setDone(true);
    void run(after === 'shuffle' ? { type: 'shuffleLibrary' } : { type: 'dismissReveal' });
    onClose();
  };
  const pick = (c: CardInstance) => {
    void run({ type: 'moveCard', instanceId: c.id, to: 'hand' });
    finish(shuffle ? 'shuffle' : 'hide');
  };
  const close = () => {
    if (!done) finish('hide');
    else onClose();
  };

  return (
    <Dialog title="Draw by name" onClose={close}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Card name" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="type to filter your library" />
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
            Shuffle deck afterwards
          </label>
          <span className="pb-2 text-xs text-text-muted">{unresolved > 0 ? `revealing ${unresolved}…` : `${visible.length} cards`}</span>
        </div>
        <CardSizeProvider size={DEFAULT_CARD_SIZE}>
          <ul className="grid max-h-[60vh] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
            {matches.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => pick(c)} className="w-full rounded-md p-1 text-left text-xs hover:bg-surface-raised">
                  <TableCard card={c} printing={printings.get(c.printingId!)} mine={false} />
                  <span className="mt-1 block truncate">{printings.get(c.printingId!)?.name}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="col-span-full text-sm text-text-muted">No matching cards.</li>}
          </ul>
        </CardSizeProvider>
        <div className="flex gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={close}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  );
}
