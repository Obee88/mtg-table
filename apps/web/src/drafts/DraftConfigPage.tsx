import type { CubeResponse, CubeSummary, DraftConfig, DraftConfigResponse, DraftPhaseConfig, PickAndPassConfig } from '@mtg/shared';
import { cardsNeeded, cardsPerDrafter, cardsPerDrafterIn, draftConfigProblems, emptyGridPhase, emptyPhase, emptyRotisseriePhase, emptyWinchesterPhase, emptyWinstonPhase, houseRulesPreset } from '@mtg/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, Card, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';

const select = 'rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text';
const number = `${select} w-20`;

/** Create or edit a saved draft format: seats, first pass direction and pick-and-pass phases drawing from cube versions. */
export function DraftConfigPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ['draft-configs', id], queryFn: () => api<DraftConfigResponse>(`/draft-configs/${id}`), enabled: !!id });
  const cubes = useQuery({ queryKey: ['cubes'], queryFn: () => api<CubeSummary[]>('/cubes') });
  const [config, setConfig] = useState<DraftConfig>(() => ({ name: 'New format', seats: 4, startDirection: 'right', phases: [emptyPhase()] }));
  /** Cube chosen per phase (the config itself only stores the version). */
  const [phaseCubes, setPhaseCubes] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!existing.data || loaded) return;
    setConfig(existing.data.config);
    setPhaseCubes(existing.data.config.phases.map((p) => existing.data.pools.find((x) => x.versionId === p.poolCubeVersionId)?.cubeId ?? ''));
    setLoaded(true);
  }, [existing.data, loaded]);

  const save = useMutation({
    mutationFn: (c: DraftConfig) => (id ? api<DraftConfigResponse>(`/draft-configs/${id}`, { method: 'PUT', body: { name: c.name, config: c } }) : api<DraftConfigResponse>('/draft-configs', { body: { name: c.name, config: c } })),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['draft-configs'] });
      if (!id) navigate(`/drafts/${r.id}`, { replace: true });
    },
  });

  // Versions of every cube in use, so each phase can pick one and show its size.
  const cubeIds = [...new Set(phaseCubes.filter(Boolean))];
  const versions = useQueries({ queries: cubeIds.map((cubeId) => ({ queryKey: ['cubes', cubeId], queryFn: () => api<CubeResponse>(`/cubes/${cubeId}`) })) });
  const versionsByCube = new Map(cubeIds.map((cubeId, i) => [cubeId, versions[i]?.data?.versions ?? []]));
  const poolSizes: Record<string, number> = {};
  for (const p of existing.data?.pools ?? []) poolSizes[p.versionId] = p.cardCount;
  for (const list of versionsByCube.values()) for (const v of list) poolSizes[v.id] = v.cardCount;
  const problems = draftConfigProblems(config, poolSizes);

  const set = (patch: Partial<DraftConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const setPhase = (i: number, patch: Partial<PickAndPassConfig> | Partial<Extract<DraftPhaseConfig, { type: 'winston' | 'winchester' }>> | Partial<Extract<DraftPhaseConfig, { type: 'grid' }>> | Partial<Extract<DraftPhaseConfig, { type: 'rotisserie' }>>) =>
    setConfig((c) => ({ ...c, phases: c.phases.map((p, j) => (j === i ? ({ ...p, ...patch } as DraftPhaseConfig) : p)) }));
  const setPhases = (phases: DraftPhaseConfig[], cubesFor: string[]) => {
    setConfig((c) => ({ ...c, phases }));
    setPhaseCubes(cubesFor);
  };
  // A phase whose cube is chosen but whose version is still blank takes the latest version once it is known.
  useEffect(() => {
    config.phases.forEach((p, i) => {
      const latest = versionsByCube.get(phaseCubes[i] ?? '')?.[0];
      if (!p.poolCubeVersionId && latest) setPhase(i, { poolCubeVersionId: latest.id });
    });
  });

  const movePhase = (i: number, d: -1 | 1) => {
    const phases = [...config.phases];
    const cubesFor = [...phaseCubes];
    const [p] = phases.splice(i, 1);
    const [c] = cubesFor.splice(i, 1);
    phases.splice(i + d, 0, p!);
    cubesFor.splice(i + d, 0, c ?? '');
    setPhases(phases, cubesFor);
  };
  const applyHouse = () => {
    const house = houseRulesPreset({ triColour: '', main: '' }, config.name);
    const first = cubes.data?.[0]?.id ?? '';
    setConfig({ ...house, phases: house.phases });
    setPhaseCubes([first, first]);
  };

  if (id && existing.isPending) return <main className="p-6 text-text-muted">Loading…</main>;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-3">
        <input className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent text-2xl font-semibold hover:border-border focus:border-border" value={config.name} onChange={(e) => set({ name: e.target.value })} aria-label="format name" />
        <Link to="/drafts" className="text-sm text-accent hover:underline">Formats</Link>
      </header>

      <Card title="Table">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label>
            <span className="mb-1 block text-text-muted">Players</span>
            <select className={select} value={config.seats} onChange={(e) => set({ seats: Number(e.target.value) as 2 | 4 })}>
              <option value={2}>2</option>
              <option value={4}>4</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-text-muted">First pass</span>
            <select className={select} value={config.startDirection} onChange={(e) => set({ startDirection: e.target.value as 'left' | 'right' })}>
              <option value="right">right</option>
              <option value="left">left</option>
            </select>
          </label>
          <span className="ml-auto flex items-center gap-2 pb-1">
            <Chip type="neutral">{cardsPerDrafter(config)} cards per drafter</Chip>
            <Button variant="ghost" onClick={applyHouse} title="A tri-colour pack of 5, then three rounds of 15 from the main cube; passing direction flips every round">House rules preset</Button>
          </span>
        </div>
        {cubes.data?.length === 0 && <p className="mt-2 text-sm text-text-muted">You need a cube first: <Link to="/cubes/new" className="text-accent hover:underline">create one</Link>.</p>}
      </Card>

      {config.phases.map((phase, i) => {
        const cubeId = phaseCubes[i] ?? '';
        const list = versionsByCube.get(cubeId) ?? [];
        const size = poolSizes[phase.poolCubeVersionId];
        return (
          <Card key={i} title={`Phase ${i + 1} · ${{ winston: 'Winston', grid: 'Grid', winchester: 'Winchester', rotisserie: 'Rotisserie', pickAndPass: 'pick and pass' }[phase.type]}`}>
            <div className="flex flex-wrap items-end gap-3 text-sm">
              <label>
                <span className="mb-1 block text-text-muted">Type</span>
                <select
                  className={select}
                  value={phase.type}
                  onChange={(e) => {
                    const blank = { winston: emptyWinstonPhase, grid: emptyGridPhase, winchester: emptyWinchesterPhase, rotisserie: emptyRotisseriePhase }[e.target.value] ?? emptyPhase;
                    const next = blank(phase.poolCubeVersionId);
                    setConfig((c) => ({ ...c, phases: c.phases.map((p, j) => (j === i ? { ...next, name: ['Pack draft', 'Winston', 'Grid', 'Winchester', 'Rotisserie'].includes(p.name) ? next.name : p.name } : p)) }));
                  }}
                >
                  <option value="pickAndPass">pick and pass</option>
                  <option value="winston">Winston</option>
                  <option value="grid">Grid</option>
                  <option value="winchester">Winchester</option>
                  <option value="rotisserie">Rotisserie</option>
                </select>
              </label>
              <label>
                <span className="mb-1 block text-text-muted">Name</span>
                <input className={`${select} w-36`} value={phase.name} onChange={(e) => setPhase(i, { name: e.target.value })} />
              </label>
              <label>
                <span className="mb-1 block text-text-muted">Cube</span>
                <select
                  className={select}
                  value={cubeId}
                  onChange={(e) => {
                    setPhaseCubes((pc) => config.phases.map((_, j) => (j === i ? e.target.value : (pc[j] ?? ''))));
                    setPhase(i, { poolCubeVersionId: '' });
                  }}
                >
                  <option value="">— choose —</option>
                  {cubes.data?.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.cardCount})</option>)}
                </select>
              </label>
              {cubeId && (
                <label>
                  <span className="mb-1 block text-text-muted">Version</span>
                  <select className={select} value={phase.poolCubeVersionId} onChange={(e) => setPhase(i, { poolCubeVersionId: e.target.value })}>
                    {list.length === 0 && <option value={phase.poolCubeVersionId}>loading…</option>}
                    {list.map((v) => <option key={v.id} value={v.id}>v{v.number} · {v.cardCount} cards{v.note ? ` · ${v.note}` : ''}</option>)}
                  </select>
                </label>
              )}
              {phase.type === 'pickAndPass' ? (
                <>
                  <label>
                    <span className="mb-1 block text-text-muted">Pack size</span>
                    <input type="number" min={1} max={30} className={number} value={phase.packSize} onChange={(e) => setPhase(i, { packSize: clamp(e.target.value, 1, 30) })} />
                  </label>
                  <label>
                    <span className="mb-1 block text-text-muted">Packs each</span>
                    <input type="number" min={1} max={4} className={number} value={phase.packsPerPlayer} onChange={(e) => setPhase(i, { packsPerPlayer: clamp(e.target.value, 1, 4) })} />
                  </label>
                  <label>
                    <span className="mb-1 block text-text-muted">Rounds</span>
                    <input type="number" min={1} max={10} className={number} value={phase.rounds} onChange={(e) => setPhase(i, { rounds: clamp(e.target.value, 1, 10) })} />
                  </label>
                  <label>
                    <span className="mb-1 block text-text-muted">Passing</span>
                    <select className={select} value={phase.direction} onChange={(e) => setPhase(i, { direction: e.target.value as PickAndPassConfig['direction'] })}>
                      <option value="alternate">alternate every round</option>
                      <option value="left">always left</option>
                      <option value="right">always right</option>
                    </select>
                  </label>
                </>
              ) : phase.type === 'rotisserie' ? (
                <>
                  <label>
                    <span className="mb-1 block text-text-muted">Cards on the table</span>
                    <input type="number" min={2} max={1000} className={number} value={phase.poolSize} onChange={(e) => setPhase(i, { poolSize: clamp(e.target.value, 2, 1000) })} />
                  </label>
                  <label>
                    <span className="mb-1 block text-text-muted">Picks each</span>
                    <input type="number" min={1} max={200} className={number} value={phase.picksPerPlayer} onChange={(e) => setPhase(i, { picksPerPlayer: clamp(e.target.value, 1, 200) })} />
                  </label>
                </>
              ) : phase.type === 'grid' ? (
                <>
                  <label>
                    <span className="mb-1 block text-text-muted">Grids</span>
                    <input type="number" min={1} max={60} className={number} value={phase.grids} onChange={(e) => setPhase(i, { grids: clamp(e.target.value, 1, 60) })} />
                  </label>
                  <label>
                    <span className="mb-1 block text-text-muted">Size</span>
                    <select className={select} value={phase.size} onChange={(e) => setPhase(i, { size: Number(e.target.value) })}>
                      {[2, 3, 4].map((n) => <option key={n} value={n}>{n}×{n}</option>)}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  <label>
                    <span className="mb-1 block text-text-muted">Stack size</span>
                    <input type="number" min={6} max={600} className={number} value={phase.stackSize} onChange={(e) => setPhase(i, { stackSize: clamp(e.target.value, 6, 600) })} />
                  </label>
                  <label>
                    <span className="mb-1 block text-text-muted">Piles</span>
                    <input type="number" min={2} max={phase.type === 'winchester' ? 6 : 5} className={number} value={phase.piles} onChange={(e) => setPhase(i, { piles: clamp(e.target.value, 2, phase.type === 'winchester' ? 6 : 5) })} />
                  </label>
                </>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-text-muted">
              <span>Deals {cardsNeeded(config, phase)} cards{size !== undefined ? ` of ${size}` : ''}; {phase.type === 'pickAndPass' ? '' : '~'}{cardsPerDrafterIn(config, phase)} per drafter.</span>
              <span className="ml-auto flex gap-1">
                <Button variant="ghost" className="!px-2 !py-0.5" disabled={i === 0} onClick={() => movePhase(i, -1)} aria-label="move up">↑</Button>
                <Button variant="ghost" className="!px-2 !py-0.5" disabled={i === config.phases.length - 1} onClick={() => movePhase(i, 1)} aria-label="move down">↓</Button>
                <Button variant="ghost" className="!px-2 !py-0.5 text-danger" disabled={config.phases.length === 1} onClick={() => setPhases(config.phases.filter((_, j) => j !== i), phaseCubes.filter((_, j) => j !== i))}>Remove</Button>
              </span>
            </div>
          </Card>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" disabled={config.phases.length >= 6} onClick={() => setPhases([...config.phases, emptyPhase(config.phases[config.phases.length - 1]?.poolCubeVersionId)], [...phaseCubes, phaseCubes[phaseCubes.length - 1] ?? ''])}>Add phase</Button>
        <span className="ml-auto flex items-center gap-3">
          {problems.length > 0 && <Chip type="warning">{problems[0]}</Chip>}
          <Button onClick={() => save.mutate(config)} disabled={save.isPending || problems.length > 0 || !config.name.trim()}>{id ? 'Save' : 'Create'}</Button>
        </span>
      </div>
      <ErrorText error={save.error ?? existing.error} />
      {save.isSuccess && <p className="text-sm text-success">Saved. Pick this format when creating a room.</p>}
    </main>
  );
}

function clamp(raw: string, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number(raw) || min));
}
