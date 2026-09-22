import type { CardPrinting, TaplandFace } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { CardImage } from '../cards/CardImage';
import { Button, Card, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';

interface Suggestion { face: TaplandFace; sentence: string; printing: CardPrinting }

const isLand = (p: CardPrinting) => /\bLand\b/.test(p.typeLine ?? '') || p.faces.some((f) => /\bLand\b/.test(f.typeLine ?? ''));

/**
 * Which lands in this deck enter the battlefield tapped, for the table to tap
 * them on arrival. The list is shared by the whole group and keyed by card
 * name. Suggestions come from the cards' rules text (unconditional "enters
 * tapped"); conditional lands (shock, check, fast, slow…) are left to you.
 */
export function TaplandsPanel({ printings }: { printings: CardPrinting[] }) {
  const qc = useQueryClient();
  const lands = useMemo(() => {
    const byName = new Map<string, CardPrinting>();
    for (const p of printings) if (isLand(p) && !byName.has(p.name)) byName.set(p.name, p);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [printings]);
  const ids = useMemo(() => lands.map((l) => l.id), [lands]);
  const marked = useQuery({ queryKey: ['taplands'], queryFn: () => api<{ taplands: { name: string; face: TaplandFace }[] }>('/cards/taplands') });
  const suggested = useQuery({
    queryKey: ['taplands', 'suggest', ids],
    queryFn: () => api<{ suggestions: Suggestion[] }>('/cards/taplands/suggest', { body: { ids } }),
    enabled: ids.length > 0,
  });
  const set = useMutation({
    mutationFn: (items: { name: string; face: TaplandFace | null }[]) => Promise.all(items.map((i) => api('/cards/taplands', { method: 'PUT', body: i }))),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['taplands'] }),
  });
  if (lands.length === 0) return null;

  const faceOf = new Map(marked.data?.taplands.map((t) => [t.name, t.face]) ?? []);
  const suggestions = suggested.data?.suggestions.filter((s) => !faceOf.has(s.printing.name)) ?? [];
  const suggestedFace = new Map(suggestions.map((s) => [s.printing.name, s]));

  return (
    <Card title={`Taplands · ${lands.filter((l) => faceOf.has(l.name)).length} of ${lands.length} lands`}>
      <p className="mb-3 text-sm text-text-muted">Lands ticked here enter the battlefield tapped when played at the table. The list is shared by everyone and applies to every deck and cube.</p>
      <ErrorText error={marked.error ?? suggested.error ?? set.error} />
      {suggestions.length > 0 && (
        <div className="mb-4 rounded-md border border-accent/40 bg-accent/5 p-3">
          <div className="mb-2 flex items-center gap-3">
            <span className="text-sm font-medium">Suggested from the rules text · {suggestions.length}</span>
            <Button variant="ghost" onClick={() => set.mutate(suggestions.map((s) => ({ name: s.printing.name, face: s.face })))} disabled={set.isPending}>Mark all</Button>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {suggestions.map((s) => (
              <li key={s.printing.name} className="flex items-center gap-3">
                <span className="w-8 shrink-0"><CardImage card={s.printing} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{s.printing.name}{s.face === 'back' && <Chip type="neutral" className="ml-2">back face</Chip>}</span>
                  <span className="block truncate text-text-muted">“{s.sentence}”</span>
                </span>
                <Button variant="ghost" onClick={() => set.mutate([{ name: s.printing.name, face: s.face }])} disabled={set.isPending}>Mark</Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="flex flex-col gap-1 text-sm">
        {lands.map((l) => {
          const face = faceOf.get(l.name) ?? null;
          const hint = suggestedFace.get(l.name);
          return (
            <li key={l.name} className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-surface-raised">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={face !== null}
                  onChange={(e) => set.mutate([{ name: l.name, face: e.target.checked ? (hint?.face ?? (l.faces.length > 1 && !/\bLand\b/.test(l.faces[0]?.typeLine ?? '') ? 'back' : 'front')) : null }])}
                  disabled={set.isPending || marked.isPending}
                />
                <span className="w-8 shrink-0"><CardImage card={l} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{l.name}</span>
                  <span className="block truncate text-text-muted">{l.typeLine}</span>
                </span>
              </label>
              {face === 'back' && <Chip type="neutral" title="The land is on the back face; it is tapped when turned over">back face</Chip>}
              {face !== null && <Chip type="warning" title="Enters the battlefield tapped">enters tapped</Chip>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
