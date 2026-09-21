import type { CardInstance, CardPrinting, GameCommand, PlayerGameState, RoomEvent, RoomPlayer, RoomState, ZoneName } from '@mtg/shared';
import { inMulligan, inSideboarding, isActive, seatedPlayers } from '@mtg/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { Chip, ChipButton } from '../components/Chip';

import type { CommandResult } from '../rooms/connection';
import { CardSizeProvider, cardSizeFor, DEFAULT_CARD_SIZE, useCardSize, type CardSize } from './cardSize';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { DrawByNameDialog } from './DrawByNameDialog';
import { MulliganOverlay } from './MulliganOverlay';
import { SideboardOverlay } from './SideboardOverlay';
import { GENERAL_COUNTER } from './counters';
import { Hand } from './Hand';
import { LibraryDialog } from './LibraryDialog';
import { PlayerStrip } from './PlayerStrip';
import { Toolbar } from './Toolbar';
import { ShortcutsDialog } from './ShortcutsDialog';
import { BattlefieldRow, columnStep, defaultRow, dropSlot, freeColumns, layoutRows } from './Battlefield';
import { StackZone } from './StackZone';
import { CardBack, TableCard } from './TableCard';
import { TokenDialog } from './TokenDialog';
import { useCards } from './useCards';
import { useHighlights } from './useHighlights';
import { playerAtSeat, quadrants } from './seating';
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
export function Table({ state, meId, send, live = [], connected = [], onEndGame, onNewGame }: { state: RoomState; meId: string; send: Send; live?: RoomEvent[]; connected?: string[]; onEndGame?: (() => void) | undefined; onNewGame?: (() => void) | undefined }) {
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
  const [drawDialog, setDrawDialog] = useState(false);
  const [helpDialog, setHelpDialog] = useState(false);
  /** Own cards currently selected (battlefield or hand). */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const cardOwner = useCallback((id: string) => game.cards[id]?.ownerId, [game.cards]);
  const highlighted = useHighlights(live, cardOwner, meId);

  // Card sizes derive from the measured table; each layout hands every area its own share.
  const rootRef = useRef<HTMLDivElement>(null);
  const [rootSize, setRootSize] = useState({ w: 1200, h: 800 });
  const [focused, setFocused] = useState<string | null>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => setRootSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Drop selections of cards that no longer exist or are no longer mine.
  const liveSelected = new Set([...selected].filter((id) => game.cards[id]?.controllerId === meId));
  const isSelected = (id: string) => liveSelected.has(id);
  const selectedIds = () => [...liveSelected];

  /** Cards sent to the battlefield without a spot: lands to the back row, others to the front, after the last used column. */
  const place = useCallback(
    (command: GameCommand): GameCommand => {
      const nextCol = (playerId: string, row: number, extra: number[]) => {
        const cols = Object.values(game.cards)
          .filter((c) => c.controllerId === playerId && c.zone === 'battlefield' && c.position && Math.round(c.position.row) === row)
          .map((c) => Math.round(c.position!.col));
        return Math.max(-1, ...cols, ...extra) + 1;
      };
      if (command.type === 'moveCard' && command.to === 'battlefield' && !command.position) {
        const c = game.cards[command.instanceId];
        if (!c || c.zone === 'battlefield') return command;
        const row = defaultRow(c.printingId ? printings.get(c.printingId) : undefined);
        return { ...command, position: { row, col: nextCol(c.controllerId, row, []) } };
      }
      if (command.type === 'moveCards' && command.to === 'battlefield' && !command.positions) {
        const positions: Record<string, { row: number; col: number }> = {};
        const used: Record<number, number[]> = { 0: [], 1: [] };
        for (const id of command.instanceIds) {
          const c = game.cards[id];
          if (!c) continue;
          if (c.zone === 'battlefield' && c.position) continue; // already placed: keep
          const row = defaultRow(c.printingId ? printings.get(c.printingId) : undefined);
          const col = nextCol(c.controllerId, row, used[row] ?? []);
          (used[row] ??= []).push(col);
          positions[id] = { row, col };
        }
        return { ...command, positions };
      }
      return command;
    },
    [game.cards, printings],
  );

  const run = useCallback<Run>(
    async (command) => {
      setError(null);
      const r = await send(place(command));
      if (!r.ok) setError(r.error);
    },
    [send, place],
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
        setFocused(null);
        setSelected(new Set());
        return;
      }
      if (players.length > 2 && /^[1-4]$/.test(e.key)) {
        const target = playerAtSeat(state, Number(e.key));
        if (target) setFocused((f) => (f === target.id ? null : target.id));
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
        case 'n': return void run({ type: 'endTurn' });
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
    if (card.controllerId !== meId) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const next = new Set(liveSelected);
      if (next.has(card.id)) next.delete(card.id);
      else next.add(card.id);
      setSelected(next);
      return;
    }
    if (card.zone !== 'battlefield') {
      // A spell on the stack selects on click so the zone shortcuts (g / e / h / b) apply to it.
      setSelected(card.zone === 'stack' ? new Set([card.id]) : new Set());
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
      const add = (kind: string, delta: number) => () => void run({ type: 'addCounter', instanceId: card.id, kind, delta });
      const has = (kind: string) => (card.counters[kind] ?? 0) > 0;
      items.push({ label: '+1/+1 counter', onSelect: add('+1/+1', 1) });
      if (has('+1/+1')) items.push({ label: 'Remove a +1/+1 counter', onSelect: add('+1/+1', -1) });
      items.push({ label: '−1/−1 counter', onSelect: add('-1/-1', 1) });
      if (has('-1/-1')) items.push({ label: 'Remove a −1/−1 counter', onSelect: add('-1/-1', -1) });
      items.push({ label: 'Loyalty +1', onSelect: add('loyalty', 1) });
      if (has('loyalty')) items.push({ label: 'Loyalty −1', onSelect: add('loyalty', -1) });
      items.push({ label: 'Counter +1', onSelect: add(GENERAL_COUNTER, 1) });
      if (has(GENERAL_COUNTER)) items.push({ label: 'Counter −1', onSelect: add(GENERAL_COUNTER, -1) });
      items.push('sep');
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
    if (card.isCommander) moves.push(['command', 'the command zone']);
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
      { label: 'Draw by name…', onSelect: () => setDrawDialog(true) },
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

  const openGroupMenu = (cards: CardInstance[]) => (e: MouseEvent) => {
    e.preventDefault();
    setSelected(new Set(cards.map((c) => c.id)));
    setMenu({ x: e.clientX, y: e.clientY, card: cards[cards.length - 1]! });
  };

  const onMarquee = useCallback((ids: string[], additive: boolean) => {
    setSelected((prev) => (additive ? new Set([...prev, ...ids]) : new Set(ids)));
  }, []);

  const shared = { cards: game.cards, printings, run, onCardClick, highlighted };
  const connectedSet = new Set(connected);
  const sizeFor = (fw: number, fh: number) => cardSizeFor(rootSize.w * fw, rootSize.h * fh);

  const area = (p: RoomPlayer, opts: { flipped?: boolean; collapsed?: boolean; size: CardSize }) => {
    const isMe = p.id === meId;
    return (
      <CardSizeProvider key={p.id} size={opts.size}>
        <PlayerArea
          {...shared}
          state={state}
          player={p}
          pgs={game.players[p.id]!}
          mine={isMe}
          flipped={opts.flipped ?? false}
          collapsed={opts.collapsed ?? false}
          connected={connectedSet.has(p.id)}
          onCardMenu={openMenu}
          onGroupMenu={isMe ? openGroupMenu : undefined}
          onCardDragStart={isMe ? onCardDragStart : undefined}
          onLibraryMenu={isMe ? (e) => { e.preventDefault(); setPileMenu({ x: e.clientX, y: e.clientY }); } : undefined}
          onToken={isMe ? () => setTokenDialog(true) : undefined}
          onHelp={isMe ? () => setHelpDialog(true) : undefined}
          onEndGame={isMe ? onEndGame : undefined}
          onNewGame={isMe ? onNewGame : undefined}
          isSelected={isMe ? isSelected : () => false}
          onMarquee={isMe ? onMarquee : undefined}
          selectedCount={isMe ? liveSelected.size : 0}
          banner={isMe ? error : undefined}
          onFocus={players.length > 2 ? () => setFocused((f) => (f === p.id ? null : p.id)) : undefined}
          focused={focused === p.id}
        />
      </CardSizeProvider>
    );
  };

  let layout: ReactNode;
  if (players.length <= 2) {
    // Two rows, equal halves (the 1v1 table).
    layout = (
      <div className="grid h-full min-h-0 w-full" style={{ gridTemplateRows: `repeat(${Math.max(1, players.length)}, minmax(0, 1fr))` }}>
        {opponents.map((p) => area(p, { flipped: true, size: sizeFor(1, 1 / Math.max(1, players.length)) }))}
        {me && area(me, { size: sizeFor(1, 1 / Math.max(1, players.length)) })}
      </div>
    );
  } else if (focused) {
    // Focus mode: the chosen board fills the screen; others collapse to their strips;
    // my own board stays as a compact band at the bottom so I can keep playing.
    const target = players.find((p) => p.id === focused)!;
    const others = players.filter((p) => p.id !== focused && p.id !== meId);
    const showMine = me && focused !== meId;
    layout = (
      <div className="grid h-full min-h-0 w-full" style={{ gridTemplateRows: `${others.length ? 'auto ' : ''}minmax(0, ${showMine ? 1.7 : 1}fr)${showMine ? ' minmax(0, 1fr)' : ''}` }}>
        {others.length > 0 && <div className="flex min-w-0 divide-x divide-white/10 border-b border-white/10">{others.map((p) => <div key={p.id} className="min-w-0 flex-1">{area(p, { collapsed: true, size: DEFAULT_CARD_SIZE })}</div>)}</div>}
        {area(target, { flipped: target.id !== meId, size: sizeFor(1, showMine ? 0.62 : 0.95) })}
        {showMine && area(me, { size: sizeFor(1, 0.36) })}
      </div>
    );
  } else {
    // Quadrants: me bottom-left, then clockwise. Top row is flipped (hands at the far edge).
    const q = quadrants(state, meId);
    const cell = (p: RoomPlayer | null, flipped: boolean) => (p ? area(p, { flipped, size: sizeFor(0.5, 0.5) }) : <div className="min-h-0" />);
    layout = (
      <div className="grid h-full min-h-0 w-full grid-cols-2 grid-rows-2 [&>*]:border-white/10 [&>*:nth-child(odd)]:border-r [&>*:nth-child(-n+2)]:border-b">
        {cell(q.topLeft, true)}
        {cell(q.topRight, true)}
        {cell(q.bottomLeft, false)}
        {cell(q.bottomRight, false)}
      </div>
    );
  }

  return (
    <CardSizeProvider size={sizeFor(1, 0.5)}>
      <div ref={rootRef} className="relative h-full min-h-0 w-full">
      {layout}
      <StackZone state={state} meId={meId} printings={printings} run={run} onCardMenu={openMenu} onCardDragStart={onCardDragStart} onCardClick={onCardClick} isSelected={isSelected} />
      {inSideboarding(game) ? <SideboardOverlay state={state} meId={meId} run={run} /> : inMulligan(game) && <MulliganOverlay state={state} meId={meId} printings={printings} run={run} />}
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
        {drawDialog && me && (
          <DrawByNameDialog library={game.players[me.id]!.zones.library} cards={game.cards} printings={printings} run={run} onClose={() => setDrawDialog(false)} />
        )}
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

function PlayerArea({ state, player, pgs, cards, printings, mine, connected, run, flipped = false, collapsed = false, onCardClick, onCardMenu, onGroupMenu, onCardDragStart, onToken, onHelp, onEndGame, onNewGame, onLibraryMenu, isSelected, highlighted, onMarquee, selectedCount = 0, banner, bannerKind = 'error', onFocus, focused = false }: {
  onEndGame?: (() => void) | undefined;
  onNewGame?: (() => void) | undefined;
  /** Strip only (other opponents while focused on one board). */
  collapsed?: boolean;
  /** Toggle focus on this board (name click); present on 3+ player tables. */
  onFocus?: (() => void) | undefined;
  focused?: boolean;
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
  /** Right-click on a grouped token pile: selects the group and opens the selection menu. */
  onGroupMenu?: ((cards: CardInstance[]) => (e: MouseEvent) => void) | undefined;
  onCardDragStart?: ((card: CardInstance) => (e: DragEvent) => void) | undefined;
  onToken?: (() => void) | undefined;
  onHelp?: (() => void) | undefined;
  onLibraryMenu?: ((e: MouseEvent) => void) | undefined;
  isSelected: (id: string) => boolean;
  highlighted: ReadonlySet<string>;
  onMarquee?: ((ids: string[], additive: boolean) => void) | undefined;
  selectedCount?: number;
  banner?: string | null | undefined;
  bannerKind?: 'info' | 'error';
}) {
  const { w } = useCardSize();
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
  /**
   * Drop anywhere on the battlefield: the row under (or nearest to) the pointer,
   * the column under the pointer; a pile if that column is occupied, else the
   * selection fills free columns from there.
   */
  const dropToBattlefield = (e: DragEvent<HTMLDivElement>) => {
    if (!mine) return;
    e.preventDefault();
    const ids = parseIds(e);
    if (ids.length === 0) return;
    const rowEls = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-row]')];
    if (rowEls.length === 0) return;
    const rowEl =
      rowEls.find((el) => {
        const r = el.getBoundingClientRect();
        return e.clientY >= r.top && e.clientY <= r.bottom;
      }) ??
      rowEls.reduce((best, el) => {
        const d = (x: HTMLElement) => {
          const r = x.getBoundingClientRect();
          return Math.min(Math.abs(e.clientY - r.top), Math.abs(e.clientY - r.bottom));
        };
        return d(el) < d(best) ? el : best;
      });
    const row = Number(rowEl.dataset.row);
    const rect = rowEl.getBoundingClientRect();
    const slots = (rows[row] ?? []).filter((s) => !s.cards.every((c) => ids.includes(c.id)));
    const step = columnStep(slots, rect.width - 16, w);
    const slot = dropSlot(slots, e.clientX - rect.left - 8, step);
    const positions: Record<string, { row: number; col: number }> = {};
    if (slot.pile) ids.forEach((id) => (positions[id] = { row, col: slot.col }));
    else freeColumns(slots, slot.col, ids.length).forEach((col, i) => (positions[ids[i]!] = { row, col }));
    void run({ type: 'moveCards', instanceIds: ids, to: 'battlefield', positions });
  };
  const allowDrop = mine ? (e: DragEvent) => e.preventDefault() : undefined;

  const cardEl = (c: CardInstance, extra: { onClick?: boolean; group?: CardInstance[] | undefined } = {}) => {
    const group = extra.group;
    const ids = group ? group.map((g) => g.id) : null;
    return (
      <TableCard
        card={c}
        printing={c.printingId ? printings.get(c.printingId) : undefined}
        mine={mine}
        selected={isSelected(c.id)}
        groupCount={group?.length}
        onClick={extra.onClick === false ? undefined : ids && mine ? () => void run({ type: 'tapCards', instanceIds: ids, tapped: !c.tapped }) : (e) => onCardClick(c, e)}
        onContextMenu={ids && mine && onGroupMenu ? onGroupMenu(group!) : onCardMenu && (mine || c.printingId !== null) ? onCardMenu(c) : undefined}
        onDragStart={
          ids && mine
            ? (e) => {
                e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
                e.dataTransfer.setData('text/dragged-id', c.id);
                e.dataTransfer.effectAllowed = 'move';
              }
            : mine && onCardDragStart
              ? onCardDragStart(c)
              : undefined
        }
        onAdjustCounter={mine ? (kind, delta) => void run({ type: 'addCounter', instanceId: c.id, kind, delta }) : undefined}
      />
    );
  };

  const rowOrder = flipped ? [1, 0] : [0, 1];
  const battlefield = (
    <div
      className="relative flex min-h-0 flex-col justify-end gap-1 touch-none"
      onDragOver={allowDrop}
      onDrop={mine ? dropToBattlefield : undefined}
      {...(mine ? marquee.handlers : {})}
    >
      {rowOrder.map((r) => (
        <BattlefieldRow key={r} row={r} slots={rows[r] ?? []} renderCard={(c, o) => cardEl(c, { onClick: mine, group: o.group })} />
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
        <Pile label="Library" count={pgs.zones.library.length} stack onDragOver={allowDrop} onDrop={dropTo('library')} onContextMenu={mine ? onLibraryMenu : undefined} onClick={mine && pgs.zones.library.length > 0 ? () => void run({ type: 'draw', count: 1 }) : undefined} onLabelClick={mine ? onLibraryMenu : undefined} hint={pgs.topRevealed ? 'top revealed' : undefined}>
          {pgs.zones.library.length > 0 && cards[pgs.zones.library[0]!]?.printingId ? topCard(zoneCards('library').slice(0, 1), printings) : pgs.zones.library.length > 0 ? <CardBack /> : null}
        </Pile>
        <Pile label="Graveyard" count={pgs.zones.graveyard.length} onDragOver={allowDrop} onDrop={dropTo('graveyard')} browse={{ cards: zoneCards('graveyard'), open: expandedPile === 'graveyard', toggle: () => setExpandedPile((p) => (p === 'graveyard' ? null : 'graveyard')), close: () => setExpandedPile(null), towards: flipped ? 'down' : 'up', render: (c) => cardEl(c, { onClick: false }) }}>
          {topCard(zoneCards('graveyard'), printings, mine ? onCardMenu : undefined)}
        </Pile>
        <Pile label="Exile" count={pgs.zones.exile.length} onDragOver={allowDrop} onDrop={dropTo('exile')} browse={{ cards: zoneCards('exile'), open: expandedPile === 'exile', toggle: () => setExpandedPile((p) => (p === 'exile' ? null : 'exile')), close: () => setExpandedPile(null), towards: flipped ? 'down' : 'up', render: (c) => cardEl(c, { onClick: false }) }}>
          {topCard(zoneCards('exile'), printings, mine ? onCardMenu : undefined)}
        </Pile>
        {(state.settings.commander || pgs.zones.command.length > 0) && (
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
        toolbar={mine ? <Toolbar run={run} onToken={onToken ?? (() => undefined)} onHelp={onHelp ?? (() => undefined)} onEndGame={onEndGame} onNewGame={onNewGame} myTurn={isActive(state, player.id)} /> : undefined}
        onFocus={onFocus}
        focused={focused}
      />
      {mine && selectedCount > 0 && <Chip type="primary">{selectedCount} selected</Chip>}
      {mine && banner && <Chip type={bannerKind === 'info' ? 'primary' : 'error'} className="!max-w-[40ch] truncate">{banner}</Chip>}
    </div>
  );

  // Opponents: strip at the top edge, hand next, battlefield towards the middle. Me: mirrored.
  if (collapsed) return <div className="min-w-0 px-1">{strip}</div>;
  const order = flipped ? [strip, tray, battlefield] : [battlefield, tray, strip];
  const rowsTemplate = flipped ? 'auto auto minmax(0, 1fr)' : 'minmax(0, 1fr) auto auto';

  return (
    <section
      className={`half grid min-h-0 transition-shadow duration-300 ${flipped ? 'border-b border-white/10' : ''} ${highlighted.has(player.id) ? 'shadow-[inset_0_0_0_2px_var(--color-accent)]' : isActive(state, player.id) ? 'shadow-[inset_0_0_0_1px_var(--color-accent)]' : ''}`}
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

function Pile({ label, count, children, stack = false, hint, browse, onClick, onLabelClick, ...drop }: { label: string; count: number; children?: ReactNode; stack?: boolean; hint?: string | undefined; browse?: Browse | undefined; onClick?: (() => void) | undefined; onLabelClick?: ((e: MouseEvent) => void) | undefined; onDragOver?: ((e: DragEvent) => void) | undefined; onDrop?: ((e: DragEvent<HTMLDivElement>) => void) | undefined; onContextMenu?: ((e: MouseEvent) => void) | undefined }) {
  const { w, h } = useCardSize();
  const empty = count === 0;
  const canBrowse = !!browse && count > 1;
  const chipVars = { '--chip-bg': 'var(--chip-soft-neutral-bg)', '--chip-fg': 'var(--chip-soft-neutral-fg)', '--chip-bd': 'var(--chip-soft-neutral-bd)', '--chip-hover': 'var(--chip-soft-neutral-hover)' } as CSSProperties;
  return (
    <div className="relative" style={{ width: w, height: h }} {...drop} title={label}>
      {stack && count > 2 && <div className="absolute inset-0 translate-x-[3px] translate-y-[3px] rounded-[4.5%] bg-[#1a1533] card-shadow" />}
      {stack && count > 1 && <div className="absolute inset-0 translate-x-[1.5px] translate-y-[1.5px] rounded-[4.5%] bg-[#221b45] card-shadow" />}
      <div
        className={`absolute inset-0 flex items-center justify-center rounded-[4.5%] ${empty ? 'border border-dashed border-white/15' : ''} ${onClick ? 'cursor-pointer' : ''}`}
        onClick={onClick}
        title={onClick ? 'click to draw' : undefined}
      >
        {children}
      </div>
      {onLabelClick ? (
        <ChipButton type="neutral" className="absolute inset-x-0 bottom-1 mx-auto !bg-[var(--n900)]/90" onClick={(e) => { e.stopPropagation(); onLabelClick(e); }} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onLabelClick(e); }} title="Library actions">
          {label} · {count}{hint ? ` · ${hint}` : ''} ▾
        </ChipButton>
      ) : (
        <Chip type="neutral" className="pointer-events-none absolute inset-x-0 bottom-1 mx-auto !bg-[var(--n900)]/90" style={chipVars}>{label} · {count}{hint ? ` · ${hint}` : ''}</Chip>
      )}
      {canBrowse && !browse.open && (
        <button
          type="button"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            browse.toggle();
          }}
          className={`absolute left-1/2 z-10 -translate-x-1/2 chip chip--pill chip--clickable ${browse.towards === 'up' ? '-top-2' : '-bottom-2'}`}
          style={{ '--chip-bg': 'var(--chip-solid-neutral-bg)', '--chip-fg': 'var(--chip-solid-neutral-fg)', '--chip-bd': 'var(--chip-solid-neutral-bd)', '--chip-hover': 'var(--chip-solid-neutral-hover)' } as CSSProperties}
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
