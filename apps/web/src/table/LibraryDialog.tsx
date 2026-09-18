import type { CardInstance, CardPrinting, GameCommand } from '@mtg/shared';
import { Button, Dialog } from '../components';
import { TableCard } from './TableCard';

type Run = (c: GameCommand) => Promise<void>;

/**
 * Browser for the library cards the player can currently see (after "look at
 * top N" or a search). Reorder the visible top cards, or move them elsewhere.
 */
export function LibraryDialog({ library, cards, printings, run, onClose }: {
  library: string[];
  cards: Record<string, CardInstance>;
  printings: Map<string, CardPrinting>;
  run: Run;
  onClose: () => void;
}) {
  const visible = library.map((id) => cards[id]).filter((c): c is CardInstance => !!c && c.printingId !== null);
  // Only a contiguous visible prefix can be reordered.
  let prefix = 0;
  while (prefix < library.length && cards[library[prefix]!]?.printingId !== null) prefix++;
  const swap = (i: number, j: number) => {
    const top = library.slice(0, prefix);
    [top[i], top[j]] = [top[j]!, top[i]!];
    void run({ type: 'reorderLibraryTop', instanceIds: top });
  };

  return (
    <Dialog title={`Library · ${visible.length} visible of ${library.length}`} onClose={onClose}>
      {visible.length === 0 && <p className="text-sm text-text-muted">No visible cards. Use “Look at top…” or “Search” first.</p>}
      <ul className="flex flex-col gap-2">
        {visible.map((c, i) => (
          <li key={c.id} className="flex items-center gap-3 rounded-md bg-surface-raised p-2 text-sm">
            <span className="w-6 text-text-muted">{library.indexOf(c.id) + 1}</span>
            <TableCard card={c} printing={c.printingId ? printings.get(c.printingId) : undefined} mine={false} />
            <span className="min-w-0 flex-1 truncate font-medium">{c.printingId ? printings.get(c.printingId)?.name : ''}</span>
            <span className="flex flex-wrap gap-1">
              {i < prefix && (
                <>
                  <Button variant="ghost" className="!px-2 !py-0.5 text-xs" disabled={i === 0} onClick={() => swap(i, i - 1)}>↑</Button>
                  <Button variant="ghost" className="!px-2 !py-0.5 text-xs" disabled={i >= prefix - 1} onClick={() => swap(i, i + 1)}>↓</Button>
                </>
              )}
              <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => void run({ type: 'moveCard', instanceId: c.id, to: 'hand' })}>Hand</Button>
              <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => void run({ type: 'moveCard', instanceId: c.id, to: 'battlefield' })}>Battlefield</Button>
              <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => void run({ type: 'moveCard', instanceId: c.id, to: 'graveyard' })}>Graveyard</Button>
              <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => void run({ type: 'moveCard', instanceId: c.id, to: 'exile' })}>Exile</Button>
              <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => void run({ type: 'moveCard', instanceId: c.id, to: 'library', libraryPosition: 'bottom' })}>Bottom</Button>
              <Button variant="ghost" className="!px-2 !py-0.5 text-xs" onClick={() => void run({ type: 'revealCards', instanceIds: [c.id], to: 'all', until: 'dismissed' })}>Reveal</Button>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={() => { void run({ type: 'dismissReveal' }); onClose(); }}>Done (hide again)</Button>
        <Button variant="ghost" onClick={() => { void run({ type: 'shuffleLibrary' }); onClose(); }}>Shuffle & close</Button>
      </div>
    </Dialog>
  );
}
