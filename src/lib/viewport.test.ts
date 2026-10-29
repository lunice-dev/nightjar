import { describe, expect, it } from 'vitest';
import { wantsFullScreen } from './viewport';

describe('giving the page the screen\'s full height', () => {
  it('applies to an installed app held upright under the status bar', () => {
    expect(wantsFullScreen({ top: 59, standalone: true, portrait: true })).toBe(true);
  });

  it('does not apply in a browser tab, sideways, or when nothing is drawn under the status bar', () => {
    expect(wantsFullScreen({ top: 59, standalone: false, portrait: true })).toBe(false);
    expect(wantsFullScreen({ top: 59, standalone: true, portrait: false })).toBe(false);
    expect(wantsFullScreen({ top: 0, standalone: true, portrait: true })).toBe(false);
  });
});
