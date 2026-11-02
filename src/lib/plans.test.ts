import { describe, expect, it } from 'vitest';
import type { DownloadPlan } from '../prefs';
import { mergeDuplicatePlans } from './plans';

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
  it('leaves an album downloaded again much later, or somewhere else, alone', () => {
    expect(mergeDuplicatePlans([plan('a', 0), plan('b', 10 * 3_600_000)])).toHaveLength(2);
    expect(mergeDuplicatePlans([plan('a', 0), plan('b', 1000, { destination: 'Another folder' })])).toHaveLength(2);
  });
});
