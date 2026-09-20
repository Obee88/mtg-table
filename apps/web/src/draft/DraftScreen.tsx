import type { CardPrinting, DraftCard, DraftState, RoomState } from '@mtg/shared';
import { nextSeat, usableLibrarians } from '@mtg/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { imageFor } from '../cards/CardImage';
import { CardPreviewProvider, useCardPreview } from '../cards/CardPreview';
import { Chip } from '../components/Chip';
import type { GameRoom } from '../table/GameScreen';
import { LogPanel } from '../table/LogPanel';
import { playerColor } from '../table/PlayerStrip';
import { useCards } from '../table/useCards';
import { draftPrintingIds } from './ids';
import { packLayout } from './layout';
import { groupPool, POOL_SORTS, type PoolEntry, type PoolSort } from './pool';

/** The whole-viewport draft: seats and direction on top, the pack at hand in the middle, the pool below; log column on the right. */
export function DraftScreen({ room, meId, leaveHref = '/rooms' }: { room: GameRoom; meId: string; leaveHref?: string }) {
  const { state } = room;
  const draft = state.draft!;
  const isOwner = state.ownerId === meId;
  const closeRoom = () => {
    if (confirm('Close this room for everyone? The draft ends.')) void room.send({ type: 'closeRoom' });
  };
  const printings = useCards(draftPrintingIds(draft));
  const me = draft.players[meId];
  const pack = me?.queue[0] ? draft.packs[me.queue[0]] : undefined;
  const spectator = !me;

  return (
    <CardPreviewProvider mode="panel">
      <main className="felt flex h-dvh w-screen overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <SeatStrip state={state} draft={draft} meId={meId} printings={printings} connected={room.connected} />
          <div className="min-h-0 flex-[3]">
            {draft.status === 'finished' ? (
              <Notice title="Draft finished" text="Everyone has their pool. Deckbuilding is the next step." />
            ) : spectator ? (
              <Notice title="Drafting" text="You are watching; picks are private until the draft ends." />
            ) : pack ? (
              <PackView key={pack.id} draft={draft} pack={pack} meId={meId} printings={printings} send={room.send} />
            ) : (
              <Notice title="Waiting for a pack" text={`The next pack comes from ${fromSeatName(state, draft, meId)}.`} pulse />
            )}
          </div>
          {me && <Pool cards={me.pool} printings={printings} />}
        </div>
        <LogPanel roomId={state.id} state={state} live={room.events} status={room.status} leaveHref={leaveHref} onCloseRoom={isOwner ? closeRoom : undefined} />
      </main>
    </CardPreviewProvider>
  );
}

function Notice({ title, text, pulse = false }: { title: string; text: string; pulse?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
      <p className={`text-lg font-semibold text-white/80 ${pulse ? 'animate-pulse' : ''}`}>{title}</p>
      <p className="text-sm text-white/50">{text}</p>
    </div>
  );
}

/** Name of the seat that passes to `meId` under the current direction. */
function fromSeatName(state: RoomState, draft: DraftState, meId: string): string {
  const seat = draft.seats.indexOf(meId);
  if (seat < 0) return 'the table';
  // Packs travel in `direction`; the one arriving comes from the seat on the other side.
  const opposite = draft.direction === 'left' ? 'right' : 'left';
  const from = draft.seats[nextSeat(draft.seats.length, seat, opposite)]!;
  return state.players[from]?.displayName ?? 'the next seat';
}

/** One line per seat in passing order with the direction between them, face-up picks and pack counts. */
function SeatStrip({ state, draft, meId, printings, connected }: { state: RoomState; draft: DraftState; meId: string; printings: Map<string, CardPrinting>; connected: string[] }) {
  const phase = draft.config.phases[draft.phase];
  const arrow = draft.direction === 'left' ? '→' : '←';
  const running = draft.status === 'running';
  return (
    <div className="flex h-auto shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px] leading-none">
      <span className="font-semibold text-white/90">{draft.config.name}</span>
      {running && phase && <Chip type="primary">{phase.name} · round {draft.round + 1}/{phase.rounds}</Chip>}
      {running && <Chip type="neutral" title={`Packs pass ${draft.direction}`}>passing {draft.direction} {arrow}</Chip>}
      {!running && <Chip type="success">finished</Chip>}
      <span className="flex flex-wrap items-center gap-2">
        {draft.seats.map((id, i) => {
          const player = state.players[id];
          const d = draft.players[id];
          return (
            <span key={id} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-white/40">{arrow}</span>}
              <span className={`flex items-center gap-1.5 rounded-md px-1.5 py-1 ${id === meId ? 'bg-white/10' : ''}`}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: connected.includes(id) ? (player ? playerColor(state, player) : 'white') : 'var(--color-border)' }} />
                <span className="font-medium" style={player ? { color: playerColor(state, player) } : undefined}>{player?.displayName ?? id}</span>
                <Chip type="neutral" title="cards picked">{d?.pool.length ?? 0}</Chip>
                {running && (d?.queue.length ?? 0) > 0 && <Chip type="warning" shape="pill" title="packs waiting at this seat">{d!.queue.length}</Chip>}
                {d?.faceUp.map((c) => <Thumb key={c.id} card={c} printing={printings.get(c.printingId)} w={28} title="drafted face up" />)}
              </span>
            </span>
          );
        })}
      </span>
    </div>
  );
}

function Thumb({ card, printing, w, title }: { card: DraftCard; printing: CardPrinting | undefined; w: number; title?: string }) {
  const preview = useCardPreview(printing ? imageFor(printing, 'normal') : null);
  const src = printing ? imageFor(printing, 'small') : null;
  return (
    <span className="inline-block overflow-hidden rounded-[4.5%] bg-black/40" style={{ width: w, height: Math.round(w * 1.4) }} title={title ?? printing?.name ?? card.id} {...preview}>
      {src && <img src={src} alt={printing?.name ?? ''} className="h-full w-full object-cover" draggable={false} />}
    </span>
  );
}

/** The pack at hand: click to select, click again (or the button / Enter) to pick. A usable Librarian enables picking two. */
function PackView({ draft, pack, meId, printings, send }: { draft: DraftState; pack: DraftState['packs'][string]; meId: string; printings: Map<string, CardPrinting>; send: GameRoom['send'] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setArea({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [selected, setSelected] = useState<string[]>([]);
  const [faceUp, setFaceUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const librarian = usableLibrarians(draft, meId)[0];
  const [useLibrarian, setUseLibrarian] = useState(false);
  const want = useLibrarian && librarian ? 2 : 1;
  const layout = packLayout(pack.cards.length, area.w, area.h - 44);

  const toggle = (id: string) => {
    setError(null);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.slice(-(want - 1)), id]));
  };
  const pick = async () => {
    if (selected.length !== want || busy) return;
    setBusy(true);
    const [first, second] = selected;
    const r = await send({ type: 'draftPick', cardId: first!, faceUp, ...(useLibrarian && librarian && second ? { librarian: { cardId: librarian.id, secondCardId: second } } : {}) });
    setBusy(false);
    if (!r.ok) setError(r.error);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') void pick();
      if (e.key === 'Escape') setSelected([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pickNo = pack.taken + 1;
  const total = pack.taken + pack.cards.length;
  const names = selected.map((id) => printings.get(pack.cards.find((c) => c.id === id)?.printingId ?? '')?.name ?? 'card');

  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col px-3">
      <div className="flex h-11 shrink-0 items-center gap-2 text-[13px]">
        <span className="font-semibold text-white/90">Pick {pickNo} of {total}</span>
        <span className="text-white/50">· {pack.cards.length} card{pack.cards.length === 1 ? '' : 's'} in the pack</span>
        {librarian && (
          <label className="ml-2 flex items-center gap-1 text-white/80" title="Draft two cards from this pack; the Librarian goes into the pack instead">
            <input type="checkbox" checked={useLibrarian} onChange={(e) => { setUseLibrarian(e.target.checked); setSelected([]); }} />
            use Cogwork Librarian (pick two)
          </label>
        )}
        <label className="ml-2 flex items-center gap-1 text-white/60" title="Everyone sees this pick (draft-matters cards)">
          <input type="checkbox" checked={faceUp} onChange={(e) => setFaceUp(e.target.checked)} />
          face up
        </label>
        {error && <Chip type="error">{error}</Chip>}
        <button
          type="button"
          onClick={() => void pick()}
          disabled={selected.length !== want || busy}
          className="ml-auto rounded-md bg-accent px-3 py-1 text-sm font-medium text-bg hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {selected.length === want ? `Pick ${names.join(' + ')}` : want === 2 ? `Choose ${2 - selected.length} more` : 'Choose a card'}
        </button>
      </div>
      <div className="grid min-h-0 flex-1 content-start justify-center gap-2" style={{ gridTemplateColumns: `repeat(${layout.cols}, ${layout.cardW}px)` }}>
        {pack.cards.map((c) => (
          <PackCard key={c.id} card={c} printing={printings.get(c.printingId)} w={layout.cardW} selected={selected.includes(c.id)} onClick={() => toggle(c.id)} onDoubleClick={() => { if (want === 1) { setSelected([c.id]); void send({ type: 'draftPick', cardId: c.id, faceUp }).then((r) => !r.ok && setError(r.error)); } }} />
        ))}
      </div>
    </div>
  );
}

function PackCard({ card, printing, w, selected, onClick, onDoubleClick }: { card: DraftCard; printing: CardPrinting | undefined; w: number; selected: boolean; onClick: () => void; onDoubleClick: () => void }) {
  const preview = useCardPreview(printing ? imageFor(printing, 'normal') : null);
  const src = printing ? imageFor(printing, w > 160 ? 'normal' : 'small') : null;
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`card-shadow card-lift relative overflow-hidden rounded-[4.5%] bg-black/40 transition-[transform,box-shadow] duration-150 ${selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-transparent' : ''}`}
      style={{ width: w, height: Math.round(w * 1.4) }}
      title={printing?.name}
      {...preview}
    >
      {src ? <img src={src} alt={printing?.name ?? ''} className="h-full w-full object-cover" draggable={false} /> : <span className="flex h-full items-center justify-center p-2 text-xs text-white/60">{printing?.name ?? '…'}</span>}
      {card.ability === 'librarian' && <Chip type="primary" shape="pill" className="absolute left-1 top-1 shadow" title="Draft ability: drafted face up">draft</Chip>}
    </button>
  );
}

/** The drafter's pool, sortable into columns; scrolls sideways when wide. */
function Pool({ cards, printings }: { cards: DraftCard[]; printings: Map<string, CardPrinting> }) {
  const [sort, setSort] = useState<PoolSort>('colour');
  const entries: PoolEntry[] = cards.map((card, i) => ({ card, printing: printings.get(card.printingId), n: i + 1 }));
  const groups = groupPool(entries, sort);
  const w = 72;
  const overlap = Math.round(w * 0.32);
  return (
    <div className="flex min-h-0 flex-[2] flex-col border-t border-white/10 bg-black/20 px-3 pb-2">
      <div className="flex h-9 shrink-0 items-center gap-2 text-[12px] text-white/70">
        <span className="font-semibold text-white/90">Pool · {cards.length}</span>
        <span className="ml-2">sort</span>
        {POOL_SORTS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSort(s.key)} className={`rounded px-1.5 py-0.5 ${sort === s.key ? 'bg-white/15 text-white' : 'hover:bg-white/10'}`}>{s.label}</button>
        ))}
      </div>
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden">
        {groups.map((g) => (
          <div key={g.label} className="flex shrink-0 flex-col">
            <span className="mb-1 text-[11px] text-white/50">{g.label} · {g.cards.length}</span>
            <div className="relative min-h-0 flex-1 overflow-y-auto pr-1" style={{ width: w + 8 }}>
              <div className="relative" style={{ height: g.cards.length ? Math.round(w * 1.4) + overlap * (g.cards.length - 1) : 0 }}>
                {g.cards.map((e, i) => (
                  <div key={e.card.id} className="absolute left-0" style={{ top: i * overlap, zIndex: i }}>
                    <Thumb card={e.card} printing={e.printing} w={w} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
        {groups.length === 0 && <span className="self-center text-sm text-white/40">Nothing picked yet.</span>}
      </div>
    </div>
  );
}
