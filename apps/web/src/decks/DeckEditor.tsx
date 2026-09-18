import type { CardPrinting } from '@mtg/shared';
import { useState } from 'react';
import { CardImage, imageFor } from '../cards/CardImage';
import { useCardPreview } from '../cards/CardPreview';
import { Button } from '../components';
import { countSection, moveCard, replacePrinting, SECTION_LABEL, SECTIONS, setQuantity, type EditableCard, type EditableDeck, type Section } from './model';
import { PrintingPicker } from './PrintingPicker';

export function DeckEditor({ deck, onChange }: { deck: EditableDeck; onChange: (d: EditableDeck) => void }) {
  const [picking, setPicking] = useState<{ section: Section; card: EditableCard } | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {SECTIONS.filter((s) => s === 'main' || deck.sections[s].length > 0).map((section) => (
        <section key={section}>
          <h3 className="mb-2 text-sm font-semibold text-text-muted">
            {SECTION_LABEL[section]} · {countSection(deck.sections[section])}
          </h3>
          {deck.sections[section].length === 0 && <p className="text-sm text-text-muted">Empty.</p>}
          <ul className="flex flex-col gap-1">
            {deck.sections[section].map((card) => (
              <Row
                key={card.printing.id}
                card={card}
                section={section}
                onQuantity={(q) => onChange(setQuantity(deck, section, card.printing.id, q))}
                onMove={(to) => onChange(moveCard(deck, section, to, card.printing.id))}
                onPickPrinting={() => setPicking({ section, card })}
              />
            ))}
          </ul>
        </section>
      ))}
      {picking && (
        <PrintingPicker
          card={picking.card.printing}
          onClose={() => setPicking(null)}
          onPick={(p: CardPrinting) => {
            onChange(replacePrinting(deck, picking.section, picking.card.printing.id, p));
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

function Row({ card, section, onQuantity, onMove, onPickPrinting }: {
  card: EditableCard;
  section: Section;
  onQuantity: (q: number) => void;
  onMove: (to: Section) => void;
  onPickPrinting: () => void;
}) {
  const preview = useCardPreview(imageFor(card.printing, 'normal'));
  const p = card.printing;
  return (
    <li className="flex items-center gap-3 rounded-md px-2 py-1 text-sm hover:bg-surface-raised" {...preview}>
      <span className="w-8 shrink-0"><CardImage card={p} /></span>
      <span className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" className="!px-2 !py-0.5" onClick={() => onQuantity(card.quantity - 1)} aria-label="one fewer">−</Button>
        <span className="w-6 text-center tabular-nums">{card.quantity}</span>
        <Button variant="ghost" className="!px-2 !py-0.5" onClick={() => onQuantity(card.quantity + 1)} aria-label="one more">+</Button>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{p.name}</span>
        <span className="block truncate text-text-muted">{p.typeLine}</span>
      </span>
      <button type="button" onClick={onPickPrinting} className="shrink-0 rounded px-2 py-0.5 text-xs text-text-muted hover:bg-surface hover:text-text" title="Change printing">
        <span className="uppercase">{p.setCode}</span> #{p.collectorNumber}
      </button>
      <select
        value={section}
        onChange={(e) => onMove(e.target.value as Section)}
        className="shrink-0 rounded border border-border bg-surface px-1 py-0.5 text-xs text-text-muted"
        aria-label="Section"
      >
        {SECTIONS.map((s) => <option key={s} value={s}>{SECTION_LABEL[s]}</option>)}
      </select>
      <Button variant="ghost" className="!px-2 !py-0.5 text-danger" onClick={() => onQuantity(0)} aria-label="remove">×</Button>
    </li>
  );
}
