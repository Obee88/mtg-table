import { describe, expect, it } from 'vitest';
import { cubeCobraId } from './cubecobra.js';

describe('cubeCobraId', () => {
  it('accepts ids and any cubecobra.com cube URL', () => {
    expect(cubeCobraId('modovintage')).toBe('modovintage');
    expect(cubeCobraId('https://cubecobra.com/cube/overview/modovintage')).toBe('modovintage');
    expect(cubeCobraId('https://cubecobra.com/cube/list/abc-123?view=table')).toBe('abc-123');
    expect(cubeCobraId('cubecobra.com/cube/5f3e2')).toBe('5f3e2');
    expect(cubeCobraId('https://example.com/nope')).toBeNull();
    expect(cubeCobraId('has spaces')).toBeNull();
  });
});
