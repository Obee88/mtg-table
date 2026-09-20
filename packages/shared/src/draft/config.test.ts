import { describe, expect, it } from 'vitest';
import { cardsPerDrafter, cardsPerDrafterIn, describeDraftConfig, draftConfigProblems, emptyGridPhase, emptyWinchesterPhase, emptyWinstonPhase, houseRulesPreset } from './config.js';

describe('draft config helpers', () => {
  const house = houseRulesPreset({ triColour: 'tri', main: 'main' });

  it('house rules yield 50 cards per drafter over two phases', () => {
    expect(house.seats).toBe(4);
    expect(house.phases.map((p) => cardsPerDrafterIn(house, p))).toEqual([5, 45]);
    expect(cardsPerDrafter(house)).toBe(50);
    expect(describeDraftConfig(house)).toBe('4 players · 5 + 45 cards');
  });

  it('reports missing cubes and short pools per phase', () => {
    expect(draftConfigProblems(house, { tri: 20, main: 360 })).toEqual([]);
    expect(draftConfigProblems(house, { tri: 20, main: 100 })).toEqual(['Phase 2 (Main cube): needs 180 cards, the cube has 100']);
    expect(draftConfigProblems(house, { main: 360 })).toEqual(['Phase 1 (Tri-colour): the cube version no longer exists']);
    expect(draftConfigProblems({ ...house, phases: [{ ...house.phases[0]!, poolCubeVersionId: '' }] }, {})).toEqual(['Phase 1 (Tri-colour): choose a cube']);
  });
});

describe('winston phases', () => {
  it('count the stack as the pool need and split it between the seats', () => {
    const config = { ...houseRulesPreset({ triColour: 'tri', main: 'main' }), seats: 2 as const, phases: [emptyWinstonPhase('main')] };
    expect(cardsPerDrafter(config)).toBe(45);
    expect(describeDraftConfig(config)).toBe('2 players · 45 cards');
    expect(draftConfigProblems(config, { main: 60 })).toEqual(['Phase 1 (Winston): needs 90 cards, the cube has 60']);
  });
});

describe('grid phases', () => {
  it('need grids × size² cards and hand out about half of each grid', () => {
    const config = { ...houseRulesPreset({ triColour: 'tri', main: 'main' }), seats: 2 as const, phases: [emptyGridPhase('main')] };
    expect(draftConfigProblems(config, { main: 100 })).toEqual(['Phase 1 (Grid): needs 162 cards, the cube has 100']);
    expect(cardsPerDrafter(config)).toBe(45);
  });
});

describe('winchester phases', () => {
  it('need the stack and split it between the seats', () => {
    const config = { ...houseRulesPreset({ triColour: 'tri', main: 'main' }), seats: 2 as const, phases: [emptyWinchesterPhase('main')] };
    expect(draftConfigProblems(config, { main: 89 })).toEqual(['Phase 1 (Winchester): needs 90 cards, the cube has 89']);
    expect(cardsPerDrafter(config)).toBe(45);
  });
});
