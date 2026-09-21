import { describe, expect, it } from 'vitest';
import { classifyGesture, DRAG_THRESHOLD, LONG_PRESS_MS } from './touch';

describe('touch gestures', () => {
  it('a short still press is a press, a held one a long press, a moved one a drag', () => {
    expect(classifyGesture(0, 0)).toBe('press');
    expect(classifyGesture(DRAG_THRESHOLD, LONG_PRESS_MS - 1)).toBe('press');
    expect(classifyGesture(2, LONG_PRESS_MS)).toBe('longpress');
    expect(classifyGesture(DRAG_THRESHOLD + 1, 0)).toBe('drag');
    expect(classifyGesture(50, LONG_PRESS_MS * 2)).toBe('drag'); // moving wins over holding
  });
});
