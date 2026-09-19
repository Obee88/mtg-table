import { describe, expect, it } from 'vitest';
import { counterView, signed } from './counters';

describe('counterView', () => {
  it('nets ±X/±Y counters into one modification', () => {
    expect(counterView({ '+1/+1': 2 }).pt).toEqual({ power: 2, toughness: 2 });
    expect(counterView({ '+1/+1': 1, '-1/-1': 3 }).pt).toEqual({ power: -2, toughness: -2 });
    expect(counterView({ '+1/+0': 2, '-0/-1': 1, '+2/+2': 1 }).pt).toEqual({ power: 4, toughness: 1 });
    expect(counterView({ '+1/+1': 1, '-1/-1': 1 }).pt).toEqual({ power: 0, toughness: 0 });
  });
  it('separates loyalty and everything else', () => {
    const v = counterView({ loyalty: 4, charge: 3, '+1/+1': 1 });
    expect(v.loyalty).toBe(4);
    expect(v.other).toEqual([['charge', 3]]);
    expect(counterView({}).pt).toBeNull();
    expect(counterView({}).loyalty).toBeNull();
  });
  it('formats signed numbers', () => {
    expect(signed(2)).toBe('+2');
    expect(signed(-1)).toBe('-1');
    expect(signed(0)).toBe('+0');
  });
});
