import type { CardPrinting, CardPrintingsResponse, CardSearchResponse } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { Card, ErrorText, Input } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { useDebounce } from '../lib/useDebounce';
import { CardImage, imageFor } from './CardImage';
import { useCardPreview } from './CardPreview';

export function CardsPage() {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CardPrinting | null>(null);
  const q = useDebounce(query.trim(), 200);

  const search = useQuery({
    queryKey: ['cards', 'search', q],
    queryFn: () => api<CardSearchResponse>(`/cards/search?q=${encodeURIComponent(q)}&limit=30`),
    enabled: q.length > 0,
    placeholderData: (prev) => prev,
  });

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cards</h1>
        <Link to="/" className="text-sm text-accent hover:underline">Home</Link>
      </header>

      <Input label="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="Lightning Bolt" />
      <ErrorText error={search.error} />

      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <Card title={q ? `Results for “${q}”` : 'Results'}>
          {!q && <p className="text-sm text-text-muted">Type a card name.</p>}
          {q && search.data?.results.length === 0 && <p className="text-sm text-text-muted">No cards found.</p>}
          <ul className="flex flex-col gap-1">
            {search.data?.results.map((card) => (
              <SearchRow key={card.id} card={card} active={selected?.oracleId === card.oracleId} onSelect={() => setSelected(card)} />
            ))}
          </ul>
        </Card>

        <Card title={selected ? `Printings of ${selected.name}` : 'Printings'}>
          {selected?.oracleId ? <Printings oracleId={selected.oracleId} /> : <p className="text-sm text-text-muted">Pick a card to see its printings.</p>}
        </Card>
      </div>
    </main>
  );
}

function SearchRow({ card, active, onSelect }: { card: CardPrinting; active: boolean; onSelect: () => void }) {
  const preview = useCardPreview(imageFor(card, 'normal'));
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        {...preview}
        className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-raised ${active ? 'bg-surface-raised' : ''}`}
      >
        <span className="w-8 shrink-0">
          <CardImage card={card} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{card.name}</span>
          <span className="block truncate text-text-muted">{card.typeLine}</span>
        </span>
        <span className="shrink-0 text-text-muted">{card.manaCost}</span>
      </button>
    </li>
  );
}

function Printings({ oracleId }: { oracleId: string }) {
  const printings = useQuery({
    queryKey: ['cards', 'printings', oracleId],
    queryFn: () => api<CardPrintingsResponse>(`/cards/oracle/${oracleId}/printings`),
  });
  if (printings.isPending) return <p className="text-sm text-text-muted">Loading…</p>;
  if (printings.isError) return <ErrorText error={printings.error} />;
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
      {printings.data.printings.map((p) => (
        <li key={p.id} className="flex flex-col gap-1 text-xs">
          <CardImage card={p} />
          <span className="truncate">
            <span className="uppercase text-text-muted">{p.setCode}</span> #{p.collectorNumber}
            {p.isPromo && <Chip type="warning" className="ml-1">promo</Chip>}
            {p.isDigital && <Chip type="neutral" className="ml-1">digital</Chip>}
          </span>
          <span className="truncate text-text-muted">{p.releasedAt.slice(0, 4)} · {p.lang}</span>
        </li>
      ))}
    </ul>
  );
}
