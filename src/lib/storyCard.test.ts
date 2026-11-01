import { describe, expect, it } from 'vitest';
import { boxBlur, wrapLines } from './storyCard';

describe('boxBlur', () => {
  it('spreads a bright pixel into its neighbours and keeps the average', () => {
    const w = 9, h = 9;
    const data = new Uint8ClampedArray(w * h * 4);
    const mid = (4 * w + 4) * 4;
    for (let c = 0; c < 4; c++) data[mid + c] = 255;
    boxBlur(data, w, h, 2, 2);
    expect(data[mid]).toBeLessThan(255);
    expect(data[mid - 4]).toBeGreaterThan(0);
    const total = Array.from({ length: w * h }, (_, i) => data[i * 4]).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(200);
    expect(total).toBeLessThan(260);
  });

  it('leaves a flat picture flat', () => {
    const data = new Uint8ClampedArray(6 * 6 * 4).fill(100);
    boxBlur(data, 6, 6, 3, 3);
    expect(new Set(data)).toEqual(new Set([100]));
  });
});

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
