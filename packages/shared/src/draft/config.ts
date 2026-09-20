import { cardsNeeded, type DraftConfig, type DraftPhaseConfig } from './types.js';

/** A saved, user-owned draft recipe. */
export interface DraftConfigSummary {
  id: string;
  name: string;
  seats: 2 | 4;
  phaseCount: number;
  updatedAt: string;
}

/** A cube version a config deals from, resolved for display. */
export interface DraftPoolInfo {
  versionId: string;
  cubeId: string;
  cubeName: string;
  versionNumber: number;
  cardCount: number;
}

export interface DraftConfigResponse {
  id: string;
  ownerId: string;
  name: string;
  config: DraftConfig;
  pools: DraftPoolInfo[];
  createdAt: string;
  updatedAt: string;
}

export interface DraftConfigInput {
  name: string;
  config: DraftConfig;
}

/**
 * The house rules: a separate tri-colour phase (one 5-card pack each), then
 * three rounds of 15 from the main cube, passing direction flipping every
 * round across both phases. 50 cards per drafter, basics free at deckbuilding.
 */
/** A blank Winston phase for the editor (two-player classic: 90 cards, three piles). */
export function emptyWinstonPhase(poolCubeVersionId = ''): DraftPhaseConfig {
  return { type: 'winston', name: 'Winston', poolCubeVersionId, stackSize: 90, piles: 3 };
}

/** A blank Grid phase for the editor (two-player classic: eighteen 3×3 grids). */
export function emptyGridPhase(poolCubeVersionId = ''): DraftPhaseConfig {
  return { type: 'grid', name: 'Grid', poolCubeVersionId, grids: 18, size: 3 };
}

/** A blank Winchester phase for the editor (two-player classic: 90 cards, four piles). */
export function emptyWinchesterPhase(poolCubeVersionId = ''): DraftPhaseConfig {
  return { type: 'winchester', name: 'Winchester', poolCubeVersionId, stackSize: 90, piles: 4 };
}

export function houseRulesPreset(pools: { triColour: string; main: string }, name = 'House rules'): DraftConfig {
  return {
    name,
    seats: 4,
    startDirection: 'right',
    phases: [
      { type: 'pickAndPass', name: 'Tri-colour', poolCubeVersionId: pools.triColour, packSize: 5, packsPerPlayer: 1, rounds: 1, direction: 'alternate' },
      { type: 'pickAndPass', name: 'Main cube', poolCubeVersionId: pools.main, packSize: 15, packsPerPlayer: 1, rounds: 3, direction: 'alternate' },
    ],
  };
}

/** A blank phase for the editor. */
export function emptyPhase(poolCubeVersionId = ''): DraftPhaseConfig {
  return { type: 'pickAndPass', name: 'Pack draft', poolCubeVersionId, packSize: 15, packsPerPlayer: 1, rounds: 3, direction: 'alternate' };
}

/** Cards each drafter ends up with. */
export function cardsPerDrafter(config: DraftConfig): number {
  return config.phases.reduce((n, p) => n + cardsPerDrafterIn(config, p), 0);
}

/** Cards one drafter gets from a phase (a Winston stack is split evenly, roughly). */
export function cardsPerDrafterIn(config: DraftConfig, phase: DraftPhaseConfig): number {
  if (phase.type === 'winston' || phase.type === 'winchester') return Math.floor(phase.stackSize / config.seats);
  // Grid: the first pick takes a full line, later picks a line with one card already gone.
  if (phase.type === 'grid') return Math.floor((phase.grids * (phase.size + (config.seats - 1) * (phase.size - 1))) / config.seats);
  return phase.packSize * phase.packsPerPlayer * phase.rounds;
}

/**
 * Problems that would stop the draft from starting, given the card count of
 * each referenced cube version (missing entries count as unknown versions).
 */
export function draftConfigProblems(config: DraftConfig, poolSizes: Record<string, number>): string[] {
  const problems: string[] = [];
  config.phases.forEach((phase, i) => {
    const label = `Phase ${i + 1} (${phase.name})`;
    if (!phase.poolCubeVersionId) return problems.push(`${label}: choose a cube`);
    const size = poolSizes[phase.poolCubeVersionId];
    if (size === undefined) return problems.push(`${label}: the cube version no longer exists`);
    const needed = cardsNeeded(config, phase);
    if (size < needed) problems.push(`${label}: needs ${needed} cards, the cube has ${size}`);
  });
  return problems;
}

/** One-line description: "4 players · 5 + 45 cards". */
export function describeDraftConfig(config: DraftConfig): string {
  const parts = config.phases.map((p) => cardsPerDrafterIn(config, p));
  return `${config.seats} players · ${parts.join(' + ')} card${cardsPerDrafter(config) === 1 ? '' : 's'}`;
}
