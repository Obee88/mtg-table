import type { CubeResponse, DeckImportResponse } from '@mtg/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Card, ErrorText, Input, Textarea } from '../components';
import { api } from '../lib/api';
import { CubeEditor } from './CubeEditor';
import { countCubeCards, fromImport, toCubeCards, type EditableCubeCard } from './model';

/** Paste a list (one card per line, quantities optional), review, save as version 1. */
export function CubeImportPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [report, setReport] = useState<DeckImportResponse | null>(null);
  const [cards, setCards] = useState<EditableCubeCard[] | null>(null);

  const resolve = useMutation({
    mutationFn: (text: string) => api<DeckImportResponse>('/decks/import', { body: { text } }),
    onSuccess: (res) => {
      setReport(res);
      setCards(fromImport(res));
    },
  });
  const save = useMutation({
    mutationFn: (list: EditableCubeCard[]) => api<CubeResponse>('/cubes', { body: { name: name.trim(), cards: toCubeCards(list) } }),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['cubes'] });
      navigate(`/cubes/${res.cube.id}`);
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

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">New cube</h1>
        <Link to="/cubes" className="text-sm text-accent hover:underline">Cubes</Link>
      </header>
      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        <Card title="Card list">
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); resolve.mutate(text); }}>
            <Input label="Cube name" value={name} onChange={(e) => setName(e.target.value)} placeholder="House cube" />
            <Textarea label="Paste the list (one card per line; “(SET) 123” picks a printing; default is the oldest printing)" rows={18} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Lightning Bolt\nCounterspell (LEA)\nSol Ring (C21) 263'} />
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={resolve.isPending || text.trim().length === 0}>{resolve.isPending ? 'Resolving…' : 'Resolve cards'}</Button>
              <label className="cursor-pointer text-sm text-accent hover:underline">Upload .txt<input type="file" accept=".txt,text/plain" className="hidden" onChange={onFile} /></label>
            </div>
            <ErrorText error={resolve.error} />
          </form>
        </Card>
        <Card title={cards ? `Cards · ${countCubeCards(cards)}` : 'Cards'}>
          {!cards && <p className="text-sm text-text-muted">Resolve a list to review it, fix printings, then save.</p>}
          {report && (report.unknown.length > 0 || report.errors.length > 0 || report.warnings.length > 0) && (
            <div className="mb-4 flex flex-col gap-2 text-sm">
              {report.unknown.length > 0 && <div className="rounded-md border border-danger/40 bg-danger/10 p-3"><p className="mb-1 font-medium text-danger">Unknown cards</p><ul className="text-text-muted">{report.unknown.map((u) => <li key={u.line}>Line {u.line}: <code>{u.name}</code></li>)}</ul></div>}
              {report.errors.length > 0 && <div className="rounded-md border border-danger/40 bg-danger/10 p-3"><p className="mb-1 font-medium text-danger">Unreadable lines</p><ul className="text-text-muted">{report.errors.map((e) => <li key={e.line}>Line {e.line}: <code>{e.text}</code> — {e.message}</li>)}</ul></div>}
              {report.warnings.length > 0 && <div className="rounded-md border border-accent/40 bg-accent/10 p-3"><p className="mb-1 font-medium text-accent">Printing not found — default used</p><ul className="text-text-muted">{report.warnings.map((w) => <li key={w.line}>Line {w.line}: {w.message}</li>)}</ul></div>}
            </div>
          )}
          {cards && (
            <div className="flex flex-col gap-4">
              <CubeEditor cards={cards} onChange={setCards} />
              <div className="flex items-center gap-3 border-t border-border pt-4">
                <Button onClick={() => save.mutate(cards)} disabled={save.isPending || name.trim().length === 0 || cards.length === 0}>
                  {save.isPending ? 'Saving…' : problems > 0 ? `Save without ${problems} unresolved line${problems === 1 ? '' : 's'}` : 'Save cube'}
                </Button>
                {name.trim().length === 0 && <span className="text-sm text-text-muted">Give the cube a name first.</span>}
              </div>
              <ErrorText error={save.error} />
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
