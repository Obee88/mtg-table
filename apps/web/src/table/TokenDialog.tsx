import type { CardPrinting, CardSearchResponse } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CardImage } from '../cards/CardImage';
import { Button, Dialog, Input } from '../components';
import { api } from '../lib/api';
import { useDebounce } from '../lib/useDebounce';

export function TokenDialog({ onCreate, onClose }: { onCreate: (token: { printingId: string | null; customName: string | null; count: number }) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const [count, setCount] = useState(1);
  const q = useDebounce(query.trim(), 200);
  const search = useQuery({
    queryKey: ['cards', 'tokens', q],
    queryFn: () => api<CardSearchResponse>(`/cards/search?q=${encodeURIComponent(q)}&limit=24&kind=tokens`),
    enabled: q.length > 0,
    placeholderData: (prev) => prev,
  });

  return (
    <Dialog title="Create token" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Search tokens" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus placeholder="Soldier, Treasure, Zombie…" />
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">Count</span>
            <input type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="w-20 rounded-md border border-border bg-surface px-3 py-2 text-text" />
          </label>
        </div>
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {search.data?.results.map((p: CardPrinting) => (
            <li key={p.id}>
              <button type="button" onClick={() => onCreate({ printingId: p.id, customName: null, count })} className="w-full rounded-md p-1 text-left text-xs hover:bg-surface-raised">
                <CardImage card={p} />
                <span className="mt-1 block truncate">{p.name}</span>
                <span className="block truncate text-text-muted">{p.typeLine}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-end gap-3 border-t border-border pt-4">
          <Input label="…or a custom token (e.g. “Zombie 2/2”)" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button onClick={() => onCreate({ printingId: null, customName: custom.trim(), count })} disabled={custom.trim().length === 0}>Create</Button>
        </div>
      </div>
    </Dialog>
  );
}
