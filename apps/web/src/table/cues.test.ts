import { describe, expect, it } from 'vitest';
import { shouldCue, titleFor } from './cues';

describe('attention cues', () => {
  it('titles the tab with the ask and the room, or just the room', () => {
    expect(titleFor('your pick', 'Friday night')).toBe('● Your pick · Friday night · MTG Table');
    expect(titleFor('your turn', null)).toBe('● Your turn · MTG Table');
    expect(titleFor(null, 'Friday night')).toBe('Friday night · MTG Table');
    expect(titleFor(null, null)).toBe('MTG Table');
  });

  it('cues only a fresh ask', () => {
    expect(shouldCue(null, 'your pick')).toBe(true);
    expect(shouldCue('your pick', 'your turn')).toBe(true);
    expect(shouldCue('your pick', 'your pick')).toBe(false);
    expect(shouldCue('your pick', null)).toBe(false);
  });
});
