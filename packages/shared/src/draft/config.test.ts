import { describe, expect, it } from 'vitest';
import { cardsPerDrafter, describeDraftConfig, draftConfigProblems, houseRulesPreset } from './config.js';

describe('draft config helpers', () => {
  const house = houseRulesPreset({ triColour: 'tri', main: 'main' });

  it('house rules yield 50 cards per drafter over two phases', () => {
    expect(house.seats).toBe(4);
    expect(house.phases.map((p) => p.packSize * p.packsPerPlayer * p.rounds)).toEqual([5, 45]);
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
