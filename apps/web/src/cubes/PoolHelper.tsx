import type { CubeResponse } from '@mtg/shared';
import { TRI_COLOUR_POOL_SIZE, triColourPool } from '@mtg/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, ErrorText } from '../components';
import { Chip } from '../components/Chip';
import { api } from '../lib/api';

/**
 * Makes the house-rules pool cube out of a cube's three-colour cards (colour
 * identity), as a new cube the caller owns. The cards stay in the source cube.
 */
export function PoolHelper({ cubeId, onCreated }: { cubeId: string; onCreated: (cube: CubeResponse) => void }) {
  const qc = useQueryClient();
  const cube = useQuery({ queryKey: ['cubes', cubeId, null], queryFn: () => api<CubeResponse>(`/cubes/${cubeId}`) });
  const [colours, setColours] = useState<2 | 3>(3);
  const pool = cube.data ? triColourPool(cube.data.version.cards, cube.data.printings, colours) : [];
  const size = pool.reduce((n, c) => n + c.quantity, 0);
  const create = useMutation({
    mutationFn: () => api<CubeResponse>('/cubes', { body: { name: `${cube.data!.cube.name} · ${colours === 3 ? 'tri-colour' : 'multicolour'} pool`, cards: pool, note: `Generated from ${cube.data!.cube.name} v${cube.data!.version.number}` } }),
    onSuccess: (created) => {
      void qc.invalidateQueries({ queryKey: ['cubes'] });
      onCreated(created);
    },
  });
  if (cube.isPending) return <p className="text-sm text-text-muted">Counting the cube's multicolour cards…</p>;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <ErrorText error={cube.error ?? create.error} />
      {cube.data && (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-text-muted">Cards with</span>
            <select className="rounded-md border border-border bg-surface px-2 py-1 text-text" value={colours} onChange={(e) => setColours(Number(e.target.value) as 2 | 3)}>
              <option value={3}>exactly three colours</option>
              <option value={2}>exactly two colours</option>
            </select>
            <span className="text-text-muted">in {cube.data.cube.name}:</span>
            <Chip type={size >= TRI_COLOUR_POOL_SIZE ? 'success' : 'warning'} title={`the first phase deals ${TRI_COLOUR_POOL_SIZE}`}>{size} card{size === 1 ? '' : 's'}</Chip>
            {size < TRI_COLOUR_POOL_SIZE && <span className="text-text-muted">fewer than the {TRI_COLOUR_POOL_SIZE} the first phase deals; add some to the pool cube afterwards.</span>}
          </p>
          <div>
            <Button variant="ghost" onClick={() => create.mutate()} disabled={create.isPending || size === 0}>{create.isPending ? 'Creating…' : 'Create the pool cube'}</Button>
          </div>
          <p className="text-xs text-text-muted">A new cube of your own, named after this one; the cards stay in this cube as well, so drop them from its list if you do not want them dealt twice.</p>
        </>
      )}
    </div>
  );
}
