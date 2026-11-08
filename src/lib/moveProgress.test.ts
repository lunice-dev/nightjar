import { describe, expect, it } from 'vitest';
import { moveTimeLeft, timeLeftText } from './moveProgress';

const MB = 1_000_000;

describe('moveTimeLeft', () => {
  it('gives nothing until it has a few seconds and a few percent to go on', () => {
    expect(moveTimeLeft([], 100 * MB)).toBeNull();
    expect(moveTimeLeft([{ at: 0, done: 0 }], 100 * MB)).toBeNull();
    expect(moveTimeLeft([{ at: 0, done: 0 }, { at: 2000, done: 20 * MB }], 100 * MB)).toBeNull();
    expect(moveTimeLeft([{ at: 0, done: 0 }, { at: 4000, done: 1 * MB }], 100 * MB)).toBeNull();
  });

  it('reads the time left from the speed', () => {
    // 20 MB in 4 s is 5 MB/s; 80 MB are left: 16 s.
    const left = moveTimeLeft([{ at: 0, done: 0 }, { at: 4000, done: 20 * MB }], 100 * MB);
    expect(left).toBeCloseTo(16000, -2);
  });

  it('follows the recent speed, not the whole copy', () => {
    const samples = [
      { at: 0, done: 0 },
      { at: 10_000, done: 10 * MB }, // slow start: 1 MB/s
      { at: 15_000, done: 35 * MB },
      { at: 20_000, done: 60 * MB }, // then 5 MB/s
    ];
    // 40 MB left at 5 MB/s: 8 s (a whole-copy average of 3 MB/s would say 13 s).
    expect(moveTimeLeft(samples, 100 * MB)).toBeCloseTo(8000, -2);
  });

  it('gives nothing while the copy has stalled', () => {
    expect(moveTimeLeft([{ at: 0, done: 5 * MB }, { at: 5000, done: 5 * MB }], 100 * MB)).toBeNull();
  });
});

describe('timeLeftText', () => {
  it('uses plain words', () => {
    expect(timeLeftText(4000)).toBe('a few seconds left');
    expect(timeLeftText(30_000)).toBe('less than a minute left');
    expect(timeLeftText(70_000)).toBe('about a minute left');
    expect(timeLeftText(5 * 60_000)).toBe('about 5 min left');
    expect(timeLeftText(60 * 60_000)).toBe('about 1 h left');
    expect(timeLeftText(75 * 60_000)).toBe('about 1 h 15 min left');
  });
});
