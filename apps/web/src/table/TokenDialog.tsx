import type { CardPrinting, CardSearchResponse, TokenSuggestion } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CardImage } from '../cards/CardImage';
import { Button, Dialog, Input } from '../components';
import { api } from '../lib/api';
import { useDebounce } from '../lib/useDebounce';

export function TokenDialog({ onCreate, onClose, deckId }: { onCreate: (token: { printingId: string | null; customName: string | null; count: number }) => void; onClose: () => void; deckId?: string | null }) {
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState('');
  const [count, setCount] = useState(1);
  const q = useDebounce(query.trim(), 200);
  // Tokens this player has made before — with this deck first — so the usual ones are one click away.
  const recent = useQuery({
    queryKey: ['cards', 'tokens', 'recent', deckId ?? null],
    queryFn: () => api<{ tokens: TokenSuggestion[] }>(`/cards/tokens/recent${deckId ? `?deckId=${deckId}` : ''}`),
    staleTime: 60_000,
  });
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
        {(recent.data?.tokens.length ?? 0) > 0 && (
          <div>
            <p className="mb-2 text-sm text-text-muted">Used before{deckId ? ' (this deck first)' : ''}</p>
            <ul className="flex flex-wrap gap-2">
              {recent.data!.tokens.map((t) => (
                <li key={t.printing?.id ?? `name:${t.customName}`}>
                  <button
                    type="button"
                    onClick={() => onCreate({ printingId: t.printing?.id ?? null, customName: t.printing ? null : t.customName, count })}
                    className={`flex w-24 flex-col rounded-md p-1 text-left text-xs hover:bg-surface-raised ${t.thisDeck ? 'ring-1 ring-accent/60' : ''}`}
                    title={`${t.printing?.name ?? t.customName ?? 'token'} · made ${t.uses}×`}
                  >
                    {t.printing ? <CardImage card={t.printing} /> : <span className="flex aspect-[5/7] items-center justify-center rounded-[4.5%] bg-surface-raised p-1 text-center">{t.customName}</span>}
                    <span className="mt-1 block truncate">{t.printing?.name ?? t.customName}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
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
