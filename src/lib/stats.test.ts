import { describe, expect, it } from 'vitest';
import type { Transfer } from '../api/types';
import { change, failureReasons, heat, records, series, toRows, topPeople, totals } from './stats';

const T0 = Date.parse('2026-03-02T10:00:00Z');
const tr = (extra: Partial<Transfer>): Transfer =>
  ({
    id: 'x', username: 'anna', filename: 'Shared\\A\\B\\01. Song.flac', size: 1000, state: 'Completed, Succeeded',
    bytesTransferred: 1000, averageSpeed: 500, percentComplete: 100, requestedAt: new Date(T0).toISOString(),
    enqueuedAt: new Date(T0).toISOString(), startedAt: new Date(T0 + 60_000).toISOString(), endedAt: new Date(T0 + 62_000).toISOString(),
    ...extra,
  }) as unknown as Transfer;

describe('statistics rows', () => {
  it('skips what is still going and keeps the file type', () => {
    const rows = toRows([tr({}), tr({ state: 'InProgress' })], 'in');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ext: 'flac', ok: true, bytes: 1000, wait: 60_000 });
  });

  it('ignores a speed that cannot be true', () => {
    const [r] = toRows([tr({ averageSpeed: -7e9 })], 'in');
    expect(r.speed).toBeGreaterThanOrEqual(0);
    expect(r.speed).toBeLessThan(1e9);
  });

  it('counts failures by reason', () => {
    const rows = toRows([tr({ state: 'Completed, TimedOut' }), tr({ state: 'Completed, Cancelled' }), tr({ state: 'Completed, Errored', exception: 'Read timed out' })], 'in');
    expect(failureReasons(rows).map((x) => x.why).sort()).toEqual(['Cancelled', 'Timed out']);
    expect(totals(rows)).toMatchObject({ files: 0, failed: 3, failRate: 1 });
  });
});

describe('statistics numbers', () => {
  const rows = toRows([tr({}), tr({ username: 'bo', size: 4000, bytesTransferred: 4000 }), tr({ state: 'Completed, Errored' })], 'in');
  it('adds up what arrived', () => {
    expect(totals(rows)).toMatchObject({ files: 2, bytes: 5000, failed: 1, people: 2 });
  });
  it('ranks people by size, and finds the records', () => {
    expect(topPeople(rows)[0].person).toBe('bo');
    expect(records(rows).biggest?.bytes).toBe(4000);
  });
  it('spreads rows over the slices of a period', () => {
    const s = series(rows, T0 - 1000, T0 + 100_000, 4, 'files');
    expect(s.reduce((a, b) => a + b, 0)).toBe(2);
  });
  it('fills the weekday and hour grid', () => {
    expect(heat(rows).flat().reduce((a, b) => a + b, 0)).toBe(2);
  });
  it('compares with the period before', () => {
    expect(change(150, 100)).toEqual({ text: '+50%', up: true });
    expect(change(5, 0)).toBeNull();
  });
});
