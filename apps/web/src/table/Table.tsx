import type { CardInstance, CardPrinting, GameCommand, PlayerGameState, RoomPlayer, RoomState, ZoneName } from '@mtg/shared';
import { seatedPlayers } from '@mtg/shared';
import { useCallback, useEffect, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { Button, ErrorText } from '../components';
import type { CommandResult } from '../rooms/connection';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { LibraryDialog } from './LibraryDialog';
import { PlayerBar } from './PlayerBar';
import { CARD_H, CARD_W, CardBack, TableCard } from './TableCard';
import { TokenDialog } from './TokenDialog';
import { useCards } from './useCards';

type Send = (command: GameCommand) => Promise<CommandResult>;
type Run = (c: GameCommand) => Promise<void>;

interface Menu {
  x: number;
  y: number;
  card: CardInstance;
}

export function Table({ state, meId, send }: { state: RoomState; meId: string; send: Send }) {
  const game = state.game!;
  const players = seatedPlayers(state);
  const me = players.find((p) => p.id === meId);
  const opponents = players.filter((p) => p.id !== meId);
  const printings = useCards(Object.values(game.cards).map((c) => c.printingId));
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [tokenDialog, setTokenDialog] = useState(false);
  const [libraryDialog, setLibraryDialog] = useState(false);
  const [pileMenu, setPileMenu] = useState<{ x: number; y: number } | null>(null);
  /** Card waiting for an attachment target to be clicked. */
  const [attaching, setAttaching] = useState<string | null>(null);

  const run = useCallback<Run>(
    async (command) => {
      setError(null);
      const r = await send(command);
      if (!r.ok) setError(r.error);
    },
    [send],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!me) return;
      if (e.key === 'Escape') setAttaching(null);
      if (e.key === 'd') void run({ type: 'draw', count: 1 });
      if (e.key === 'u') void run({ type: 'untapAll' });
      if (e.key === 's') void run({ type: 'shuffleLibrary' });
      if (e.key === 't') setTokenDialog(true);
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void run({ type: 'undo' }); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run, me]);

  const onCardClick = (card: CardInstance) => {
    if (attaching) {
      if (card.id !== attaching && card.zone === 'battlefield') void run({ type: 'attachCard', instanceId: attaching, to: card.id });
      setAttaching(null);
      return;
    }
    if (card.zone === 'battlefield') void run({ type: 'tapCard', instanceId: card.id, tapped: !card.tapped });
  };

  const menuItems = (card: CardInstance): (MenuItem | 'sep')[] => {
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
    }
    const moves: [ZoneName, string][] = [['battlefield', 'battlefield'], ['hand', 'hand'], ['graveyard', 'graveyard'], ['exile', 'exile']];
    for (const [zone, label] of moves) if (zone !== card.zone) items.push({ label: `Move to ${label}`, onSelect: () => void run({ type: 'moveCard', instanceId: card.id, to: zone }) });
    items.push({ label: 'Top of library', onSelect: () => void run({ type: 'moveCard', instanceId: card.id, to: 'library', libraryPosition: 'top' }) });
    items.push({ label: 'Bottom of library', onSelect: () => void run({ type: 'moveCard', instanceId: card.id, to: 'library', libraryPosition: 'bottom' }) });
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
      { label: 'Shuffle', onSelect: () => void run({ type: 'shuffleLibrary' }) },
    ];
  };

  const openMenu = (card: CardInstance) => (e: MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, card });
  };

  return (
    <div className="flex flex-col gap-3">
      {attaching && <p className="rounded-md bg-accent/20 px-3 py-1 text-sm text-accent">Click the permanent to attach to (Esc to cancel).</p>}
      {opponents.map((p) => (
        <PlayerArea key={p.id} state={state} player={p} pgs={game.players[p.id]!} cards={game.cards} printings={printings} mine={false} run={run} flipped onCardClick={onCardClick} onCardMenu={openMenu} attaching={attaching !== null} />
      ))}
      {me && (
        <PlayerArea state={state} player={me} pgs={game.players[me.id]!} cards={game.cards} printings={printings} mine run={run} onCardClick={onCardClick} onCardMenu={openMenu} onLibraryMenu={(e) => { e.preventDefault(); setPileMenu({ x: e.clientX, y: e.clientY }); }} onToken={() => setTokenDialog(true)} attaching={attaching !== null} />
      )}
      <ErrorText error={error} />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.card.controllerId === meId ? menuItems(menu.card) : opponentHandItems(menu.card)}
          onClose={() => setMenu(null)}
          header={menu.card.customName ?? (menu.card.printingId ? printings.get(menu.card.printingId)?.name : 'Card')}
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
    </div>
  );
}

/** Attachments render slightly offset behind their host. */
const ATTACH_OFFSET = 14;

function PlayerArea({ state, player, pgs, cards, printings, mine, run, flipped = false, onCardClick, onCardMenu, onToken, onLibraryMenu, attaching }: {
  state: RoomState;
  player: RoomPlayer;
  pgs: PlayerGameState;
  cards: Record<string, CardInstance>;
  printings: Map<string, CardPrinting>;
  mine: boolean;
  run: Run;
  flipped?: boolean;
  onCardClick: (card: CardInstance) => void;
  onCardMenu?: ((card: CardInstance) => (e: MouseEvent) => void) | undefined;
  onToken?: (() => void) | undefined;
  onLibraryMenu?: ((e: MouseEvent) => void) | undefined;
  attaching: boolean;
}) {
  const zoneCards = (zone: ZoneName) => pgs.zones[zone].map((id) => cards[id]).filter((c): c is CardInstance => !!c);

  const dropTo = (zone: ZoneName) => (e: DragEvent<HTMLDivElement>) => {
    if (!mine) return;
    e.preventDefault();
    const instanceId = e.dataTransfer.getData('text/instance-id');
    if (!instanceId) return;
    const command: GameCommand = { type: 'moveCard', instanceId, to: zone };
    if (zone === 'battlefield') {
      const rect = e.currentTarget.getBoundingClientRect();
      command.position = {
        x: Math.max(0, Math.min(100, ((e.clientX - rect.left - CARD_W / 2) / rect.width) * 100)),
        y: Math.max(0, Math.min(100, ((e.clientY - rect.top - CARD_H / 2) / rect.height) * 100)),
      };
    }
    void run(command);
  };
  const allowDrop = mine ? (e: DragEvent) => e.preventDefault() : undefined;

  // Hosts first (lower z), attachments tucked behind them; unattached cards at their own position.
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
    const pos = anchor ? { x: base.x, y: base.y } : base;
    return { card: c, x: pos.x, y: pos.y, dx: anchor ? (index + 1) * ATTACH_OFFSET : 0, z: anchor ? 10 - depth : 20 };
  });

  const battlefield = (
    <div
      className={`relative min-h-[240px] flex-1 rounded-lg border bg-surface/60 ${attaching && !mine ? 'border-border' : attaching ? 'border-accent' : 'border-border'}`}
      onDragOver={allowDrop}
      onDrop={dropTo('battlefield')}
    >
      {placed.map(({ card, x, y, dx, z }) => (
        <div key={card.id} className="absolute" style={{ left: `calc(${x}% + ${dx}px)`, top: `calc(${y}% + ${dx}px)`, zIndex: z }}>
          <TableCard
            card={card}
            printing={card.printingId ? printings.get(card.printingId) : undefined}
            mine={mine}
            onClick={mine || attaching ? () => onCardClick(card) : undefined}
            onContextMenu={mine && onCardMenu ? onCardMenu(card) : undefined}
          />
        </div>
      ))}
      {pgs.zones.battlefield.length === 0 && <span className="absolute inset-0 flex items-center justify-center text-xs text-text-muted">{mine ? 'drag cards here · right-click a card for actions' : 'battlefield'}</span>}
    </div>
  );

  const hand = (
    <div className="flex min-h-[calc(112px+1rem)] flex-wrap items-center gap-2 rounded-lg border border-border bg-surface/60 p-2" onDragOver={allowDrop} onDrop={dropTo('hand')}>
      {zoneCards('hand').map((c) => (
        <TableCard key={c.id} card={c} printing={c.printingId ? printings.get(c.printingId) : undefined} mine={mine} onContextMenu={onCardMenu && (mine || c.printingId !== null) ? onCardMenu(c) : undefined} />
      ))}
      {pgs.zones.hand.length === 0 && <span className="px-2 text-xs text-text-muted">empty hand</span>}
    </div>
  );

  const piles = (
    <div className="flex shrink-0 gap-2">
      <Pile label={pgs.topRevealed ? 'Library (top revealed)' : 'Library'} count={pgs.zones.library.length} onDragOver={allowDrop} onDrop={dropTo('library')} onContextMenu={mine ? onLibraryMenu : undefined}>
        {pgs.zones.library.length > 0 && (cards[pgs.zones.library[0]!]?.printingId ? topCard(zoneCards('library').slice(0, 1), printings, false) : <CardBack />)}
      </Pile>
      <Pile label="Graveyard" count={pgs.zones.graveyard.length} onDragOver={allowDrop} onDrop={dropTo('graveyard')}>
        {topCard(zoneCards('graveyard'), printings, mine, onCardMenu)}
      </Pile>
      <Pile label="Exile" count={pgs.zones.exile.length} onDragOver={allowDrop} onDrop={dropTo('exile')}>
        {topCard(zoneCards('exile'), printings, mine, onCardMenu)}
      </Pile>
      {pgs.zones.command.length > 0 && (
        <Pile label="Command" count={pgs.zones.command.length} onDragOver={allowDrop} onDrop={dropTo('command')}>
          {topCard(zoneCards('command'), printings, mine, onCardMenu)}
        </Pile>
      )}
    </div>
  );

  return (
    <section className={`flex flex-col gap-2 ${flipped ? 'flex-col-reverse' : ''}`}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{player.displayName}{mine && ' (you)'}</span>
        <span className="text-text-muted">hand {pgs.zones.hand.length} · library {pgs.zones.library.length}</span>
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

function topCard(cards: CardInstance[], printings: Map<string, CardPrinting>, mine: boolean, onCardMenu?: ((card: CardInstance) => (e: MouseEvent) => void) | undefined) {
  const top = cards[cards.length - 1];
  if (!top) return null;
  return <TableCard card={top} printing={top.printingId ? printings.get(top.printingId) : undefined} mine={mine} onContextMenu={mine && onCardMenu ? onCardMenu(top) : undefined} />;
}
