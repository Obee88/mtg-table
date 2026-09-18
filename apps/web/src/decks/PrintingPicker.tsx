import type { CardPrinting, CardPrintingsResponse } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { CardImage } from '../cards/CardImage';
import { Dialog, ErrorText } from '../components';
import { api } from '../lib/api';

export function PrintingPicker({ card, onPick, onClose }: { card: CardPrinting; onPick: (p: CardPrinting) => void; onClose: () => void }) {
  const printings = useQuery({
    queryKey: ['cards', 'printings', card.oracleId],
    queryFn: () => api<CardPrintingsResponse>(`/cards/oracle/${card.oracleId}/printings`),
    enabled: card.oracleId !== null,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Dialog title={`Printings of ${card.name}`} onClose={onClose}>
      {printings.isPending && <p className="text-sm text-text-muted">Loading…</p>}
      <ErrorText error={printings.error} />
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {printings.data?.printings.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p)}
              className={`flex w-full flex-col gap-1 rounded-md p-1 text-left text-xs hover:bg-surface-raised ${p.id === card.id ? 'ring-2 ring-accent' : ''}`}
            >
              <CardImage card={p} className="w-full" />
              <span className="truncate">
                <span className="uppercase text-text-muted">{p.setCode}</span> #{p.collectorNumber}
                {p.isPromo && <span className="ml-1 text-accent">promo</span>}
              </span>
              <span className="truncate text-text-muted">{p.setName}</span>
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
