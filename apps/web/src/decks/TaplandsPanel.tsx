import type { CardPrinting, TaplandFace } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { CardImage } from '../cards/CardImage';
import { Button, Card, ErrorText, Input } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';

interface Suggestion { face: TaplandFace; sentence: string; printing: CardPrinting }

const isLand = (p: CardPrinting) => /\bLand\b/.test(p.typeLine ?? '') || p.faces.some((f) => /\bLand\b/.test(f.typeLine ?? ''));
/** Which face is the one that enters tapped: the back only for a card whose front is not a land but whose back is. */
const faceFor = (p: CardPrinting): TaplandFace => (p.faces.length > 1 && !/\bLand\b/.test(p.faces[0]?.typeLine ?? '') && /\bLand\b/.test(p.faces[1]?.typeLine ?? '') ? 'back' : 'front');

/**
 * Which cards in this deck enter the battlefield tapped, for the table to tap
 * them on arrival. The list is shared by the whole group and keyed by card
 * name. Lands are listed with a tick box; any other card (a creature that
 * "enters tapped", say) is added through the search box. Suggestions come
 * from the cards' rules text; conditional lands are left to you.
 */
export function TaplandsPanel({ printings }: { printings: CardPrinting[] }) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const unique = useMemo(() => {
    const byName = new Map<string, CardPrinting>();
    for (const p of printings) if (!byName.has(p.name)) byName.set(p.name, p);
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [printings]);
  const ids = useMemo(() => unique.map((p) => p.id), [unique]);
  const marked = useQuery({ queryKey: ['taplands'], queryFn: () => api<{ taplands: { name: string; face: TaplandFace }[] }>('/cards/taplands') });
  const suggested = useQuery({
    queryKey: ['taplands', 'suggest', ids],
    queryFn: () => api<{ suggestions: Suggestion[] }>('/cards/taplands/suggest', { body: { ids } }),
    enabled: ids.length > 0,
  });
  const set = useMutation({
    mutationFn: (items: { name: string; face: TaplandFace | null }[]) => Promise.all(items.map((i) => api('/cards/taplands', { method: 'PUT', body: i }))),
    onSuccess: () => {
      setQuery('');
      void qc.invalidateQueries({ queryKey: ['taplands'] });
    },
  });
  if (unique.length === 0) return null;

  const faceOf = new Map(marked.data?.taplands.map((t) => [t.name, t.face]) ?? []);
  // The list: every land, plus any other card already marked.
  const listed = unique.filter((p) => isLand(p) || faceOf.has(p.name));
  const suggestions = suggested.data?.suggestions.filter((s) => !faceOf.has(s.printing.name)) ?? [];
  const suggestedFace = new Map(suggestions.map((s) => [s.printing.name, s]));
  const q = query.trim().toLowerCase();
  const candidates = q ? unique.filter((p) => !listed.includes(p) && p.name.toLowerCase().includes(q)).slice(0, 8) : [];

  return (
    <Card title={`Enters tapped · ${listed.filter((l) => faceOf.has(l.name)).length} of ${listed.length}`}>
      <p className="mb-3 text-sm text-text-muted">Cards ticked here enter the battlefield tapped when played at the table. The list is shared by everyone and applies to every deck and cube.</p>
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
        {listed.map((l) => {
          const face = faceOf.get(l.name) ?? null;
          const hint = suggestedFace.get(l.name);
          return (
            <li key={l.name} className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-surface-raised">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input type="checkbox" checked={face !== null} onChange={(e) => set.mutate([{ name: l.name, face: e.target.checked ? (hint?.face ?? faceFor(l)) : null }])} disabled={set.isPending || marked.isPending} />
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
      <div className="mt-4 border-t border-border pt-4">
        <Input label="Add another card that enters tapped" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="type part of a card name from this deck" />
        {q && candidates.length === 0 && <p className="mt-2 text-sm text-text-muted">No other card in this deck matches.</p>}
        {candidates.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {candidates.map((p) => (
              <li key={p.name} className="flex items-center gap-3 rounded-md px-2 py-1 hover:bg-surface-raised">
                <span className="w-8 shrink-0"><CardImage card={p} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-text-muted">{p.typeLine}</span>
                </span>
                <Button variant="ghost" onClick={() => set.mutate([{ name: p.name, face: faceFor(p) }])} disabled={set.isPending}>Enters tapped</Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
