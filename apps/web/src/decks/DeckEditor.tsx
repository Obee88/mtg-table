import type { CardPrinting, DeckImportResponse } from '@mtg/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { CardImage, imageFor } from '../cards/CardImage';
import { useCardPreview } from '../cards/CardPreview';
import { Button, ErrorText } from '../components';
import { api } from '../lib/api';
import { addCards, countSection, importedCards, moveCard, replacePrinting, SECTION_LABEL, SECTIONS, setQuantity, type EditableCard, type EditableDeck, type Section } from './model';
import { PrintingPicker } from './PrintingPicker';

export function DeckEditor({ deck, onChange }: { deck: EditableDeck; onChange: (d: EditableDeck) => void }) {
  const [picking, setPicking] = useState<{ section: Section; card: EditableCard } | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {/* Main and sideboard always show, so it is clear where a card can go; commander only when used. */}
      {SECTIONS.filter((s) => s !== 'commander' || deck.sections[s].length > 0).map((section) => (
        <section key={section}>
          <h3 className="mb-2 text-sm font-semibold text-text-muted">
            {SECTION_LABEL[section]} · {countSection(deck.sections[section])}
          </h3>
          {deck.sections[section].length === 0 && <p className="text-sm text-text-muted">{section === 'sideboard' ? 'Empty — paste cards below or move them here with the section dropdown.' : 'Empty.'}</p>}
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
      <AddCards deck={deck} onChange={onChange} />
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

/** Paste more cards into any section — the way to build a sideboard after the first import. */
function AddCards({ deck, onChange }: { deck: EditableDeck; onChange: (d: EditableDeck) => void }) {
  const [section, setSection] = useState<Section>('sideboard');
  const [text, setText] = useState('');
  const add = useMutation({
    mutationFn: (text: string) => api<DeckImportResponse>('/decks/import', { body: { text } }),
    onSuccess: (res) => {
      onChange(addCards(deck, section, importedCards(res)));
      setText('');
    },
  });
  const problems = add.data ? add.data.errors.length + add.data.unknown.length : 0;

  return (
    <form
      className="flex flex-col gap-2 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate(text);
      }}
    >
      <label className="text-sm">
        <span className="mb-1 block text-text-muted">Add cards (one per line)</span>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'2 Rest in Peace\n1 Pithing Needle (C21) 263'}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm text-text outline-none focus:border-accent"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-text-muted">into</span>
          <select className="rounded-md border border-border bg-surface px-2 py-1.5 text-text" value={section} onChange={(e) => setSection(e.target.value as Section)}>
            {SECTIONS.map((s) => <option key={s} value={s}>{SECTION_LABEL[s]}</option>)}
          </select>
        </label>
        <Button type="submit" variant="ghost" disabled={add.isPending || text.trim().length === 0}>{add.isPending ? 'Resolving…' : 'Add'}</Button>
        {problems > 0 && <span className="text-text-muted">{problems} line{problems === 1 ? '' : 's'} could not be resolved and were skipped.</span>}
      </div>
      <ErrorText error={add.error} />
    </form>
  );
}
