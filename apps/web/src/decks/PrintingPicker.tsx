import type { CardPrinting, CardPrintingsResponse } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { CardImage } from '../cards/CardImage';
import { Button, Dialog, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { defaultPrinting, orderPrintings } from './printings';

export function PrintingPicker({ card, onPick, onClose }: { card: CardPrinting; onPick: (p: CardPrinting) => void; onClose: () => void }) {
  const printings = useQuery({
    queryKey: ['cards', 'printings', card.oracleId],
    queryFn: () => api<CardPrintingsResponse>(`/cards/oracle/${card.oracleId}/printings`),
    enabled: card.oracleId !== null,
  });
  const ordered = useMemo(() => orderPrintings(printings.data?.printings ?? []), [printings.data]);
  const fallback = useMemo(() => defaultPrinting(ordered), [ordered]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Dialog title={`Printings of ${card.name}`} onClose={onClose}>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-text-muted">
        <span>Oldest first. Current: <span className="uppercase text-text">{card.setCode}</span> #{card.collectorNumber}</span>
        {fallback && fallback.id !== card.id && (
          <Button variant="ghost" className="!py-1 text-xs" onClick={() => onPick(fallback)}>
            Use default ({fallback.setCode.toUpperCase()} · {fallback.releasedAt.slice(0, 4)})
          </Button>
        )}
      </div>
      {printings.isPending && <p className="text-sm text-text-muted">Loading…</p>}
      <ErrorText error={printings.error} />
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {ordered.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              autoFocus={p.id === (fallback?.id ?? card.id)}
              className={`flex w-full flex-col gap-1 rounded-md p-1 text-left text-xs hover:bg-surface-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40 ${p.id === card.id ? 'ring-2 ring-accent' : ''}`}
            >
              <CardImage card={p} className="w-full" />
              <span className="flex flex-wrap items-center gap-1">
                <span className="uppercase text-text-muted">{p.setCode}</span>
                <span>#{p.collectorNumber}</span>
                <span className="text-text-muted">{p.releasedAt.slice(0, 4)}</span>
                {p.id === fallback?.id && <Chip type="primary">default</Chip>}
                {p.id === card.id && <Chip type="success">current</Chip>}
                {p.isPromo && <Chip type="warning">promo</Chip>}
                {p.isDigital && <Chip type="neutral">digital</Chip>}
                {p.lang !== 'en' && <Chip type="neutral">{p.lang}</Chip>}
              </span>
              <span className="truncate text-text-muted">{p.setName}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
