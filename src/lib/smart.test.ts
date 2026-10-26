import { describe, expect, it } from 'vitest';
import { albumSize, changedSize, failureReason } from './smart';

describe('the size of an album that had phantom twins', () => {
  const k = (path: string, size: number, dropped = false) => ({ name: path, size, dropped }) as never;
  it('leaves the dropped twins out of the count', () => {
    // 3 real tracks in disc folders, the same 3 queued again flat (dropped), counted as 6 when started.
    const tracks = [k('A\\CD 01\\01.flac', 1), k('A\\CD 01\\02.flac', 2), k('A\\CD 02\\01.flac', 3), k('A\\01.flac', 1, true), k('A\\02.flac', 2, true), k('A\\01.flac', 3, true)];
    expect(albumSize({ expected: 6, tracks })).toBe(3);
  });
  it('still counts tracks someone really doesn’t share', () => {
    expect(albumSize({ expected: 12, tracks: [k('A\\01.flac', 1), k('A\\02.flac', 2)] })).toBe(12);
  });
});

describe('a copy that changed since the search', () => {
  const t = { state: 'Completed, Aborted', exception: 'Transfer aborted: the remote size of 22666345 does not match expected size 22666209' };
  it('says so in plain words, and knows the new size', () => {
    expect(failureReason(t)).toBe('Their copy changed since the search');
    expect(changedSize(t)).toBe(22666345);
  });
});
