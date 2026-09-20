import type { RoomState } from '@mtg/shared';
import { seatedPlayers } from '@mtg/shared';
import { useState } from 'react';
import { Button, Dialog } from '../components';
import { playerColor } from './PlayerStrip';

/**
 * Report who won the current game: one player (or team in 2v2), several in a
 * shared win, or nobody for a draw. Feeds player and card statistics.
 */
export function ResultDialog({ state, onReport, onClose }: { state: RoomState; onReport: (winners: string[], note: string) => Promise<string | null>; onClose: () => void }) {
  const teams = state.settings.mode === '2v2';
  const players = seatedPlayers(state);
  const options = teams
    ? [...new Set(players.map((p) => p.team))].map((team) => ({ key: `team-${team}`, label: `Team ${team + 1} · ${players.filter((p) => p.team === team).map((p) => p.displayName).join(' & ')}`, ids: players.filter((p) => p.team === team).map((p) => p.id), color: playerColor(state, players.find((p) => p.team === team)!) }))
    : players.map((p) => ({ key: p.id, label: p.displayName, ids: [p.id], color: playerColor(state, p) }));
  const [chosen, setChosen] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = state.results?.find((r) => r.gameNumber === state.game?.gameNumber);

  const submit = async () => {
    setBusy(true);
    const winners = options.filter((o) => chosen.includes(o.key)).flatMap((o) => o.ids);
    const err = await onReport(winners, note);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Dialog title={`Report result · game ${state.game?.gameNumber ?? 1}`} onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        {existing && <p className="text-text-muted">Already reported: {existing.winners.length === 0 ? 'a draw' : existing.winners.map((id) => state.players[id]?.displayName ?? '?').join(' & ')}. Reporting again replaces it.</p>}
        <div className="flex flex-col gap-2">
          <span className="text-text-muted">Who won?</span>
          {options.map((o) => (
            <label key={o.key} className="flex items-center gap-2">
              <input type="checkbox" checked={chosen.includes(o.key)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, o.key] : c.filter((k) => k !== o.key)))} />
              <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
              {o.label}
            </label>
          ))}
          <span className="text-xs text-text-muted">Nobody ticked = draw.</span>
        </div>
        <label className="block">
          <span className="mb-1 block text-text-muted">Note (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text" placeholder="conceded on turn 6, mull to 5…" />
        </label>
        {error && <p className="text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>{chosen.length === 0 ? 'Report a draw' : 'Report'}</Button>
        </div>
      </div>
    </Dialog>
  );
}
