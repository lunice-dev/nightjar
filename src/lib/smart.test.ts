import { describe, expect, it } from 'vitest';
import { changedSize, failureReason } from './smart';

describe('a copy that changed since the search', () => {
  const t = { state: 'Completed, Aborted', exception: 'Transfer aborted: the remote size of 22666345 does not match expected size 22666209' };
  it('says so in plain words, and knows the new size', () => {
    expect(failureReason(t)).toBe('Their copy changed since the search');
    expect(changedSize(t)).toBe(22666345);
  });
});
