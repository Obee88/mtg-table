import type { RoomState } from '@mtg/shared';
import { describeResult, seatedPlayers } from '@mtg/shared';
import { Link } from 'react-router';
import { Button, Card } from '../components';
import { Chip } from '../components/Chip';

/**
 * Shown over the lobby once a game has been recorded, and on a closed room:
 * who won, the earlier games, and what to do next (play again, stats, the
 * drafted decks, leave).
 */
export function EndOfGameCard({ state, meId, onPlayAgain, closed = false }: { state: RoomState; meId: string; onPlayAgain?: (() => void) | undefined; closed?: boolean }) {
  const results = [...state.results].sort((a, b) => b.gameNumber - a.gameNumber);
  const latest = results[0];
  if (!latest) return null;
  const me = state.players[meId];
  const iWon = latest.winners.includes(meId) || (state.settings.mode === '2v2' && !!me && latest.winners.some((id) => state.players[id]?.team === me.team));
  const earlier = results.slice(1);
  const wins = (id: string) => results.filter((r) => r.winners.includes(id)).length;
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-text-muted">{closed ? 'This room is closed' : `Game ${latest.gameNumber} is over`}</p>
          <h2 className="mt-1 text-2xl font-semibold">{describeResult(latest, state)}{iWon && !closed ? ' — nice.' : ''}</h2>
          {latest.note && <p className="mt-1 text-sm text-text-muted">{latest.note}</p>}
        </div>
        {results.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-text-muted">Standings:</span>
            {seatedPlayers(state).map((p) => <Chip key={p.id} type={wins(p.id) > 0 ? 'primary' : 'neutral'}>{p.displayName} · {wins(p.id)}</Chip>)}
            <span className="text-text-muted">of {results.length} games</span>
          </div>
        )}
        {earlier.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-sm text-text-muted">
            {earlier.map((r) => <li key={r.gameNumber}>{describeResult(r, state)}{r.note ? ` — ${r.note}` : ''}</li>)}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {onPlayAgain && !closed && <Button onClick={onPlayAgain}>Play again</Button>}
          <Link to="/players/me/stats" className="text-sm text-accent hover:underline">My stats</Link>
          {state.draft && <Link to={`/drafts/history/${state.id}`} className="text-sm text-accent hover:underline">My drafted deck</Link>}
          <Link to="/" className="text-sm text-accent hover:underline">{closed ? 'Back to Play' : 'Leave the room'}</Link>
        </div>
      </div>
    </Card>
  );
}
