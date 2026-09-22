import type { CubeSummary, DraftConfig, DraftConfigResponse, DraftConfigSummary, RoomSettings, RoomState, UserSummary } from '@mtg/shared';
import { describeDraftConfig, houseRulesPreset, withRoomSeats } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Button, Card, ErrorText, Input, Select } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';
import { useMe } from '../lib/auth';
import { describeSettings, PRESETS } from '../rooms/describe';
import { SettingsForm } from '../rooms/SettingsForm';
import { PoolHelper } from '../cubes/PoolHelper';

type Kind = 'game' | 'draft';
type StepKey = 'what' | 'cube' | 'format' | 'table' | 'name';
const STEP_LABEL: Record<StepKey, string> = { what: 'What', cube: 'Cube', format: 'Format', table: 'Players', name: 'Name' };
const stepsFor = (kind: Kind): StepKey[] => (kind === 'draft' ? ['what', 'cube', 'format', 'table', 'name'] : ['what', 'table', 'name']);

/** A choice presented as a big clickable card. */
function Choice({ selected, onClick, title, text, disabled = false }: { selected: boolean; onClick: () => void; title: string; text: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex min-w-52 flex-1 flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'border-accent bg-accent/10' : 'border-border hover:border-text-muted'}`}
      aria-pressed={selected}
    >
      <span className="font-medium">{title}</span>
      <span className="text-sm text-text-muted">{text}</span>
    </button>
  );
}

/**
 * New game / New draft: one question per step, in the order a host thinks —
 * what → (cube → format) → players → name → create. The lobby follows.
 */
export function NewWizard() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>(params.get('kind') === 'draft' ? 'draft' : 'game');
  // From a cube page: the cube is chosen already, so start at the format (or, with a format too, at the players).
  const [at, setAt] = useState(params.get('cube') ? (params.get('format') ? 3 : 2) : params.get('kind') ? 1 : 0);
  const steps = stepsFor(kind);
  const step = steps[Math.min(at, steps.length - 1)]!;

  // Draft: the cube, then the format that deals from it.
  const cubes = useQuery({ queryKey: ['cubes'], queryFn: () => api<CubeSummary[]>('/cubes'), enabled: kind === 'draft' });
  const formats = useQuery({ queryKey: ['draft-configs'], queryFn: () => api<DraftConfigSummary[]>('/draft-configs'), enabled: kind === 'draft' });
  const [cubeId, setCubeId] = useState(params.get('cube') ?? '');
  const [formatId, setFormatId] = useState<'house' | string>(params.get('format') ?? 'house');
  const [triCubeId, setTriCubeId] = useState('');
  const saved = useQuery({ queryKey: ['draft-configs', formatId], queryFn: () => api<DraftConfigResponse>(`/draft-configs/${formatId}`), enabled: kind === 'draft' && formatId !== 'house' });
  const cube = cubes.data?.find((c) => c.id === cubeId);
  const tri = cubes.data?.find((c) => c.id === (triCubeId || cubeId));
  const cubeFormats = formats.data?.filter((f) => f.cubeIds.includes(cubeId)) ?? [];
  /** The draft config the room will carry. */
  const config: DraftConfig | null =
    kind !== 'draft' ? null
    : formatId === 'house' ? (cube?.latestVersionId && tri?.latestVersionId ? houseRulesPreset({ triColour: tri.latestVersionId, main: cube.latestVersionId }) : null)
    : (saved.data?.config ?? null);

  const [settings, setSettings] = useState<RoomSettings>(PRESETS[0]!.settings);
  // A chosen format fills the player count in; it stays editable.
  useEffect(() => {
    if (!config) return;
    setSettings((s) => withRoomSeats({ ...s, draft: config, playerCount: config.seats, mode: config.seats === 2 ? '1v1' : s.mode === '1v1' ? 'ffa' : s.mode }));
  }, [config?.name, config?.seats, config?.phases.length]); // the config object is rebuilt every render; these three are its identity
  const [name, setName] = useState('');
  // Open to the group, or reserved for named players (the owner always sits).
  const [reserved, setReserved] = useState<string[]>([]);
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<UserSummary[]>('/users') });
  const me = useMe();
  const finalSettings: RoomSettings = { ...(kind === 'draft' ? withRoomSeats({ ...settings, draft: config }) : { ...settings, draft: null }), ...(reserved.length ? { reservedPlayerIds: reserved } : {}) };
  const suggestedName = kind === 'draft' && config ? `${config.name} · ${finalSettings.playerCount} players · ${new Date().toISOString().slice(0, 10)}` : '';

  const create = useMutation({
    mutationFn: () => api<RoomState>('/rooms', { body: { settings: finalSettings, ...(name.trim() ? { name: name.trim() } : {}) } }),
    onSuccess: (state) => {
      void qc.invalidateQueries({ queryKey: ['rooms'] });
      navigate(`/rooms/${state.id}`);
    },
  });

  const ready: Record<StepKey, boolean> = {
    what: true,
    cube: !!cube?.latestVersionId,
    format: !!config,
    table: true,
    name: true,
  };
  const last = at >= steps.length - 1;
  const next = () => setAt((i) => Math.min(i + 1, steps.length - 1));
  const back = () => setAt((i) => Math.max(i - 1, 0));

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{kind === 'draft' ? 'New draft' : 'New game'}</h1>
        <Link to="/" className="text-sm text-accent hover:underline">Back to Play</Link>
      </header>
      <ol className="flex flex-wrap items-center gap-2 text-sm">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <button type="button" onClick={() => i < at && setAt(i)} disabled={i > at} className={`rounded-full px-3 py-1 ${i === at ? 'bg-accent text-bg' : i < at ? 'bg-surface-raised text-text hover:underline' : 'text-text-muted'}`}>
              {i + 1}. {STEP_LABEL[s]}
            </button>
            {i < steps.length - 1 && <span className="text-text-muted">›</span>}
          </li>
        ))}
      </ol>

      <Card>
        {step === 'what' && (
          <div className="flex flex-wrap gap-3">
            <Choice selected={kind === 'game'} onClick={() => setKind('game')} title="A game" text="Everyone brings a deck from Decks. 1v1, free-for-all or 2v2; commander if you like." />
            <Choice selected={kind === 'draft'} onClick={() => setKind('draft')} title="A draft" text="Draft one of your cubes first, build decks, then play." />
          </div>
        )}

        {step === 'cube' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">Which cube are we drafting?</p>
            <ErrorText error={cubes.error} />
            <div className="flex flex-wrap gap-3">
              {cubes.data?.map((c) => (
                <Choice key={c.id} selected={cubeId === c.id} onClick={() => { setCubeId(c.id); setFormatId('house'); setTriCubeId(''); }} disabled={!c.latestVersionId} title={c.name} text={<>{c.cardCount} cards · v{c.latestVersion}{c.shared && <Chip type="primary" className="ml-2">by {c.ownerName}</Chip>}</>} />
              ))}
            </div>
            {cubes.data?.length === 0 && <p className="text-sm text-text-muted">No cubes yet.</p>}
            <p className="text-sm"><Link to="/cubes/new" className="text-accent hover:underline">Add a cube</Link> (Cube Cobra link or a pasted list).</p>
          </div>
        )}

        {step === 'format' && cube && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">How do we draft <span className="text-text">{cube.name}</span>?</p>
            <div className="flex flex-wrap gap-3">
              <Choice selected={formatId === 'house'} onClick={() => setFormatId('house')} title="House rules" text="One pack of 5 from the tri-colour pool, then three packs of 15 from the cube. 4 players by default." />
              {cubeFormats.map((f) => (
                <Choice key={f.id} selected={formatId === f.id} onClick={() => setFormatId(f.id)} title={f.name} text={<>{f.seats} players · {f.phaseCount} phase{f.phaseCount === 1 ? '' : 's'}{f.shared && <Chip type="primary" className="ml-2">by {f.ownerName}</Chip>}</>} />
              ))}
            </div>
            {formatId === 'house' && (
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-text-muted">Tri-colour pool cube</span>
                <Select className="!py-1.5" value={triCubeId || cubeId} onChange={(e) => setTriCubeId(e.target.value)}>
                  {cubes.data?.map((c) => <option key={c.id} value={c.id} disabled={!c.latestVersionId}>{c.name}{c.id === cubeId ? ' (the same cube)' : ''}</option>)}
                </Select>
                <span className="text-text-muted">The first pack draws from it.</span>
              </label>
            )}
            {formatId === 'house' && (triCubeId || cubeId) === cubeId && (
              <div className="rounded-md border border-border p-3">
                <p className="mb-2 text-sm">No separate pool yet? Make one from this cube's three-colour cards; it is picked here once created.</p>
                <PoolHelper cubeId={cubeId} onCreated={(c) => setTriCubeId(c.cube.id)} />
              </div>
            )}
            {formatId !== 'house' && <ErrorText error={saved.error} />}
            {config && <Chip type="primary">{describeDraftConfig(config)}</Chip>}
            <p className="text-sm text-text-muted">
              Something else? <Link to={`/drafts/new?cube=${cubeId}`} className="text-accent hover:underline">Custom…</Link> opens the format editor bound to this cube; the saved format then shows up here.
              {formats.data && cubeFormats.length === 0 && ' This cube has no saved formats yet.'}
            </p>
          </div>
        )}

        {step === 'table' && (
          <div className="flex flex-col gap-3">
            {kind === 'game' && (
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <Button key={p.label} variant="ghost" className="!py-1 text-xs" onClick={() => setSettings(p.settings)}>{p.label}</Button>
                ))}
              </div>
            )}
            {kind === 'draft' && config && <p className="text-sm text-text-muted">The format suggests {config.seats} players; the pack sizes adapt to what you choose here.</p>}
            <SettingsForm value={finalSettings} onChange={(s) => setSettings({ ...s, draft: settings.draft })} />
          </div>
        )}

        {step === 'name' && (
          <div className="flex flex-col gap-3">
            <Input label={kind === 'draft' ? 'Draft name' : 'Room name (optional)'} value={name} onChange={(e) => setName(e.target.value)} placeholder={suggestedName || describeSettings(finalSettings)} />
            {suggestedName && !name && <p className="text-sm text-text-muted">Leave it empty to use the suggestion when the draft starts.</p>}
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 text-text-muted">Seats</legend>
              <label className="flex items-center gap-2"><input type="radio" name="seats" checked={reserved.length === 0} onChange={() => setReserved([])} /> Open — anyone in the group can sit</label>
              <label className="flex items-center gap-2"><input type="radio" name="seats" checked={reserved.length > 0} onChange={() => setReserved(users.data?.filter((u) => u.id !== me.data?.id).slice(0, finalSettings.playerCount - 1).map((u) => u.id) ?? [])} /> Reserved — only the players I name (and me)</label>
              {reserved.length > 0 && (
                <div className="ml-6 flex flex-wrap gap-3">
                  {users.data?.filter((u) => u.id !== me.data?.id).map((u) => (
                    <label key={u.id} className="flex items-center gap-1"><input type="checkbox" checked={reserved.includes(u.id)} onChange={(e) => setReserved((r) => (e.target.checked ? [...r, u.id] : r.filter((id) => id !== u.id)))} /> {u.displayName}</label>
                  ))}
                  <span className="text-text-muted">Everyone still sees the lobby; only these players can take a seat.</span>
                </div>
              )}
            </fieldset>
            <p className="text-sm text-text-muted">{describeSettings(finalSettings)}</p>
          </div>
        )}

        <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
          {at > 0 && <Button variant="ghost" onClick={back}>Back</Button>}
          {!last && <Button onClick={next} disabled={!ready[step]}>Next</Button>}
          {last && <Button onClick={() => create.mutate()} disabled={create.isPending || !ready.format}>{create.isPending ? 'Creating…' : kind === 'draft' ? 'Create draft' : 'Create game'}</Button>}
          <ErrorText error={create.error} />
        </div>
      </Card>
    </main>
  );
}
