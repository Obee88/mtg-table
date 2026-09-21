import type { RoomState } from '@mtg/shared';
import { seatedPlayers } from '@mtg/shared';
import { useState } from 'react';
import { Button, Dialog } from '../components';
import { playerColor } from './PlayerStrip';

type Then = 'end' | 'restart';

/** Who won (player or team), several for a shared win, or "nobody won" to leave the game untracked. Everyone must confirm. */
function outcomeOptions(state: RoomState) {
  const teams = state.settings.mode === '2v2';
  const players = seatedPlayers(state);
  return teams
    ? [...new Set(players.map((p) => p.team))].map((team) => ({ key: `team-${team}`, label: `Team ${team + 1} · ${players.filter((p) => p.team === team).map((p) => p.displayName).join(' & ')}`, ids: players.filter((p) => p.team === team).map((p) => p.id), color: playerColor(state, players.find((p) => p.team === team)!) }))
    : players.map((p) => ({ key: p.id, label: p.displayName, ids: [p.id], color: playerColor(state, p) }));
}

/** Proposes the outcome of the current game before ending it or dealing a new one. */
export function ResultDialog({ state, then, onPropose, onClose }: { state: RoomState; then: Then; onPropose: (winners: string[] | null) => Promise<string | null>; onClose: () => void }) {
  const options = outcomeOptions(state);
  const [chosen, setChosen] = useState<string[]>([]);
  const [untracked, setUntracked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = seatedPlayers(state).length - 1;

  const submit = async () => {
    setBusy(true);
    const winners = untracked ? null : options.filter((o) => chosen.includes(o.key)).flatMap((o) => o.ids);
    const err = await onPropose(winners);
    setBusy(false);
    if (err) setError(err);
    else onClose();
  };

  return (
    <Dialog title={then === 'end' ? `End game ${state.game?.gameNumber ?? 1}` : `New game after game ${state.game?.gameNumber ?? 1}`} onClose={onClose}>
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-col gap-2">
          <span className="text-text-muted">Who won?</span>
          {options.map((o) => (
            <label key={o.key} className={`flex items-center gap-2 ${untracked ? 'opacity-40' : ''}`}>
              <input type="checkbox" disabled={untracked} checked={chosen.includes(o.key)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, o.key] : c.filter((k) => k !== o.key)))} />
              <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />
              {o.label}
            </label>
          ))}
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" checked={untracked} onChange={(e) => setUntracked(e.target.checked)} />
            Nobody won — don't track this game
          </label>
          {!untracked && chosen.length === 0 && <span className="text-xs text-text-muted">Nobody ticked = a draw (tracked).</span>}
        </div>
        <p className="text-xs text-text-muted">
          {others > 0 && `The other ${others === 1 ? 'player' : 'players'} must confirm. `}
          {then === 'end' ? 'The table clears and the room stays open for another game.' : 'New hands are dealt right away.'}
        </p>
        {error && <p className="text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>{then === 'end' ? 'End the game' : 'Deal a new game'}</Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Shown to everyone while an outcome waits for confirmation. */
export function PendingResultDialog({ state, meId, onConfirm, onReject }: { state: RoomState; meId: string; onConfirm: () => Promise<string | null>; onReject: () => Promise<string | null> }) {
  const pending = state.game?.pendingResult;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!pending) return null;
  const name = (id: string) => state.players[id]?.displayName ?? '?';
  const outcome = pending.winners === null ? 'nobody won — the game will not be tracked' : pending.winners.length === 0 ? 'a draw' : `${pending.winners.map(name).join(' & ')} won`;
  const mine = pending.proposedBy === meId;
  const confirmed = pending.confirmed.includes(meId);
  const waiting = Object.keys(state.players).filter((id) => !pending.confirmed.includes(id)).map(name);
  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    const err = await fn();
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <Dialog title={pending.then === 'end' ? 'Ending the game' : 'Starting a new game'} onClose={() => undefined}>
      <div className="flex flex-col gap-4 text-sm">
        <p><span className="font-medium">{name(pending.proposedBy)}</span> says: {outcome}.</p>
        <p className="text-xs text-text-muted">{pending.then === 'end' ? 'The table clears; the room stays open.' : 'New hands are dealt for everyone.'}</p>
        <p className="text-text-muted">{waiting.length > 0 ? `Waiting for ${waiting.join(', ')} to confirm.` : 'Everyone confirmed.'}</p>
        {error && <p className="text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => void act(onReject)} disabled={busy}>{mine ? 'Withdraw' : 'Dispute'}</Button>
          {!confirmed && <Button onClick={() => void act(onConfirm)} disabled={busy}>Confirm</Button>}
        </div>
      </div>
    </Dialog>
  );
}
