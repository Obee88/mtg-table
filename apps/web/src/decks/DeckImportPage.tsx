import type { DeckImportResponse, DeckResponse, DeckUrlImportResponse } from '@mtg/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Card, ErrorText, Input, Textarea } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { useUnsavedDraft } from '../lib/useUnsavedDraft';
import { DeckEditor } from './DeckEditor';
import { countSection, fromImport, toDeckInput, type EditableDeck } from './model';

const SAMPLE = `4 Lightning Bolt
4 Monastery Swiftspear (BRO) 144

Sideboard
2 Rest in Peace`;

export function DeckImportPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [report, setReport] = useState<DeckImportResponse | null>(null);
  const [deck, setDeck] = useState<EditableDeck | null>(null);

  const resolve = useMutation({
    mutationFn: (text: string) => api<DeckImportResponse>('/decks/import', { body: { text } }),
    onSuccess: (res) => {
      setReport(res);
      setDeck(fromImport(name, res));
    },
  });

  const [url, setUrl] = useState('');
  const fromUrl = useMutation({
    mutationFn: (url: string) => api<DeckUrlImportResponse>('/decks/import/url', { body: { url } }),
    onSuccess: (res) => {
      setText(res.text);
      const deckName = name || res.name;
      if (!name) setName(res.name);
      setReport(res);
      setDeck(fromImport(deckName, res));
    },
  });

  // Nothing here is saved until "Save deck": keep the work in the browser and warn before leaving.
  const dirty = !!(name.trim() || text.trim() || deck);
  const draft = useUnsavedDraft<{ name: string; text: string; report: DeckImportResponse | null; deck: EditableDeck | null }>('deck-import', { name, text, report, deck }, dirty);
  const [restored, setRestored] = useState(false);
  useEffect(() => {
    const r = draft.restored;
    if (!r || dirty || !(r.name || r.text || r.deck)) return;
    setName(r.name);
    setText(r.text);
    setReport(r.report);
    setDeck(r.deck);
    setRestored(true);
  }, []);

  const save = useMutation({
    mutationFn: (d: EditableDeck) => api<DeckResponse>('/decks', { body: toDeckInput({ ...d, name }) }),
    onSuccess: (res) => {
      draft.clear();
      void qc.invalidateQueries({ queryKey: ['decks'] });
      navigate(`/decks/${res.deck.id}`);
    },
  });

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setText(await file.text());
    if (!name) setName(file.name.replace(/\.[^.]+$/, ''));
    e.target.value = '';
  };

  const problems = report ? report.errors.length + report.unknown.length : 0;
  const total = deck ? countSection(deck.sections.main) + countSection(deck.sections.sideboard) + countSection(deck.sections.commander) : 0;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="flex items-center gap-3 text-2xl font-semibold">Import deck{dirty && <Chip type="warning" title="Nothing is saved until you press Save deck. Your work is kept in this browser meanwhile.">unsaved</Chip>}</h1>
        <Link to="/decks" className="text-sm text-accent hover:underline">Decks</Link>
      </header>
      {restored && (
        <p className="rounded-md border border-border bg-surface-raised px-3 py-2 text-sm">
          Restored the decklist you were working on. <button type="button" className="text-accent hover:underline" onClick={() => { draft.clear(); setName(''); setText(''); setReport(null); setDeck(null); setRestored(false); }}>Discard it</button>
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        <Card title="Decklist">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              resolve.mutate(text);
            }}
          >
            <Input label="Deck name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mono-red burn" />
            <div className="flex items-end gap-2">
              <Input label="Or a public Moxfield / Archidekt deck link" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://moxfield.com/decks/… or https://archidekt.com/decks/…" />
              <Button type="button" variant="ghost" onClick={() => fromUrl.mutate(url)} disabled={fromUrl.isPending || url.trim().length === 0}>Fetch</Button>
            </div>
            <ErrorText error={fromUrl.error} />
            <Textarea label="Paste a decklist (Arena, Moxfield, MTGO, Cockatrice…)" rows={18} value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={resolve.isPending || text.trim().length === 0}>
                {resolve.isPending ? 'Resolving…' : 'Resolve cards'}
              </Button>
              <label className="cursor-pointer text-sm text-accent hover:underline">
                Upload .txt
                <input type="file" accept=".txt,.dec,.dek,.mwdeck,text/plain" className="hidden" onChange={onFile} />
              </label>
            </div>
            <ErrorText error={resolve.error} />
          </form>
        </Card>

        <Card title={deck ? `Cards · ${total}` : 'Cards'}>
          {!deck && <p className="text-sm text-text-muted">Resolve a decklist to review the cards, fix problems and choose printings.</p>}
          {report && <Problems report={report} />}
          {deck && (
            <div className="flex flex-col gap-4">
              <DeckEditor deck={deck} onChange={setDeck} />
              <div className="flex items-center gap-3 border-t border-border pt-4">
                <Button onClick={() => save.mutate(deck)} disabled={save.isPending || name.trim().length === 0 || total === 0}>
                  {save.isPending ? 'Saving…' : problems > 0 ? `Save without ${problems} unresolved line${problems === 1 ? '' : 's'}` : 'Save deck'}
                </Button>
                {name.trim().length === 0 && <span className="text-sm text-text-muted">Give the deck a name first.</span>}
              </div>
              <ErrorText error={save.error} />
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}

function Problems({ report }: { report: DeckImportResponse }) {
  if (report.errors.length + report.unknown.length + report.warnings.length === 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-2 text-sm">
      {report.errors.length > 0 && (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3">
          <p className="mb-1 font-medium text-danger">Could not read {report.errors.length} line{report.errors.length === 1 ? '' : 's'}</p>
          <ul className="text-text-muted">
            {report.errors.map((e) => <li key={e.line}>Line {e.line}: <code>{e.text}</code> — {e.message}</li>)}
          </ul>
        </div>
      )}
      {report.unknown.length > 0 && (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-3">
          <p className="mb-1 font-medium text-danger">Unknown card{report.unknown.length === 1 ? '' : 's'}</p>
          <ul className="text-text-muted">
            {report.unknown.map((u) => (
              <li key={u.line}>Line {u.line}: {u.quantity} <code>{u.name}</code>{u.set && ` (${u.set.toUpperCase()}${u.collectorNumber ? ` ${u.collectorNumber}` : ''})`}</li>
            ))}
          </ul>
          <p className="mt-1 text-text-muted">Fix the names in the list and resolve again, or save without them.</p>
        </div>
      )}
      {report.warnings.length > 0 && (
        <div className="rounded-md border border-accent/40 bg-accent/10 p-3">
          <p className="mb-1 font-medium text-accent">Printing not found — default used</p>
          <ul className="text-text-muted">
            {report.warnings.map((w) => <li key={w.line}>Line {w.line}: {w.message}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
