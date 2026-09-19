import type { CardInstance, CardPrinting, GameCommand, PlayerGameState, RoomEvent, RoomPlayer, RoomState, ZoneName } from '@mtg/shared';
import { seatedPlayers } from '@mtg/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';

import type { CommandResult } from '../rooms/connection';
import { CardSizeProvider, cardSizeFor, DEFAULT_CARD_SIZE, useCardSize, type CardSize } from './cardSize';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { Hand } from './Hand';
import { LibraryDialog } from './LibraryDialog';
import { PlayerStrip } from './PlayerStrip';
import { Toolbar } from './Toolbar';
import { ShortcutsDialog } from './ShortcutsDialog';
import { BattlefieldRow, dropSlot, freeColumns, layoutRows } from './Battlefield';
import { StackZone } from './StackZone';
import { CardBack, TableCard } from './TableCard';
import { TokenDialog } from './TokenDialog';
import { useCards } from './useCards';
import { useHighlights } from './useHighlights';
import { useMarquee } from './useMarquee';
import { ZoneBrowser } from './ZoneBrowser';

type Send = (command: GameCommand) => Promise<CommandResult>;
type Run = (c: GameCommand) => Promise<void>;
type Menu = { x: number; y: number; card: CardInstance };

const DRAG_MIME = 'text/instance-ids';

/**
 * The whole game view. Fills its container (no page scroll): one row per
 * player, card size derived from the space each row gets.
 */
export function Table({ state, meId, send, live = [], connected = [] }: { state: RoomState; meId: string; send: Send; live?: RoomEvent[]; connected?: string[] }) {
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
  const cardOwner = useCallback((id: string) => game.cards[id]?.ownerId, [game.cards]);
  const highlighted = useHighlights(live, cardOwner, meId);

  // Size cards from the space one player row gets.
  const rootRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState<CardSize>(DEFAULT_CARD_SIZE);
  const rows = opponents.length + (me ? 1 : 0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setCardSize(cardSizeFor(el.clientWidth, el.clientHeight / Math.max(1, rows)));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [rows]);

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
        items.push({ label: 'Create token copy', onSelect: () => void run({ type: 'createToken', printingId: card.printingId, customName: null, count: 1, position: { row: card.position?.row ?? 0, col: (card.position?.col ?? 0) + 0.5 } }) });
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
    const moves: [ZoneName, string][] = [['stack', 'the stack (cast)'], ['battlefield', 'battlefield'], ['hand', 'hand (h)'], ['graveyard', 'graveyard (g)'], ['exile', 'exile (e)']];
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

  const shared = { cards: game.cards, printings, run, onCardClick, attaching: attaching !== null, highlighted };
  const connectedSet = new Set(connected);

  return (
    <CardSizeProvider size={cardSize}>
      <div className="relative h-full min-h-0 w-full">
      <div ref={rootRef} className="grid h-full min-h-0 w-full" style={{ gridTemplateRows: `repeat(${Math.max(1, rows)}, minmax(0, 1fr))` }}>
        {opponents.map((p) => (
          <PlayerArea key={p.id} {...shared} state={state} player={p} pgs={game.players[p.id]!} mine={false} flipped connected={connectedSet.has(p.id)} onCardMenu={openMenu} isSelected={() => false} />
        ))}
        {me && (
          <PlayerArea
            {...shared}
            state={state}
            player={me}
            pgs={game.players[me.id]!}
            mine
            connected={connectedSet.has(me.id)}
            onCardMenu={openMenu}
            onCardDragStart={onCardDragStart}
            onLibraryMenu={(e) => { e.preventDefault(); setPileMenu({ x: e.clientX, y: e.clientY }); }}
            onToken={() => setTokenDialog(true)}
            onHelp={() => setHelpDialog(true)}
            isSelected={isSelected}
            onMarquee={onMarquee}
            selectedCount={liveSelected.size}
            banner={attaching ? 'Click the permanent to attach to (Esc to cancel).' : error}
            bannerKind={attaching ? 'info' : 'error'}
          />
        )}
      </div>
      <StackZone state={state} meId={meId} printings={printings} run={run} onCardMenu={openMenu} onCardDragStart={onCardDragStart} />
      </div>
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
      <CardSizeProvider size={DEFAULT_CARD_SIZE}>
        {libraryDialog && me && (
          <LibraryDialog library={game.players[me.id]!.zones.library} cards={game.cards} printings={printings} run={run} onClose={() => setLibraryDialog(false)} />
        )}
        {tokenDialog && (
          <TokenDialog
            onClose={() => setTokenDialog(false)}
            onCreate={(t) => {
              setTokenDialog(false);
              void run({ type: 'createToken', ...t });
            }}
          />
        )}
        {helpDialog && <ShortcutsDialog onClose={() => setHelpDialog(false)} />}
      </CardSizeProvider>
    </CardSizeProvider>
  );
}

function PlayerArea({ state, player, pgs, cards, printings, mine, connected, run, flipped = false, onCardClick, onCardMenu, onCardDragStart, onToken, onHelp, onLibraryMenu, attaching, isSelected, highlighted, onMarquee, selectedCount = 0, banner, bannerKind = 'error' }: {
  state: RoomState;
  player: RoomPlayer;
  pgs: PlayerGameState;
  cards: Record<string, CardInstance>;
  printings: Map<string, CardPrinting>;
  mine: boolean;
  connected: boolean;
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
  highlighted: ReadonlySet<string>;
  onMarquee?: ((ids: string[], additive: boolean) => void) | undefined;
  selectedCount?: number;
  banner?: string | null | undefined;
  bannerKind?: 'info' | 'error';
}) {
  const marquee = useMarquee(onMarquee ?? (() => undefined));
  const [expandedPile, setExpandedPile] = useState<'graveyard' | 'exile' | null>(null);
  const zoneCards = (zone: ZoneName) => pgs.zones[zone].map((id) => cards[id]).filter((c): c is CardInstance => !!c);

  const parseIds = (e: DragEvent): string[] => {
    try {
      return JSON.parse(e.dataTransfer.getData(DRAG_MIME) || '[]') as string[];
    } catch {
      return [];
    }
  };

  /** Drop onto a non-battlefield zone. */
  const dropTo = (zone: ZoneName) => (e: DragEvent<HTMLDivElement>) => {
    if (!mine) return;
    e.preventDefault();
    const ids = parseIds(e);
    if (ids.length > 0) void run({ type: 'moveCards', instanceIds: ids, to: zone });
  };

  const battlefieldCards = zoneCards('battlefield');
  const rows = layoutRows(battlefieldCards, cards);

  /** Drop onto a battlefield row: the column under the pointer; a pile if occupied, else the selection fills free columns from there. */
  const dropToRow = (row: number) => (e: DragEvent<HTMLDivElement>, g: { step: number }) => {
    if (!mine) return;
    e.preventDefault();
    const ids = parseIds(e);
    if (ids.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const slots = (rows[row] ?? []).filter((s) => !s.cards.every((c) => ids.includes(c.id)));
    const slot = dropSlot(slots, e.clientX - rect.left - 8, g.step);
    const positions: Record<string, { row: number; col: number }> = {};
    if (slot.pile) ids.forEach((id) => (positions[id] = { row, col: slot.col }));
    else freeColumns(slots, slot.col, ids.length).forEach((col, i) => (positions[ids[i]!] = { row, col }));
    void run({ type: 'moveCards', instanceIds: ids, to: 'battlefield', positions });
  };
  const allowDrop = mine ? (e: DragEvent) => e.preventDefault() : undefined;

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

  // Opponents face me: their front row is nearest the middle, so it renders last.
  const rowOrder = flipped ? [1, 0] : [0, 1];
  const battlefield = (
    <div
      className={`relative flex min-h-0 flex-col justify-end gap-1 touch-none ${attaching && mine ? 'ring-1 ring-inset ring-accent/60' : ''}`}
      {...(mine ? marquee.handlers : {})}
    >
      {rowOrder.map((r) => (
        <BattlefieldRow key={r} slots={rows[r] ?? []} renderCard={(c) => cardEl(c, { onClick: mine || attaching })} onDragOver={allowDrop} onDrop={mine ? dropToRow(r) : undefined} />
      ))}
      {marquee.rect && <div className="pointer-events-none absolute z-30 border border-accent bg-accent/10" style={marquee.rect} />}
      {pgs.zones.battlefield.length === 0 && mine && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-white/25">drag cards here · drop on a card to pile · right-click for actions · ? for shortcuts</span>
      )}
    </div>
  );

  const handCards = zoneCards('hand');
  const tray = (
    <div className="tray flex min-w-0 items-center gap-3 px-2">
      <Hand count={handCards.length} onDragOver={allowDrop} onDrop={dropTo('hand')}>
        {handCards.map((c) => <span key={c.id}>{cardEl(c)}</span>)}
        {handCards.length === 0 && <span className="px-2 text-xs text-white/25">empty hand</span>}
      </Hand>
      <div className="flex shrink-0 gap-2 py-1.5">
        <Pile label="Library" count={pgs.zones.library.length} stack onDragOver={allowDrop} onDrop={dropTo('library')} onContextMenu={mine ? onLibraryMenu : undefined} hint={pgs.topRevealed ? 'top revealed' : undefined}>
          {pgs.zones.library.length > 0 && cards[pgs.zones.library[0]!]?.printingId ? topCard(zoneCards('library').slice(0, 1), printings) : pgs.zones.library.length > 0 ? <CardBack /> : null}
        </Pile>
        <Pile label="Graveyard" count={pgs.zones.graveyard.length} onDragOver={allowDrop} onDrop={dropTo('graveyard')} browse={{ cards: zoneCards('graveyard'), open: expandedPile === 'graveyard', toggle: () => setExpandedPile((p) => (p === 'graveyard' ? null : 'graveyard')), close: () => setExpandedPile(null), towards: flipped ? 'down' : 'up', render: (c) => cardEl(c, { onClick: false }) }}>
          {topCard(zoneCards('graveyard'), printings, mine ? onCardMenu : undefined)}
        </Pile>
        <Pile label="Exile" count={pgs.zones.exile.length} onDragOver={allowDrop} onDrop={dropTo('exile')} browse={{ cards: zoneCards('exile'), open: expandedPile === 'exile', toggle: () => setExpandedPile((p) => (p === 'exile' ? null : 'exile')), close: () => setExpandedPile(null), towards: flipped ? 'down' : 'up', render: (c) => cardEl(c, { onClick: false }) }}>
          {topCard(zoneCards('exile'), printings, mine ? onCardMenu : undefined)}
        </Pile>
        {pgs.zones.command.length > 0 && (
          <Pile label="Command" count={pgs.zones.command.length} onDragOver={allowDrop} onDrop={dropTo('command')}>
            {topCard(zoneCards('command'), printings, mine ? onCardMenu : undefined)}
          </Pile>
        )}
      </div>
    </div>
  );

  const strip = (
    <div className="flex items-center gap-3">
      <PlayerStrip
        state={state}
        player={player}
        pgs={pgs}
        mine={mine}
        connected={connected}
        run={run}
        toolbar={mine ? <Toolbar run={run} libraryCount={pgs.zones.library.length} handCount={pgs.zones.hand.length} onToken={onToken ?? (() => undefined)} onHelp={onHelp ?? (() => undefined)} /> : undefined}
      />
      {mine && selectedCount > 0 && <span className="text-[11px] text-accent">{selectedCount} selected</span>}
      {mine && banner && <span className={`truncate text-[11px] ${bannerKind === 'info' ? 'text-accent' : 'text-danger'}`}>{banner}</span>}
    </div>
  );

  // Opponents: strip at the top edge, hand next, battlefield towards the middle. Me: mirrored.
  const order = flipped ? [strip, tray, battlefield] : [battlefield, tray, strip];
  const rowsTemplate = flipped ? 'auto auto minmax(0, 1fr)' : 'minmax(0, 1fr) auto auto';

  return (
    <section
      className={`half grid min-h-0 transition-shadow duration-300 ${flipped ? 'border-b border-white/10' : ''} ${highlighted.has(player.id) ? 'shadow-[inset_0_0_0_2px_var(--color-accent)]' : ''}`}
      style={{ gridTemplateRows: rowsTemplate }}
    >
      {order.map((el, i) => <div key={i} className="min-h-0 min-w-0">{el}</div>)}
    </section>
  );
}

interface Browse {
  cards: CardInstance[];
  open: boolean;
  toggle: () => void;
  close: () => void;
  towards: 'up' | 'down';
  render: (card: CardInstance) => ReactNode;
}

function Pile({ label, count, children, stack = false, hint, browse, ...drop }: { label: string; count: number; children?: ReactNode; stack?: boolean; hint?: string | undefined; browse?: Browse | undefined; onDragOver?: ((e: DragEvent) => void) | undefined; onDrop?: ((e: DragEvent<HTMLDivElement>) => void) | undefined; onContextMenu?: ((e: MouseEvent) => void) | undefined }) {
  const { w, h } = useCardSize();
  const empty = count === 0;
  const canBrowse = !!browse && count > 1;
  return (
    <div className="relative" style={{ width: w, height: h }} {...drop} title={label}>
      {stack && count > 2 && <div className="absolute inset-0 translate-x-[3px] translate-y-[3px] rounded-[4.5%] bg-[#1a1533] card-shadow" />}
      {stack && count > 1 && <div className="absolute inset-0 translate-x-[1.5px] translate-y-[1.5px] rounded-[4.5%] bg-[#221b45] card-shadow" />}
      <div className={`absolute inset-0 flex items-center justify-center rounded-[4.5%] ${empty ? 'border border-dashed border-white/15' : ''}`}>{children}</div>
      <span className="pointer-events-none absolute inset-x-0 bottom-1 mx-auto w-max max-w-full truncate rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-text-muted">
        {label} · {count}{hint ? ` · ${hint}` : ''}
      </span>
      {canBrowse && !browse.open && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            browse.toggle();
          }}
          className={`absolute left-1/2 z-10 -translate-x-1/2 rounded-full border border-white/20 bg-black/80 px-2 text-[10px] leading-4 text-white/80 hover:bg-black ${browse.towards === 'up' ? '-top-2' : '-bottom-2'}`}
          title={`Show all ${count} cards`}
          aria-expanded={browse.open}
        >
          {browse.open ? (browse.towards === 'up' ? '▼' : '▲') : browse.towards === 'up' ? '▲' : '▼'}
        </button>
      )}
      {canBrowse && browse.open && <ZoneBrowser cards={browse.cards} towards={browse.towards} renderCard={browse.render} onClose={browse.close} />}
    </div>
  );
}

function topCard(cards: CardInstance[], printings: Map<string, CardPrinting>, onCardMenu?: ((card: CardInstance) => (e: MouseEvent) => void) | undefined) {
  const top = cards[cards.length - 1];
  if (!top) return null;
  return <TableCard card={top} printing={top.printingId ? printings.get(top.printingId) : undefined} mine={false} onContextMenu={onCardMenu ? onCardMenu(top) : undefined} />;
}
