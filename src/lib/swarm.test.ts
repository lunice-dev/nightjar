import { describe, expect, it } from 'vitest';
import { accountsOf, findWaves, nameKind, WAVE, type Account } from './swarm';

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 4, 3, 0);
const hex = (n: number) => `u${(n * 2654435761 + 0x1a2b3c4d5e).toString(16).padStart(12, '0').slice(-12)}`;
const acct = (user: string, minutesAgo: number, files = 1): Account => ({ user, first: NOW - minutesAgo * MIN, files });

describe('names no person types', () => {
  it('recognises a letter and a run of hex digits', () => {
    expect(nameKind('u3f9a1c07be2d')).toBe('u:12');
    expect(nameKind('9a1c07be2d4f81')).toBe('-:14');
  });
  it('leaves people alone', () => {
    for (const n of ['936442997', 'MusicMan2000', 'soularr_7c371d6567', 'dom2015', 'deadbeef', 'abcdefabcdef', '0123456789012']) expect(nameKind(n)).toBeNull();
  });
});

describe('a wave of new accounts', () => {
  const wave = (n: number, spread = 30) => Array.from({ length: n }, (_, i) => acct(hex(i + 1), (i * spread) / n));

  it('is several accounts of one kind of name inside an hour', () => {
    const w = findWaves(wave(WAVE.accounts), {}, NOW);
    expect(w).toHaveLength(1);
    expect(w[0].users).toHaveLength(WAVE.accounts);
    expect(w[0].kind).toBe('u:12');
  });

  it('needs more than a few accounts', () => {
    expect(findWaves(wave(WAVE.accounts - 1), {}, NOW)).toEqual([]);
  });

  it('needs them close in time', () => {
    expect(findWaves(wave(WAVE.accounts, 24 * 60), {}, NOW)).toEqual([]);
  });

  it('ignores accounts that took a lot, and names of people', () => {
    const heavy = Array.from({ length: 8 }, (_, i) => acct(hex(i + 1), i, 400));
    const people = ['anna', 'bob99', 'carol_x', 'dave', 'erin', 'frank'].map((n, i) => acct(n, i));
    expect(findWaves([...heavy, ...people], {}, NOW)).toEqual([]);
  });

  it('keeps the kinds apart', () => {
    const other = Array.from({ length: 3 }, (_, i) => acct(`k${hex(i + 50).slice(1)}x`.slice(0, 11) + 'ab', i));
    const w = findWaves([...wave(WAVE.accounts), ...other], {}, NOW);
    expect(w).toHaveLength(1);
    expect(w[0].users.every((u) => u.startsWith('u'))).toBe(true);
  });

  it('blocks a lone newcomer of a kind that had a wave this week', () => {
    const lone = [acct(hex(99), 5)];
    expect(findWaves(lone, {}, NOW)).toEqual([]);
    expect(findWaves(lone, { 'u:12': NOW - 2 * 24 * 60 * MIN }, NOW)).toHaveLength(1);
    expect(findWaves(lone, { 'u:12': NOW - 30 * 24 * 60 * MIN }, NOW)).toEqual([]);
  });
});

describe('accounts from the uploads list', () => {
  it('counts files and finds when each account first asked', () => {
    const at = (min: number) => new Date(NOW - min * MIN).toISOString();
    const file = (min: number) => ({ requestedAt: at(min) });
    const users = [{ username: 'u3f9a1c07be2d', directories: [{ directory: 'd', fileCount: 2, files: [file(10), file(30)] }] }, { username: 'empty', directories: [] }];
    expect(accountsOf(users as never)).toEqual([{ user: 'u3f9a1c07be2d', first: NOW - 30 * MIN, files: 2 }]);
  });
});
