import { describe, expect, it } from 'vitest';
import { quirkGap } from './viewport';

describe('the status-bar gap on an installed iPhone app', () => {
  it('measures a page that is one status bar shorter than the screen', () => {
    expect(quirkGap(932, 873, 59, true)).toBe(59);
  });

  it('sees nothing when the page fills the screen', () => {
    expect(quirkGap(932, 932, 59, true)).toBe(0);
  });

  it('ignores anything that is not the size of the status bar (a keyboard, a split view)', () => {
    expect(quirkGap(932, 620, 59, true)).toBe(0);
    expect(quirkGap(932, 925, 59, true)).toBe(0);
  });

  it('only applies to an installed app drawing under the status bar', () => {
    expect(quirkGap(932, 873, 59, false)).toBe(0);
    expect(quirkGap(932, 873, 0, true)).toBe(0);
  });
});
