import type { GameCommand, Step } from '@mtg/shared';
import { STEPS, STEP_LABELS } from '@mtg/shared';

type Run = (c: GameCommand) => Promise<void>;

/** What the play button does in each step, for its tooltip. */
const PLAY_HINT: Record<Step, string> = {
  untap: 'Untap and go to upkeep',
  upkeep: 'Go to the draw step',
  draw: 'Draw and go to your first main phase',
  main1: 'Go to combat',
  combat: 'Go to your second main phase',
  main2: 'Go to the end step',
  end: 'End your turn',
};

/**
 * The steps of a turn. Everyone sees where the active player is; the active
 * player walks through them with the play button (Enter).
 */
export function PhaseTracker({ step, active, mine, run }: { step: Step; active: boolean; mine: boolean; run: Run }) {
  return (
    <span className={`flex items-center gap-0.5 ${active ? '' : 'opacity-40'}`}>
      {active && mine && (
        <button
          type="button"
          onClick={() => void run({ type: 'advanceStep' })}
          className="touch-target mr-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[9px] text-bg hover:bg-accent-hover"
          title={`${PLAY_HINT[step]} (Enter)`}
          aria-label="next step"
        >
          ▶
        </button>
      )}
      {STEPS.map((s) => (
        <span
          key={s}
          className={`rounded px-1 py-0.5 text-[10px] leading-none ${active && s === step ? 'bg-accent font-semibold text-bg' : 'text-text-muted'}`}
          title={STEP_LABELS[s]}
        >
          {STEP_LABELS[s]}
        </span>
      ))}
    </span>
  );
}
