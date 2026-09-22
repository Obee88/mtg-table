import type { DeckImportResponse, DeckResponse, DeckUrlImportResponse } from '@mtg/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Dialog, ErrorText, Input, Textarea } from '../components';
import { fromImport, toDeckInput } from '../decks/model';
import { api } from '../lib/api';

/**
 * Import a deck without leaving the lobby: paste a list or a Moxfield /
 * Archidekt link, name it, save. The full editor stays on the Decks page.
 */
export function QuickImportDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (deckId: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      let report: DeckImportResponse;
      let deckName = name.trim();
      if (url.trim()) {
        const fetched = await api<DeckUrlImportResponse>('/decks/import/url', { body: { url: url.trim() } });
        report = fetched;
        deckName ||= fetched.name;
      } else {
        report = await api<DeckImportResponse>('/decks/import', { body: { text } });
      }
      const deck = fromImport(deckName || 'Imported deck', report);
      const saved = await api<DeckResponse>('/decks', { body: toDeckInput(deck) });
      return { saved, skipped: report.unknown.length + report.errors.length };
    },
    onSuccess: ({ saved }) => {
      void qc.invalidateQueries({ queryKey: ['decks'] });
      onSaved(saved.deck.id);
    },
  });
  const canSave = !save.isPending && (url.trim().length > 0 || text.trim().length > 0);
  return (
    <Dialog title="Import a deck" onClose={onClose}>
      <form className="flex flex-col gap-4 text-sm" onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}>
        <Input label="Deck name" value={name} onChange={(e) => setName(e.target.value)} placeholder={url.trim() ? 'from the link' : 'Mono-red burn'} />
        <Input label="Moxfield / Archidekt link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://moxfield.com/decks/…" />
        <Textarea label="…or paste a decklist (one card per line; a 'Sideboard' line starts the sideboard)" rows={8} value={text} onChange={(e) => setText(e.target.value)} disabled={url.trim().length > 0} />
        <p className="text-xs text-text-muted">Lines that cannot be resolved are skipped; you can fix the deck later on the Decks page.</p>
        <ErrorText error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!canSave}>{save.isPending ? 'Importing…' : 'Import and use it'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
