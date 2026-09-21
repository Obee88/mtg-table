import type { CardPrinting, DeckContents, DeckResponse, DraftHistoryDeck } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Card, ErrorText, Input } from '../components';
import { Chip } from '../components/Chip';
import { DeckEditor } from '../decks/DeckEditor';
import { countSection, mergeCards, toDeckInput, type EditableDeck } from '../decks/model';
import { api } from '../lib/api';
import { useCards } from '../table/useCards';
import { DRAFT_TYPE_LABELS } from './DraftHistoryPage';

/** Deck contents plus resolved printings → something the editor can show. Cards whose printing is unknown are dropped. */
function fromContents(name: string, contents: DeckContents, printings: Map<string, CardPrinting>): EditableDeck {
  const section = (cards: DeckContents['main']) => mergeCards(cards.flatMap((c) => { const p = printings.get(c.printingId); return p ? [{ printing: p, quantity: c.quantity }] : []; }));
  return { name, sections: { main: section(contents.main), sideboard: section(contents.sideboard), commander: section(contents.commander) } };
}

/** One past draft: the player's submitted deck (or whole pool), editable, with a Save to my decks. */
export function DraftHistoryDeckPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const draft = useQuery({ queryKey: ['drafts', 'history', roomId], queryFn: () => api<DraftHistoryDeck>(`/drafts/history/${roomId}`), enabled: !!roomId });
  const ids = useMemo(() => (draft.data ? [...draft.data.deck.main, ...draft.data.deck.sideboard].map((c) => c.printingId) : []), [draft.data]);
  const printings = useCards(ids);
  const resolved = ids.length > 0 && ids.every((id) => printings.has(id));
  const [deck, setDeck] = useState<EditableDeck | null>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    if (!draft.data || deck || !resolved) return;
    const title = draft.data.name ?? draft.data.format;
    setName(title);
    setDeck(fromContents(title, draft.data.deck, printings));
  }, [draft.data, deck, resolved, printings]);

  const save = useMutation({
    mutationFn: (d: EditableDeck) => api<DeckResponse>('/decks', { body: toDeckInput({ ...d, name }) }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['decks'] });
      navigate(`/decks/${res.deck.id}`);
    },
  });

  const d = draft.data;
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold">{d ? (d.name ?? d.format) : 'Past draft'}</h1>
          {d && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
              <span>{new Date(d.startedAt).toLocaleDateString()}</span>
              <Chip type="neutral">{d.format}</Chip>
              {d.types.map((t) => <Chip key={t} type="neutral">{DRAFT_TYPE_LABELS[t] ?? t}</Chip>)}
              <span>{d.players.map((p) => p.displayName).join(', ')}</span>
              <Link to={`/rooms/${d.roomId}`} className="text-accent hover:underline">Open room</Link>
            </p>
          )}
        </div>
        <Link to="/drafts/history" className="shrink-0 text-sm text-accent hover:underline">All drafts</Link>
      </header>
      <Card>
        <ErrorText error={draft.error ?? save.error} />
        {d && !d.submitted && <p className="mb-3 text-sm text-text-muted">You never submitted a deck for this draft, so your whole pool sits in the sideboard. Move cards to the main deck, then save.</p>}
        {d && ids.length === 0 && <p className="text-sm text-text-muted">You drafted no cards here.</p>}
        {draft.isPending || (d && ids.length > 0 && !deck) ? <p className="text-sm text-text-muted">Loading…</p> : null}
        {deck && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1"><Input label="Deck name" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <span className="text-sm text-text-muted">{countSection(deck.sections.main)} main · {countSection(deck.sections.sideboard)} sideboard</span>
              <Button onClick={() => save.mutate(deck)} disabled={save.isPending || name.trim().length === 0} title={name.trim() ? undefined : 'Give the deck a name first.'}>Save to my decks</Button>
            </div>
            <DeckEditor deck={deck} onChange={setDeck} />
          </div>
        )}
      </Card>
    </main>
  );
}
