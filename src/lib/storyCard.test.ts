import { describe, expect, it } from 'vitest';
import { wrapLines } from './storyCard';

const measure = (s: string) => s.length * 10;

describe('wrapLines', () => {
  it('keeps short text on one line', () => {
    expect(wrapLines(measure, 'Slow Tide', 200, 2)).toEqual(['Slow Tide']);
  });

  it('wraps at word boundaries', () => {
    expect(wrapLines(measure, 'Low Country Lights Again', 130, 3)).toEqual(['Low Country', 'Lights Again']);
  });

  it('ends the last line with an ellipsis when there is more', () => {
    const lines = wrapLines(measure, 'one two three four five six seven', 80, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(measure(lines[1])).toBeLessThanOrEqual(80);
  });

  it('shortens a single word that is too long', () => {
    const lines = wrapLines(measure, 'Supercalifragilistic', 100, 1);
    expect(lines).toHaveLength(1);
    expect(measure(lines[0])).toBeLessThanOrEqual(100);
    expect(lines[0].endsWith('…')).toBe(true);
  });
});
