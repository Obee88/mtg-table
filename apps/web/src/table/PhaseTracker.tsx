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
 * The steps of a turn as a segmented bar: steps already taken this turn are
 * filled, the current one is lit, the ones ahead are outlined. The active
 * player walks through them with the play button (Enter), or jumps by
 * clicking a later step, which plays every step in between.
 */
export function PhaseTracker({ step, active, mine, run }: { step: Step; active: boolean; mine: boolean; run: Run }) {
  const at = STEPS.indexOf(step);
  const canPlay = active && mine;
  return (
    <span className={`flex items-center gap-1 ${active ? '' : 'opacity-40'}`}>
      {canPlay && (
        <button
          type="button"
          onClick={() => void run({ type: 'advanceStep' })}
          className="touch-target mr-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[10px] text-bg shadow hover:bg-accent-hover"
          title={`${PLAY_HINT[step]} (Enter)`}
          aria-label="next step"
        >
          ▶
        </button>
      )}
      <span className="flex items-center overflow-hidden rounded-md border border-white/10 bg-black/30">
        {STEPS.map((s, i) => {
          const state = !active ? 'off' : i < at ? 'done' : i === at ? 'now' : 'next';
          const cls =
            state === 'now'
              ? 'bg-accent font-semibold text-bg shadow-[inset_0_0_0_1px_rgba(255,255,255,.35)]'
              : state === 'done'
                ? 'bg-white/15 text-text/80'
                : state === 'next'
                  ? 'text-text-muted'
                  : 'text-text-muted/60';
          const jump = canPlay && state === 'next';
          return (
            <button
              key={s}
              type="button"
              disabled={!jump}
              onClick={jump ? () => void run({ type: 'advanceStep', to: s }) : undefined}
              className={`px-2 py-1 text-[11px] leading-none tracking-wide transition-colors disabled:cursor-default ${cls} ${jump ? 'hover:bg-white/10 hover:text-text' : ''} ${i > 0 ? 'border-l border-white/10' : ''}`}
              title={jump ? `Play through to ${STEP_LABELS[s]}` : state === 'now' ? `Now: ${STEP_LABELS[s]}` : STEP_LABELS[s]}
            >
              {STEP_LABELS[s]}
            </button>
          );
        })}
      </span>
    </span>
  );
}
