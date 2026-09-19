import { Dialog } from '../components';

export const SHORTCUTS: [string, string][] = [
  ['d / click library', 'Draw a card'],
  ['n', 'End your turn'],
  ['u', 'Untap all your permanents'],
  ['s', 'Shuffle your library (also in the library menu)'],
  ['t', 'Create a token'],
  ['Ctrl+Z', 'Undo your last action (if nobody acted since)'],
  ['Shift/Ctrl + click', 'Add a card to the selection'],
  ['Drag on empty battlefield', 'Rubber-band select'],
  ['Drop a card on a card', 'Pile them (auras, equipment, lands…)'],
  ['Hold c + click a counter', 'Counter +1 (right-click −1)'],
  ['Space', 'Tap / untap the selection'],
  ['g', 'Selection → graveyard'],
  ['e', 'Selection → exile'],
  ['h', 'Selection → hand'],
  ['b', 'Selection → bottom of library'],
  ['Esc', 'Clear selection / cancel'],
  ['Right-click / library label', 'Card, selection or library menu'],
  ['?', 'This list'],
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Keyboard shortcuts" onClose={onClose}>
      <ul className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        {SHORTCUTS.map(([key, what]) => (
          <li key={key} className="contents">
            <kbd className="rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
            <span className="text-text-muted">{what}</span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
