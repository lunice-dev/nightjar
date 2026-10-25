import { describe, expect, it } from 'vitest';
import { quietEnough } from './searchQuiet';

describe('ending a search once answers stop coming', () => {
  it('waits for the first answers', () => {
    expect(quietEnough(3000, 3000, 0)).toBe(false);
    expect(quietEnough(5000, 4500, 200)).toBe(false);
  });
  it('ends a rare search that went quiet, long before 30 seconds', () => {
    // "subfocus": 248 answers at 3 s, 260 at 8 s, nothing new after
    expect(quietEnough(8000, 2000, 260)).toBe(false);
    expect(quietEnough(12_000, 4000, 260)).toBe(true);
  });
  it('keeps going while answers still arrive', () => {
    expect(quietEnough(20_000, 1000, 800)).toBe(false);
  });
  it('gives up on a search nobody answers', () => {
    expect(quietEnough(11_000, 11_000, 0)).toBe(false);
    expect(quietEnough(12_000, 12_000, 0)).toBe(true);
  });
});
