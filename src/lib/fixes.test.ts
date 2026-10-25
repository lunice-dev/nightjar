import { describe, expect, it } from 'vitest';
import { mergeShared } from '../prefs';
import { speed } from './quality';
import { relocated } from './useLocal';
import { changedSize, failureReason } from './smart';

const saved = (state: Record<string, unknown>) => JSON.stringify({ state, version: 3 });
const plan = (id: string, batches: number, createdAt: number) => ({ id, batches: Array(batches).fill('b'), notes: [], createdAt, tracks: [] });

describe('speeds', () => {
  it('never prints a fraction of a byte', () => {
    expect(speed(0.123456789)).toBe('under 1 KB/s');
    expect(speed(512.333)).toBe('under 1 KB/s');
    expect(speed(2048)).toBe('2.0 KB/s');
    expect(speed(0)).toBe('—');
  });
});

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

  it('leaves this copy alone when there is nothing new', () => {
    const pc = saved({ plans: [plan('a', 1, 1)] });
    expect(mergeShared(pc, pc)).toBe(pc);
    expect(mergeShared(pc, null)).toBe(pc);
  });
});

describe('downloads put in the library', () => {
  const moves = { 'c:\\dl\\pilot talk ii': 'C:\\Music\\FLAC\\Curren$y\\2010 - Pilot Talk II', 'c:\\dl\\undone': 'C:\\dl\\Undone' };
  it('finds a file, and a disc folder, in the album’s new place', () => {
    expect(relocated('C:\\dl\\Pilot Talk II\\01 - Airborne Aquarium.flac', moves)).toBe('C:\\Music\\FLAC\\Curren$y\\2010 - Pilot Talk II\\01 - Airborne Aquarium.flac');
    expect(relocated('C:\\dl\\Pilot Talk II\\CD2\\01.flac', moves)).toBe('C:\\Music\\FLAC\\Curren$y\\2010 - Pilot Talk II\\CD2\\01.flac');
  });
  it('leaves files that never moved, or were moved back', () => {
    expect(relocated('C:\\dl\\Other\\01.flac', moves)).toBeUndefined();
    expect(relocated('C:\\dl\\Undone\\01.flac', moves)).toBeUndefined();
  });
});

describe('a copy that changed since the search', () => {
  const t = { state: 'Completed, Aborted', exception: 'Transfer aborted: the remote size of 22666345 does not match expected size 22666209' };
  it('says so in plain words, and knows the new size', () => {
    expect(failureReason(t)).toBe('Their copy changed since the search');
    expect(changedSize(t)).toBe(22666345);
  });
});
