import type { CardPrinting } from '@mtg/shared';
import { useState } from 'react';
import { CardImage, imageFor } from '../cards/CardImage';
import { useCardPreview } from '../cards/CardPreview';
import { Button } from '../components';
import { Chip } from '../components/Chip';
import { PrintingPicker } from '../decks/PrintingPicker';
import { countCubeCards, mergeCubeCards, sortForCube, type EditableCubeCard } from './model';

/** Flat cube list: quantity, printing (click the set badge to change), remove. Sorted cube-style. */
export function CubeEditor({ cards, onChange }: { cards: EditableCubeCard[]; onChange: (cards: EditableCubeCard[]) => void }) {
  const [picking, setPicking] = useState<EditableCubeCard | null>(null);
  const setQuantity = (id: string, quantity: number) => onChange(cards.map((c) => (c.printing.id === id ? { ...c, quantity } : c)).filter((c) => c.quantity > 0));
  const replace = (id: string, printing: CardPrinting) => onChange(mergeCubeCards(cards.map((c) => (c.printing.id === id ? { ...c, printing } : c))));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-text-muted">{countCubeCards(cards)} cards · {cards.length} distinct</p>
      <ul className="grid gap-1 sm:grid-cols-2">
        {sortForCube(cards).map((card) => (
          <Row key={card.printing.id} card={card} onQuantity={(q) => setQuantity(card.printing.id, q)} onPick={() => setPicking(card)} />
        ))}
      </ul>
      {picking && (
        <PrintingPicker
          card={picking.printing}
          onClose={() => setPicking(null)}
          onPick={(p) => {
            replace(picking.printing.id, p);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

function Row({ card, onQuantity, onPick }: { card: EditableCubeCard; onQuantity: (q: number) => void; onPick: () => void }) {
  const preview = useCardPreview(imageFor(card.printing, 'normal'));
  const p = card.printing;
  return (
    <li className="flex items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-raised" {...preview}>
      <span className="w-7 shrink-0"><CardImage card={p} /></span>
      <span className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" className="!px-1.5 !py-0.5" onClick={() => onQuantity(card.quantity - 1)} aria-label="one fewer">−</Button>
        <span className="w-5 text-center tabular-nums">{card.quantity}</span>
        <Button variant="ghost" className="!px-1.5 !py-0.5" onClick={() => onQuantity(card.quantity + 1)} aria-label="one more">+</Button>
      </span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{p.name}</span>
        <span className="ml-2 text-text-muted">{p.typeLine}</span>
      </span>
      <button type="button" onClick={onPick} title="Change printing"><Chip type="neutral" className="uppercase">{p.setCode} #{p.collectorNumber}</Chip></button>
      <Button variant="ghost" className="!px-1.5 !py-0.5 text-danger" onClick={() => onQuantity(0)} aria-label="remove">×</Button>
    </li>
  );
}
