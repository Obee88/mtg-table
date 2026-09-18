import type { CardInstance, CardPrinting, GameCommand, PlayerGameState, RoomPlayer, RoomState, ZoneName } from '@mtg/shared';
import { seatedPlayers } from '@mtg/shared';
import { useCallback, useEffect, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { Button, ErrorText } from '../components';
import type { CommandResult } from '../rooms/connection';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { LibraryDialog } from './LibraryDialog';
import { PlayerBar } from './PlayerBar';
import { ShortcutsDialog } from './ShortcutsDialog';
import { CARD_H, CARD_W, CardBack, TableCard } from './TableCard';
import { TokenDialog } from './TokenDialog';
import { useCards } from './useCards';
import { useMarquee } from './useMarquee';

type Send = (command: GameCommand) => Promise<CommandResult>;
type Run = (c: GameCommand) => Promise<void>;
type Menu = { x: number; y: number; card: CardInstance };

const DRAG_MIME = 'text/instance-ids';
/** Attachments render slightly offset behind their host. */
const ATTACH_OFFSET = 14;

export function Table({ state, meId, send }: { state: RoomState; meId: string; send: Send }) {
  const game = state.game!;
  const players = seatedPlayers(state);
  const me = players.find((p) => p.id === meId);
  const opponents = players.filter((p) => p.id !== meId);
  const printings = useCards(Object.values(game.cards).map((c) => c.printingId));
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [pileMenu, setPileMenu] = useState<{ x: number; y: number } | null>(null);
  const [tokenDialog, setTokenDialog] = useState(false);
  const [libraryDialog, setLibraryDialog] = useState(false);
  const [helpDialog, setHelpDialog] = useState(false);
  /** Card waiting for an attachment target to be clicked. */
  const [attaching, setAttaching] = useState<string | null>(null);
  /** Own cards currently selected (battlefield or hand). */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // Drop selections of cards that no longer exist or are no longer mine.
  const liveSelected = new Set([...selected].filter((id) => game.cards[id]?.controllerId === meId));
  const isSelected = (id: string) => liveSelected.has(id);
  const selectedIds = () => [...liveSelected];

  const run = useCallback<Run>(
    async (command) => {
      setError(null);
      const r = await send(command);
      if (!r.ok) setError(r.error);
    },
    [send],
  );

  const moveSelection = useCallback(
    (to: ZoneName, libraryPosition?: 'top' | 'bottom') => {
      const ids = [...selected].filter((id) => game.cards[id]?.controllerId === meId);
      if (ids.length === 0) return;
      const cmd: GameCommand = { type: 'moveCards', instanceIds: ids, to };
      if (libraryPosition) cmd.libraryPosition = libraryPosition;
      void run(cmd);
      if (to !== 'battlefield') setSelected(new Set());
    },
    [selected, game.cards, meId, run],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (!me) return;
      if (e.key === '?') return setHelpDialog(true);
      if (e.key === 'Escape') {
        setAttaching(null);
        setSelected(new Set());
        return;
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        return void run({ type: 'undo' });
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const ids = [...selected].filter((id) => game.cards[id]?.controllerId === meId);
      switch (e.key) {
        case 'd': return void run({ type: 'draw', count: 1 });
        case 'u': return void run({ type: 'untapAll' });
        case 's': return void run({ type: 'shuffleLibrary' });
        case 't': return setTokenDialog(true);
        case ' ': {
          if (ids.length === 0) return;
          e.preventDefault();
          const anyUntapped = ids.some((id) => game.cards[id]?.zone === 'battlefield' && !game.cards[id]?.tapped);
          return void run({ type: 'tapCards', instanceIds: ids, tapped: anyUntapped });
        }
        case 'g': return moveSelection('graveyard');
        case 'e': return moveSelection('exile');
        case 'h': return moveSelection('hand');
        case 'b': return moveSelection('library', 'bottom');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, me, selected, game.cards, meId, moveSelection]);

  const onCardClick = (card: CardInstance, e: MouseEvent) => {
    if (attaching) {
      if (card.id !== attaching && card.zone === 'battlefield') void run({ type: 'attachCard', instanceId: attaching, to: card.id });
      setAttaching(null);
      return;
    }
    if (card.controllerId !== meId) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const next = new Set(liveSelected);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      setSelected(next);
      return;
    }
    if (card.zone !== 'battlefield') {
      setSelected(new Set());
      return;
    }
    // Plain click: tap the selection if the card is part of it, else just this card.
    if (liveSelected.has(card.id) && liveSelected.size > 1) {
      void run({ type: 'tapCards', instanceIds: selectedIds(), tapped: !card.tapped });
    } else {
      setSelected(new Set());
      void run({ type: 'tapCard', instanceId: card.id, tapped: !card.tapped });
    }
  };

  /** Dragging a selected card drags the whole selection. */
  const onCardDragStart = (card: CardInstance) => (e: DragEvent) => {
    const ids = liveSelected.has(card.id) ? selectedIds() : [card.id];
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
    e.dataTransfer.setData('text/dragged-id', card.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const menuItems = (card: CardInstance): (MenuItem | 'sep')[] => {
    const multi = liveSelected.has(card.id) && liveSelected.size > 1;
    if (multi) return selectionItems();
    const p = card.printingId ? printings.get(card.printingId) : undefined;
    const onBattlefield = card.zone === 'battlefield';
    const items: (MenuItem | 'sep')[] = [];
    if (onBattlefield) {
      items.push({ label: card.tapped ? 'Untap' : 'Tap', onSelect: () => void run({ type: 'tapCard', instanceId: card.id, tapped: !card.tapped }) });
      if ((p?.faces.length ?? 0) > 1) items.push({ label: card.transformed ? 'Transform to front' : 'Transform', onSelect: () => void run({ type: 'transformCard', instanceId: card.id, transformed: !card.transformed }) });
      items.push({ label: card.flipped ? 'Unflip' : 'Flip', onSelect: () => void run({ type: 'flipCard', instanceId: card.id, flipped: !card.flipped }) });
    }
    if (onBattlefield || card.zone === 'exile') {
      items.push({ label: card.faceDown ? 'Turn face up' : 'Turn face down', onSelect: () => void run({ type: 'setFaceDown', instanceId: card.id, faceDown: !card.faceDown }) });
    }
    if (onBattlefield) {
      items.push('sep');
      items.push({ label: '+1/+1 counter', onSelect: () => void run({ type: 'addCounter', instanceId: card.id, kind: '+1/+1', delta: 1 }) });
      items.push({ label: '−1/−1 counter', onSelect: () => void run({ type: 'addCounter', instanceId: card.id, kind: '-1/-1', delta: 1 }) });
      items.push({
        label: 'Other counter…',
        onSelect: () => {
          const kind = prompt('Counter type (e.g. loyalty, charge):');
          if (!kind) return;
          const delta = Number(prompt(`How many ${kind} counters to add (negative removes)?`, '1'));
          if (Number.isInteger(delta) && delta !== 0) void run({ type: 'addCounter', instanceId: card.id, kind, delta });
        },
      });
      for (const [kind] of Object.entries(card.counters)) {
        items.push({ label: `Remove one ${kind}`, onSelect: () => void run({ type: 'addCounter', instanceId: card.id, kind, delta: -1 }) });
      }
      items.push('sep');
      items.push({ label: 'Attach to… (click a permanent)', onSelect: () => setAttaching(card.id) });
      if (card.attachedTo) items.push({ label: 'Detach', onSelect: () => void run({ type: 'attachCard', instanceId: card.id, to: null }) });
      items.push({
        label: card.note ? 'Edit note' : 'Add note',
        onSelect: () => {
          const note = prompt('Note:', card.note ?? '');
          if (note !== null) void run({ type: 'setNote', instanceId: card.id, note });
        },
      });
      if (card.printingId) {
        items.push({ label: 'Create token copy', onSelect: () => void run({ type: 'createToken', printingId: card.printingId, customName: null, count: 1, position: { x: (card.position?.x ?? 50) + 4, y: (card.position?.y ?? 50) + 4 } }) });
      }
      items.push('sep');
    }
    if (card.zone === 'hand' || card.zone === 'library' || card.faceDown) {
      items.push('sep');
      items.push({ label: 'Reveal to everyone', onSelect: () => void run({ type: 'revealCards', instanceIds: [card.id], to: 'all', until: card.zone === 'hand' ? 'zoneChange' : 'dismissed' }) });
      for (const o of opponents) items.push({ label: `Reveal to ${o.displayName}`, onSelect: () => void run({ type: 'revealCards', instanceIds: [card.id], to: [o.id], until: card.zone === 'hand' ? 'zoneChange' : 'dismissed' }) });
      if (card.revealUntil) items.push({ label: 'Hide again', onSelect: () => void run({ type: 'dismissReveal', instanceIds: [card.id] }) });
      items.push('sep');
    }
    const moves: [ZoneName, string][] = [['battlefield', 'battlefield'], ['hand', 'hand (h)'], ['graveyard', 'graveyard (g)'], ['exile', 'exile (e)']];
    for (const [zone, label] of moves) if (zone !== card.zone) items.push({ label: `Move to ${label}`, onSelect: () => void run({ type: 'moveCard', instanceId: card.id, to: zone }) });
    items.push({ label: 'Top of library', onSelect: () => void run({ type: 'moveCard', instanceId: card.id, to: 'library', libraryPosition: 'top' }) });
    items.push({ label: 'Bottom of library (b)', onSelect: () => void run({ type: 'moveCard', instanceId: card.id, to: 'library', libraryPosition: 'bottom' }) });
    return items;
  };

  const selectionItems = (): (MenuItem | 'sep')[] => {
    const ids = selectedIds();
    const onBattlefield = ids.filter((id) => game.cards[id]?.zone === 'battlefield');
    const items: (MenuItem | 'sep')[] = [];
    if (onBattlefield.length > 0) {
      items.push({ label: `Tap ${onBattlefield.length} (Space)`, onSelect: () => void run({ type: 'tapCards', instanceIds: onBattlefield, tapped: true }) });
      items.push({ label: `Untap ${onBattlefield.length}`, onSelect: () => void run({ type: 'tapCards', instanceIds: onBattlefield, tapped: false }) });
      items.push('sep');
    }
    items.push({ label: `Move ${ids.length} to battlefield`, onSelect: () => moveSelection('battlefield') });
    items.push({ label: `Move ${ids.length} to hand (h)`, onSelect: () => moveSelection('hand') });
    items.push({ label: `Move ${ids.length} to graveyard (g)`, onSelect: () => moveSelection('graveyard') });
    items.push({ label: `Move ${ids.length} to exile (e)`, onSelect: () => moveSelection('exile') });
    items.push({ label: `${ids.length} to top of library`, onSelect: () => moveSelection('library', 'top') });
    items.push({ label: `${ids.length} to bottom of library (b)`, onSelect: () => moveSelection('library', 'bottom') });
    items.push('sep');
    items.push({ label: 'Clear selection (Esc)', onSelect: () => setSelected(new Set()) });
    return items;
  };

  /** Menu on an opponent's hand card that was revealed to me: discard-style effects. */
  const opponentHandItems = (card: CardInstance): (MenuItem | 'sep')[] => [
    { label: 'Put into graveyard', onSelect: () => void run({ type: 'moveCard', instanceId: card.id, to: 'graveyard' }) },
    { label: 'Exile', onSelect: () => void run({ type: 'moveCard', instanceId: card.id, to: 'exile' }) },
    { label: 'Bottom of library', onSelect: () => void run({ type: 'moveCard', instanceId: card.id, to: 'library', libraryPosition: 'bottom' }) },
    { label: 'Top of library', onSelect: () => void run({ type: 'moveCard', instanceId: card.id, to: 'library', libraryPosition: 'top' }) },
  ];

  const libraryItems = (): (MenuItem | 'sep')[] => {
    const pgs = game.players[meId];
    const ask = (label: string, max: number) => {
      const n = Number(prompt(label, '1'));
      return Number.isInteger(n) && n >= 1 ? Math.min(n, max) : null;
    };
    return [
      { label: 'Look at top…', onSelect: () => { const n = ask('Look at how many?', pgs?.zones.library.length ?? 0); if (n) { void run({ type: 'lookAtTop', count: n }); setLibraryDialog(true); } } },
      { label: 'Reveal top… to everyone', onSelect: () => { const n = ask('Reveal how many?', pgs?.zones.library.length ?? 0); if (n) void run({ type: 'revealTop', count: n, to: 'all' }); } },
      { label: 'Search library', onSelect: () => { void run({ type: 'lookAtTop', count: Math.max(1, pgs?.zones.library.length ?? 1) }); setLibraryDialog(true); } },
      { label: 'Browse visible cards', onSelect: () => setLibraryDialog(true) },
      'sep',
      { label: pgs?.topRevealed ? 'Stop revealing top card' : 'Play with top card revealed', onSelect: () => void run({ type: 'setTopRevealed', enabled: !pgs?.topRevealed }) },
      { label: 'Hide all revealed cards', onSelect: () => void run({ type: 'dismissReveal' }) },
      { label: 'Shuffle (s)', onSelect: () => void run({ type: 'shuffleLibrary' }) },
    ];
  };

  const openMenu = (card: CardInstance) => (e: MouseEvent) => {
    e.preventDefault();
    if (card.controllerId === meId && !liveSelected.has(card.id)) setSelected(new Set());
    setMenu({ x: e.clientX, y: e.clientY, card });
  };

  const onMarquee = useCallback((ids: string[], additive: boolean) => {
    setSelected((prev) => (additive ? new Set([...prev, ...ids]) : new Set(ids)));
  }, []);

  const shared = { cards: game.cards, printings, run, onCardClick, attaching: attaching !== null };

  return (
    <div className="flex flex-col gap-3">
      {attaching && <p className="rounded-md bg-accent/20 px-3 py-1 text-sm text-accent">Click the permanent to attach to (Esc to cancel).</p>}
      {opponents.map((p) => (
        <PlayerArea key={p.id} {...shared} state={state} player={p} pgs={game.players[p.id]!} mine={false} flipped onCardMenu={openMenu} isSelected={() => false} />
      ))}
      {me && (
        <PlayerArea
          {...shared}
          state={state}
          player={me}
          pgs={game.players[me.id]!}
          mine
          onCardMenu={openMenu}
          onCardDragStart={onCardDragStart}
          onLibraryMenu={(e) => { e.preventDefault(); setPileMenu({ x: e.clientX, y: e.clientY }); }}
          onToken={() => setTokenDialog(true)}
          onHelp={() => setHelpDialog(true)}
          isSelected={isSelected}
          onMarquee={onMarquee}
          selectedCount={liveSelected.size}
        />
      )}
      <ErrorText error={error} />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.card.controllerId === meId ? menuItems(menu.card) : opponentHandItems(menu.card)}
          onClose={() => setMenu(null)}
          header={liveSelected.has(menu.card.id) && liveSelected.size > 1 ? `${liveSelected.size} cards selected` : (menu.card.customName ?? (menu.card.printingId ? printings.get(menu.card.printingId)?.name : 'Card'))}
        />
      )}
      {pileMenu && <ContextMenu x={pileMenu.x} y={pileMenu.y} items={libraryItems()} onClose={() => setPileMenu(null)} header="Library" />}
      {libraryDialog && me && (
        <LibraryDialog library={game.players[me.id]!.zones.library} cards={game.cards} printings={printings} run={run} onClose={() => setLibraryDialog(false)} />
      )}
      {tokenDialog && (
        <TokenDialog
          onClose={() => setTokenDialog(false)}
          onCreate={(t) => {
            setTokenDialog(false);
            void run({ type: 'createToken', ...t, position: { x: 40, y: 40 } });
          }}
        />
      )}
      {helpDialog && <ShortcutsDialog onClose={() => setHelpDialog(false)} />}
    </div>
  );
}

function PlayerArea({ state, player, pgs, cards, printings, mine, run, flipped = false, onCardClick, onCardMenu, onCardDragStart, onToken, onHelp, onLibraryMenu, attaching, isSelected, onMarquee, selectedCount = 0 }: {
  state: RoomState;
  player: RoomPlayer;
  pgs: PlayerGameState;
  cards: Record<string, CardInstance>;
  printings: Map<string, CardPrinting>;
  mine: boolean;
  run: Run;
  flipped?: boolean;
  onCardClick: (card: CardInstance, e: MouseEvent) => void;
  onCardMenu?: ((card: CardInstance) => (e: MouseEvent) => void) | undefined;
  onCardDragStart?: ((card: CardInstance) => (e: DragEvent) => void) | undefined;
  onToken?: (() => void) | undefined;
  onHelp?: (() => void) | undefined;
  onLibraryMenu?: ((e: MouseEvent) => void) | undefined;
  attaching: boolean;
  isSelected: (id: string) => boolean;
  onMarquee?: ((ids: string[], additive: boolean) => void) | undefined;
  selectedCount?: number;
}) {
  const marquee = useMarquee(onMarquee ?? (() => undefined));
  const zoneCards = (zone: ZoneName) => pgs.zones[zone].map((id) => cards[id]).filter((c): c is CardInstance => !!c);

  const dropTo = (zone: ZoneName) => (e: DragEvent<HTMLDivElement>) => {
    if (!mine) return;
    e.preventDefault();
    let ids: string[];
    try {
      ids = JSON.parse(e.dataTransfer.getData(DRAG_MIME) || '[]') as string[];
    } catch {
      ids = [];
    }
    if (ids.length === 0) return;
    const draggedId = e.dataTransfer.getData('text/dragged-id') || ids[0]!;
    const command: GameCommand = { type: 'moveCards', instanceIds: ids, to: zone };
    if (zone === 'battlefield') {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(100, ((e.clientX - rect.left - CARD_W / 2) / rect.width) * 100));
      const y = Math.max(0, Math.min(100, ((e.clientY - rect.top - CARD_H / 2) / rect.height) * 100));
      const dragged = cards[draggedId];
      const origin = dragged?.zone === 'battlefield' && dragged.position ? dragged.position : null;
      const positions: Record<string, { x: number; y: number }> = {};
      ids.forEach((id, i) => {
        const c = cards[id];
        // Cards already on the battlefield keep their offset from the dragged card; others fan out.
        if (origin && c?.zone === 'battlefield' && c.position) positions[id] = { x: Math.max(0, Math.min(100, x + (c.position.x - origin.x))), y: Math.max(0, Math.min(100, y + (c.position.y - origin.y))) };
        else positions[id] = { x: Math.min(100, x + i * 4), y };
      });
      command.positions = positions;
    }
    void run(command);
  };
  const allowDrop = mine ? (e: DragEvent) => e.preventDefault() : undefined;

  const battlefieldCards = zoneCards('battlefield');
  const placed = battlefieldCards.map((c) => {
    let host = c.attachedTo ? cards[c.attachedTo] : undefined;
    let depth = 0;
    while (host && depth < 5) {
      depth++;
      host = host.attachedTo ? cards[host.attachedTo] : undefined;
    }
    const anchor = c.attachedTo ? cards[c.attachedTo] : undefined;
    const siblings = anchor ? battlefieldCards.filter((o) => o.attachedTo === anchor.id) : [];
    const index = anchor ? siblings.findIndex((o) => o.id === c.id) : 0;
    const base = anchor?.position ?? c.position ?? { x: 50, y: 50 };
    return { card: c, x: base.x, y: base.y, dx: anchor ? (index + 1) * ATTACH_OFFSET : 0, z: anchor ? 10 - depth : 20 };
  });

  const cardEl = (c: CardInstance, extra: { onClick?: boolean } = {}) => (
    <TableCard
      card={c}
      printing={c.printingId ? printings.get(c.printingId) : undefined}
      mine={mine}
      selected={isSelected(c.id)}
      onClick={extra.onClick === false ? undefined : (e) => onCardClick(c, e)}
      onContextMenu={onCardMenu && (mine || c.printingId !== null) ? onCardMenu(c) : undefined}
      onDragStart={mine && onCardDragStart ? onCardDragStart(c) : undefined}
    />
  );

  const battlefield = (
    <div
      className={`relative min-h-[240px] flex-1 touch-none rounded-lg border bg-surface/60 ${attaching && mine ? 'border-accent' : 'border-border'}`}
      onDragOver={allowDrop}
      onDrop={dropTo('battlefield')}
      {...(mine ? marquee.handlers : {})}
    >
      {placed.map(({ card, x, y, dx, z }) => (
        <div key={card.id} className="absolute" style={{ left: `calc(${x}% + ${dx}px)`, top: `calc(${y}% + ${dx}px)`, zIndex: z }}>
          {cardEl(card, { onClick: mine || attaching })}
        </div>
      ))}
      {marquee.rect && <div className="pointer-events-none absolute z-30 border border-accent bg-accent/10" style={marquee.rect} />}
      {pgs.zones.battlefield.length === 0 && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-muted">{mine ? 'drag cards here · right-click for actions · ? for shortcuts' : 'battlefield'}</span>
      )}
    </div>
  );

  const hand = (
    <div className="flex min-h-[calc(112px+1rem)] flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/60 p-2" onDragOver={allowDrop} onDrop={dropTo('hand')}>
      {zoneCards('hand').map((c) => <span key={c.id}>{cardEl(c)}</span>)}
      {pgs.zones.hand.length === 0 && <span className="px-2 text-xs text-text-muted">empty hand</span>}
    </div>
  );

  const piles = (
    <div className="flex shrink-0 gap-2">
      <Pile label={pgs.topRevealed ? 'Library (top revealed)' : 'Library'} count={pgs.zones.library.length} onDragOver={allowDrop} onDrop={dropTo('library')} onContextMenu={mine ? onLibraryMenu : undefined}>
        {pgs.zones.library.length > 0 && (cards[pgs.zones.library[0]!]?.printingId ? topCard(zoneCards('library').slice(0, 1), printings) : <CardBack />)}
      </Pile>
      <Pile label="Graveyard" count={pgs.zones.graveyard.length} onDragOver={allowDrop} onDrop={dropTo('graveyard')}>
        {topCard(zoneCards('graveyard'), printings, mine ? onCardMenu : undefined)}
      </Pile>
      <Pile label="Exile" count={pgs.zones.exile.length} onDragOver={allowDrop} onDrop={dropTo('exile')}>
        {topCard(zoneCards('exile'), printings, mine ? onCardMenu : undefined)}
      </Pile>
      {pgs.zones.command.length > 0 && (
        <Pile label="Command" count={pgs.zones.command.length} onDragOver={allowDrop} onDrop={dropTo('command')}>
          {topCard(zoneCards('command'), printings, mine ? onCardMenu : undefined)}
        </Pile>
      )}
    </div>
  );

  return (
    <section className={`flex flex-col gap-2 ${flipped ? 'flex-col-reverse' : ''}`}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{player.displayName}{mine && ' (you)'}</span>
        <span className="text-text-muted">hand {pgs.zones.hand.length} · library {pgs.zones.library.length}{selectedCount > 0 && ` · ${selectedCount} selected`}</span>
        {mine && (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button variant="ghost" className="!py-1" onClick={() => void run({ type: 'draw', count: 1 })} disabled={pgs.zones.library.length === 0}>Draw (d)</Button>
            <Button variant="ghost" className="!py-1" onClick={() => void run({ type: 'untapAll' })}>Untap all (u)</Button>
            <Button variant="ghost" className="!py-1" onClick={() => void run({ type: 'shuffleLibrary' })}>Shuffle (s)</Button>
            <Button variant="ghost" className="!py-1" onClick={onToken}>Token (t)</Button>
            <Button variant="ghost" className="!py-1" onClick={() => void run({ type: 'undo' })} title="Undo your last action if nobody acted since">Undo (Ctrl+Z)</Button>
            <Button
              variant="ghost"
              className="!py-1"
              onClick={() => {
                const count = Math.max(0, pgs.zones.hand.length - 1);
                if (confirm(`Mulligan to ${count}?`)) void run({ type: 'mulligan', count });
              }}
            >
              Mulligan
            </Button>
            <Button variant="ghost" className="!py-1" onClick={onHelp} title="Keyboard shortcuts">?</Button>
          </span>
        )}
      </div>
      <PlayerBar state={state} player={player} pgs={pgs} mine={mine} run={run} />
      <div className="flex gap-3">
        {piles}
        {battlefield}
      </div>
      {hand}
    </section>
  );
}

function Pile({ label, count, children, ...drop }: { label: string; count: number; children?: ReactNode; onDragOver?: ((e: DragEvent) => void) | undefined; onDrop?: ((e: DragEvent<HTMLDivElement>) => void) | undefined; onContextMenu?: ((e: MouseEvent) => void) | undefined }) {
  return (
    <div className="flex flex-col items-center gap-1 text-xs text-text-muted" {...drop}>
      <div className="flex items-center justify-center rounded-[4.5%] border border-dashed border-border" style={{ width: CARD_W, height: CARD_H }}>
        {children}
      </div>
      <span>{label} · {count}</span>
    </div>
  );
}

function topCard(cards: CardInstance[], printings: Map<string, CardPrinting>, onCardMenu?: ((card: CardInstance) => (e: MouseEvent) => void) | undefined) {
  const top = cards[cards.length - 1];
  if (!top) return null;
  return <TableCard card={top} printing={top.printingId ? printings.get(top.printingId) : undefined} mine={false} onContextMenu={onCardMenu ? onCardMenu(top) : undefined} />;
}
