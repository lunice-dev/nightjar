import { describe, expect, it } from 'vitest';
import type { DownloadPlan } from '../prefs';
import { mergeDuplicatePlans, sameRelease } from './plans';

describe('the same album from someone else’s copy', () => {
  it('is the same title and artist however the folders are named', () => {
    expect(sameRelease({ title: 'Convocations', artist: 'Sufjan Stevens' }, { title: 'Convocations (2021)', artist: 'sufjan stevens' })).toBe(true);
    expect(sameRelease({ title: 'Mint Jams [FLAC 24]', artist: 'Casiopea' }, { title: 'MINT JAMS', artist: 'Casiopea' })).toBe(true);
  });
  it('lets the title decide when one folder doesn’t name the artist', () => {
    expect(sameRelease({ title: 'Convocations', artist: '' }, { title: 'Convocations', artist: 'Sufjan Stevens' })).toBe(true);
  });
  it('keeps other albums and other editions apart', () => {
    expect(sameRelease({ title: 'Convocations', artist: 'Sufjan Stevens' }, { title: 'Carrie & Lowell', artist: 'Sufjan Stevens' })).toBe(false);
    expect(sameRelease({ title: 'Pocket Park', artist: 'Miki Matsubara' }, { title: 'Pocket Park (2023 Mix)', artist: 'Miki Matsubara' })).toBe(false);
    expect(sameRelease({ title: 'Greatest Hits', artist: 'Queen' }, { title: 'Greatest Hits', artist: 'ABBA' })).toBe(false);
    expect(sameRelease({ title: '', artist: 'Queen' }, { title: '', artist: 'Queen' })).toBe(false);
  });
});

const plan = (id: string, createdAt: number, extra: Partial<DownloadPlan> = {}) =>
  ({ id, key: 'anna\u0000Shared\\A', destination: 'An Artist - An Album', createdAt, batches: [`b-${id}`], notes: [], tracks: [{ name: 'x', size: 1, username: 'anna', filename: 'Shared\\A\\01.flac', failedBy: [] }], ...extra }) as unknown as DownloadPlan;

describe('the same album asked for twice', () => {
  it('becomes one plan with both sets of batches', () => {
    const out = mergeDuplicatePlans([plan('b', 2_000_000), plan('a', 1_000_000)]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('a');
    expect(out[0].batches).toEqual(['b-a', 'b-b']);
    expect(out[0].tracks).toHaveLength(1);
  });
  it('is unfinished while either one is', () => {
    expect(mergeDuplicatePlans([plan('a', 1_000_000, { finishedAt: 5 }), plan('b', 2_000_000)])[0].finishedAt).toBeUndefined();
  });
  it('keeps a finished download and a new one of the same album apart', () => {
    expect(mergeDuplicatePlans([plan('a', 1_000_000, { finishedAt: 5 }), plan('b', 2_000_000)])).toHaveLength(2);
  });
  it('leaves an album downloaded again much later, or somewhere else, alone', () => {
    expect(mergeDuplicatePlans([plan('a', 0), plan('b', 10 * 3_600_000)])).toHaveLength(2);
    expect(mergeDuplicatePlans([plan('a', 0), plan('b', 1000, { destination: 'Another folder' })])).toHaveLength(2);
  });
});
