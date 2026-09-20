import type { CubeDiffResponse, CubeVersionSummary } from '@mtg/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Chip } from '../components/Chip';
import { ErrorText } from '../components';
import { api } from '../lib/api';

/** Compare any two versions of a cube: added, removed, printing swaps, quantity changes. */
export function VersionDiff({ cubeId, versions }: { cubeId: string; versions: CubeVersionSummary[] }) {
  const latest = versions[0]?.number ?? 1;
  const [from, setFrom] = useState(Math.max(1, latest - 1));
  const [to, setTo] = useState(latest);
  const diff = useQuery({
    queryKey: ['cubes', cubeId, 'diff', from, to],
    queryFn: () => api<CubeDiffResponse>(`/cubes/${cubeId}/diff?from=${from}&to=${to}`),
    enabled: versions.length > 1,
  });
  const select = 'rounded-md border border-border bg-surface px-2 py-1 text-sm text-text';
  const options = versions.map((v) => <option key={v.id} value={v.number}>v{v.number}{v.note ? ` · ${v.note}` : ''}</option>);

  if (versions.length < 2) return <p className="text-sm text-text-muted">Save a second version to compare.</p>;
  const d = diff.data;
  const empty = d && d.added.length + d.removed.length + d.swapped.length + d.quantity.length === 0;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <select className={select} value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label="from version">{options}</select>
        <span className="text-text-muted">→</span>
        <select className={select} value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="to version">{options}</select>
      </div>
      <ErrorText error={diff.error} />
      {diff.isPending && <p className="text-text-muted">Comparing…</p>}
      {empty && <p className="text-text-muted">No differences.</p>}
      {d && (
        <div className="grid gap-3 sm:grid-cols-2">
          {d.added.length > 0 && <Section title={`Added · ${d.added.length}`} tone="success" rows={d.added.map((a) => [`${a.quantity}× ${a.printing.name}`, `${a.printing.setCode.toUpperCase()} #${a.printing.collectorNumber}`])} />}
          {d.removed.length > 0 && <Section title={`Removed · ${d.removed.length}`} tone="error" rows={d.removed.map((r) => [`${r.quantity}× ${r.printing.name}`, `${r.printing.setCode.toUpperCase()} #${r.printing.collectorNumber}`])} />}
          {d.swapped.length > 0 && <Section title={`Printing changed · ${d.swapped.length}`} tone="primary" rows={d.swapped.map((s) => [s.from.name, `${s.from.setCode.toUpperCase()} #${s.from.collectorNumber} → ${s.to.setCode.toUpperCase()} #${s.to.collectorNumber}`])} />}
          {d.quantity.length > 0 && <Section title={`Quantity · ${d.quantity.length}`} tone="warning" rows={d.quantity.map((q) => [q.printing.name, `${q.from} → ${q.to}`])} />}
        </div>
      )}
    </div>
  );
}

function Section({ title, tone, rows }: { title: string; tone: 'success' | 'error' | 'primary' | 'warning'; rows: [string, string][] }) {
  return (
    <div className="rounded-md border border-border bg-surface-raised/40 p-2">
      <Chip type={tone} className="mb-1">{title}</Chip>
      <ul className="flex flex-col gap-0.5">
        {rows.map(([name, detail], i) => (
          <li key={i} className="flex justify-between gap-2">
            <span className="truncate">{name}</span>
            <span className="shrink-0 text-xs text-text-muted">{detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
