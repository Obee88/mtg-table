import type { CardPrinting, CubeResponse, DeckImportResponse } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Button, Card, ErrorText, Input, Textarea } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { CubeEditor } from './CubeEditor';
import { VersionDiff } from './VersionDiff';
import { countCubeCards, cubeToText, fromCubeResponse, fromImport, mergeCubeCards, toCubeCards, type EditableCubeCard } from './model';

/** View a cube version, edit the list (printings, quantities, add by paste) and save it as a new version. */
export function CubePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const versionParam = params.get('version');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['cubes', id, versionParam], queryFn: () => api<CubeResponse>(`/cubes/${id}${versionParam ? `?version=${versionParam}` : ''}`) });
  const [cards, setCards] = useState<EditableCubeCard[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState('');
  const [addText, setAddText] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    if (query.data) {
      setCards(fromCubeResponse(query.data));
      setName(query.data.cube.name);
      setDirty(false);
    }
  }, [query.data]);

  const saveVersion = useMutation({
    mutationFn: (list: EditableCubeCard[]) => api<CubeResponse>(`/cubes/${id}/versions`, { body: { cards: toCubeCards(list), note: note.trim() || undefined } }),
    onSuccess: () => {
      setNote('');
      void qc.invalidateQueries({ queryKey: ['cubes'] });
      setParams({});
    },
  });
  const rename = useMutation({
    mutationFn: (name: string) => api<CubeResponse>(`/cubes/${id}`, { method: 'PUT', body: { name } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cubes'] }),
  });
  const remove = useMutation({
    mutationFn: () => api<void>(`/cubes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cubes'] });
      navigate('/cubes');
    },
  });
  const oldestAll = useMutation({
    mutationFn: async (list: EditableCubeCard[]) => {
      const oracleIds = [...new Set(list.map((c) => c.printing.oracleId).filter((x): x is string => !!x))];
      return api<{ printings: Record<string, CardPrinting> }>('/cards/default-printings', { body: { oracleIds } });
    },
    onSuccess: (res) => {
      setCards((prev) => mergeCubeCards((prev ?? []).map((c) => (c.printing.oracleId && res.printings[c.printing.oracleId] ? { ...c, printing: res.printings[c.printing.oracleId]! } : c))));
      setDirty(true);
    },
  });
  const restore = useMutation({
    mutationFn: (version: number) => api<CubeResponse>(`/cubes/${id}/restore`, { body: { version } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cubes'] });
      setParams({});
    },
  });
  const addCards = useMutation({
    mutationFn: (text: string) => api<DeckImportResponse>('/decks/import', { body: { text } }),
    onSuccess: (res) => {
      setCards((prev) => mergeCubeCards([...(prev ?? []), ...fromImport(res)]));
      setDirty(true);
      setAddText('');
    },
  });

  if (query.isPending) return <main className="p-6 text-text-muted">Loading…</main>;
  if (query.isError || !cards) return <main className="p-6"><ErrorText error={query.error ?? 'Cube not found'} /></main>;
  const { cube, version, versions } = query.data;
  const viewingOld = version.number !== versions[0]?.number;

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="truncate text-2xl font-semibold">{cube.name}</h1>
        <Link to="/cubes" className="shrink-0 text-sm text-accent hover:underline">Cubes</Link>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <div className="flex flex-col gap-6">
          <Card title="Cube">
            <div className="flex flex-col gap-3">
              <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== cube.name && rename.mutate(name.trim())} />
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => navigator.clipboard.writeText(cubeToText(cards))}>Copy as text</Button>
                <Button variant="ghost" onClick={() => oldestAll.mutate(cards)} disabled={oldestAll.isPending} title="Reset every card to its oldest English paper printing">Use oldest printings</Button>
                <Button variant="ghost" className="text-danger" onClick={() => confirm(`Delete “${cube.name}” and all versions?`) && remove.mutate()}>Delete cube</Button>
              </div>
              <ErrorText error={rename.error ?? remove.error ?? oldestAll.error} />
            </div>
          </Card>

          <Card title="Versions">
            <ul className="flex flex-col gap-1 text-sm">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center gap-1">
                  <button type="button" onClick={() => setParams(v.number === versions[0]?.number ? {} : { version: String(v.number) })} className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-surface-raised ${v.number === version.number ? 'bg-surface-raised' : ''}`}>
                    <Chip type={v.number === versions[0]?.number ? 'primary' : 'neutral'}>v{v.number}</Chip>
                    <span className="min-w-0 flex-1 truncate">{v.note ?? <span className="text-text-muted">no note</span>}</span>
                    <span className="shrink-0 text-xs text-text-muted">{v.cardCount} · {v.createdByName} · {new Date(v.createdAt).toLocaleDateString()}</span>
                  </button>
                  {v.number !== versions[0]?.number && (
                    <Button variant="ghost" className="!px-2 !py-0.5 text-xs" disabled={restore.isPending} onClick={() => confirm(`Restore v${v.number} as a new version?`) && restore.mutate(v.number)} title="Create a new version with this list">Restore</Button>
                  )}
                </li>
              ))}
            </ul>
            <ErrorText error={restore.error} />
          </Card>

          <Card title="Compare versions">
            <VersionDiff cubeId={cube.id} versions={versions} />
          </Card>

          <Card title="Add cards">
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); addCards.mutate(addText); }}>
              <Textarea label="Paste cards to add (one per line)" rows={5} value={addText} onChange={(e) => setAddText(e.target.value)} />
              <div><Button type="submit" variant="ghost" disabled={addCards.isPending || addText.trim().length === 0}>Add to list</Button></div>
              <ErrorText error={addCards.error} />
            </form>
          </Card>
        </div>

        <Card title={`${viewingOld ? `Version ${version.number} (read-only view)` : `Current list · v${version.number}`} · ${countCubeCards(cards)} cards`}>
          {viewingOld && <p className="mb-3 text-sm text-text-muted">You are viewing an older version. Saving from here creates a new version with this list (a restore).</p>}
          <div className="flex flex-col gap-4">
            <CubeEditor cards={cards} onChange={(c) => { setCards(c); setDirty(true); }} />
            <div className="flex flex-wrap items-end gap-3 border-t border-border pt-4">
              <Input label="Version note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="cut the blue counterspells, added 5 lands" />
              <Button onClick={() => saveVersion.mutate(cards)} disabled={saveVersion.isPending || (!dirty && !viewingOld) || cards.length === 0}>
                {saveVersion.isPending ? 'Saving…' : `Save as v${(versions[0]?.number ?? 0) + 1}`}
              </Button>
            </div>
            <ErrorText error={saveVersion.error} />
          </div>
        </Card>
      </div>
    </main>
  );
}
