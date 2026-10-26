import { describe, expect, it } from 'vitest';
import { mergeShared } from './prefs';

const saved = (state: Record<string, unknown>) => JSON.stringify({ state, version: 3 });
const plan = (id: string, batches: number, createdAt: number) => ({ id, batches: Array(batches).fill('b'), notes: [], createdAt, tracks: [] });

describe('preferences shared by two devices', () => {
  it('keeps the albums each device started', () => {
    const pc = saved({ plans: [plan('a', 1, 1)], sent: [] });
    const phone = saved({ plans: [plan('b', 1, 2)], sent: [] });
    const merged = JSON.parse(mergeShared(pc, phone));
    expect(merged.state.plans.map((p: { id: string }) => p.id)).toEqual(['b', 'a']);
  });

  it('takes the copy of a plan that has seen more', () => {
    const pc = saved({ plans: [plan('a', 1, 1)] });
    const phone = saved({ plans: [plan('a', 3, 1)] });
    expect(JSON.parse(mergeShared(pc, phone)).state.plans[0].batches).toHaveLength(3);
    // and never goes back to the older one
    expect(mergeShared(phone, pc)).toBe(phone);
  });

  it('follows albums moved into the library on the other device', () => {
    const pc = saved({ plans: [], moves: {} });
    const phone = saved({ plans: [], moves: { 'c:\\dl\\x': 'C:\\Music\\X' } });
    expect(JSON.parse(mergeShared(pc, phone)).state.moves).toEqual({ 'c:\\dl\\x': 'C:\\Music\\X' });
  });

  it('keeps a quality check made on the other device, the newer one winning', () => {
    const pc = saved({ plans: [], checks: { 'c:\\a': { verdict: 'Lossless', at: 5 } } });
    const phone = saved({ plans: [], checks: { 'c:\\a': { verdict: 'Old', at: 1 }, 'c:\\b': { verdict: 'Verified hi-res', at: 3 } } });
    const merged = JSON.parse(mergeShared(pc, phone)).state.checks;
    expect(merged['c:\\a'].verdict).toBe('Lossless');
    expect(merged['c:\\b'].verdict).toBe('Verified hi-res');
  });

  it('leaves this copy alone when there is nothing new', () => {
    const pc = saved({ plans: [plan('a', 1, 1)] });
    expect(mergeShared(pc, pc)).toBe(pc);
    expect(mergeShared(pc, null)).toBe(pc);
  });
});
