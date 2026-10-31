import { describe, expect, it } from 'vitest';
import { activeLine, parseLrc, parsePlain } from './lyrics';

describe('lyrics', () => {
  it('reads timed lines, several stamps on one line, and skips tags', () => {
    const l = parseLrc('[ar:Someone]\n[00:12.50] first\n[00:05.00][01:00.5] chorus\n[00:20] ');
    expect(l?.synced).toBe(true);
    expect(l?.lines.map((x) => [x.at, x.text])).toEqual([[5, 'chorus'], [12.5, 'first'], [20, ''], [60.5, 'chorus']]);
  });

  it('returns null when nothing is timed', () => {
    expect(parseLrc('just words')).toBeNull();
    expect(parsePlain('  \n')).toBeNull();
  });

  it('keeps plain lyrics unsynced and trims the end', () => {
    const l = parsePlain('one\n\ntwo\n\n');
    expect(l?.synced).toBe(false);
    expect(l?.lines.map((x) => x.text)).toEqual(['one', '', 'two']);
  });

  it('finds the line being sung', () => {
    const lines = parseLrc('[00:05.00] a\n[00:10.00] b\n[00:15.00] c')!.lines;
    expect(activeLine(lines, 0)).toBe(-1);
    expect(activeLine(lines, 5)).toBe(0);
    expect(activeLine(lines, 12)).toBe(1);
    expect(activeLine(lines, 99)).toBe(2);
  });
});
