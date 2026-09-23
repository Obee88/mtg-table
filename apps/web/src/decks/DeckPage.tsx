import type { DeckResponse } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Card, ErrorText, Input } from '../components';
import { CopyButton } from '../components/CopyButton';
import { api } from '../lib/api';
import { DeckEditor } from './DeckEditor';
import { TaplandsPanel } from './TaplandsPanel';
import { countSection, fromDeckResponse, toDeckInput, toText, type EditableDeck } from './model';

export function DeckPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['decks', id], queryFn: () => api<DeckResponse>(`/decks/${id}`) });
  const [deck, setDeck] = useState<EditableDeck | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (query.data) {
      setDeck(fromDeckResponse(query.data));
      setDirty(false);
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: (d: EditableDeck) => api<DeckResponse>(`/decks/${id}`, { method: 'PUT', body: toDeckInput(d) }),
    onSuccess: (res) => {
      qc.setQueryData(['decks', id], res);
      void qc.invalidateQueries({ queryKey: ['decks'], exact: true });
    },
  });
  const remove = useMutation({
    mutationFn: () => api<void>(`/decks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['decks'], exact: true });
      navigate('/decks');
    },
  });

  const change = (d: EditableDeck) => {
    setDeck(d);
    setDirty(true);
  };

  if (query.isPending) return <main className="p-6 text-text-muted">Loading…</main>;
  if (query.isError || !deck) return <main className="p-6"><ErrorText error={query.error ?? 'Deck not found'} /></main>;

  const total = countSection(deck.sections.main) + countSection(deck.sections.sideboard) + countSection(deck.sections.commander);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="truncate text-2xl font-semibold">{deck.name || 'Untitled deck'}</h1>
        <Link to="/decks" className="shrink-0 text-sm text-accent hover:underline">Decks</Link>
      </header>

      <Card>
        <div className="flex flex-col gap-4">
          <Input label="Deck name" value={deck.name} onChange={(e) => change({ ...deck, name: e.target.value })} />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => save.mutate(deck)} disabled={!dirty || save.isPending || deck.name.trim().length === 0 || total === 0}>
              {save.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </Button>
            <CopyButton text={() => toText(deck)} title="Copy the decklist to the clipboard">Copy as text</CopyButton>
            <Button variant="ghost" className="text-danger" onClick={() => confirm(`Delete “${deck.name}”?`) && remove.mutate()} disabled={remove.isPending}>
              Delete deck
            </Button>
            <span className="text-sm text-text-muted">{total} cards</span>
          </div>
          <ErrorText error={save.error ?? remove.error} />
        </div>
      </Card>

      <Card>
        <DeckEditor deck={deck} onChange={change} />
      </Card>
      <TaplandsPanel printings={[...deck.sections.main, ...deck.sections.sideboard, ...deck.sections.commander].map((c) => c.printing)} />
    </main>
  );
}
