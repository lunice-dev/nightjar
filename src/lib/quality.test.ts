import { describe, expect, it } from 'vitest';
import { speed } from './quality';

describe('speeds', () => {
  it('never prints a fraction of a byte', () => {
    expect(speed(0.123456789)).toBe('under 1 KB/s');
    expect(speed(512.333)).toBe('under 1 KB/s');
    expect(speed(2048)).toBe('2.0 KB/s');
    expect(speed(0)).toBe('—');
  });
});
