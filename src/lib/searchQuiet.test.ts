import { describe, expect, it } from 'vitest';
import { quietEnough } from './searchQuiet';

describe('ending a search once answers stop coming', () => {
  it('waits for the first answers', () => {
    expect(quietEnough(3000, 3000, 0)).toBe(false);
    expect(quietEnough(5000, 4500, 200)).toBe(false);
  });
  it('ends a rare search that went quiet, long before 30 seconds', () => {
    // "subfocus": 248 answers at 3 s, 260 at 8 s, nothing new after
    expect(quietEnough(5000, 2000, 255, 7)).toBe(false);
    expect(quietEnough(7000, 3000, 260, 0)).toBe(true);
    // and, by 8 s, a trickle counts as done too
    expect(quietEnough(8000, 2000, 260, 2)).toBe(true);
  });
  it('ends a popular search once only a trickle is left', () => {
    // "Static-X": 348 answers after 1 s, then a few more every second for a minute
    expect(quietEnough(8000, 500, 700, 60)).toBe(false);
    expect(quietEnough(9000, 500, 760, 15)).toBe(true);
  });
  it('keeps going while answers still pour in, up to 20 seconds', () => {
    expect(quietEnough(15_000, 200, 800, 120)).toBe(false);
    expect(quietEnough(20_000, 200, 950, 120)).toBe(true);
  });
  it('gives up on a search nobody answers', () => {
    expect(quietEnough(11_000, 11_000, 0)).toBe(false);
    expect(quietEnough(12_000, 12_000, 0)).toBe(true);
  });
});
