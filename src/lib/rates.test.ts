import { beforeEach, describe, expect, it } from 'vitest';
import { resetRates, sourceRates, type Delivered } from './rates';

const MB = 1024 * 1024;

beforeEach(() => resetRates());

/**
 * Two people sending an album: anna at 2 MB/s, bert at 1 MB/s, each moving on to a new 6 MB track whenever the last
 * one is done, snapshots every half second like the downloads list's refreshes.
 */
function steadyAlbum(seconds: number) {
  const snapshots: { at: number; files: Delivered[] }[] = [];
  for (let t = 0; t <= seconds * 1000; t += 500) {
    const files: Delivered[] = [];
    for (const [user, mbps] of [['anna', 2], ['bert', 1]] as const) {
      const sent = (t / 1000) * mbps * MB;
      const track = Math.floor(sent / (6 * MB));
      for (let k = 0; k <= track; k++) files.push({ id: `${user}-${k}`, username: user, bytes: Math.min(6 * MB, sent - k * 6 * MB) });
    }
    snapshots.push({ at: 100_000 + t, files });
  }
  return snapshots;
}

describe('speed per source', () => {
  it('says nothing until there are a couple of seconds to measure', () => {
    expect(sourceRates('a', [{ id: '1', username: 'anna', bytes: 0 }], 1000)).toBeNull();
    expect(sourceRates('a', [{ id: '1', username: 'anna', bytes: MB }], 2000)).toBeNull();
  });

  it('measures each person, and the total holds steady while tracks change', () => {
    let last: Map<string, number> | null = null;
    const totals: number[] = [];
    for (const s of steadyAlbum(30)) {
      last = sourceRates('album', s.files, s.at);
      if (last && s.at - 100_000 >= 8000) totals.push([...last.values()].reduce((n, v) => n + v, 0));
    }
    expect(last!.get('anna')! / MB).toBeCloseTo(2, 1);
    expect(last!.get('bert')! / MB).toBeCloseTo(1, 1);
    // Every reading once the window is full is the real 3 MB/s, though tracks start and finish all through it.
    for (const t of totals) expect(t / MB).toBeCloseTo(3, 1);
  });

  it('a source that stops goes to zero within the window', () => {
    sourceRates('b', [{ id: '1', username: 'carl', bytes: 0 }], 0);
    sourceRates('b', [{ id: '1', username: 'carl', bytes: 4 * MB }], 2000);
    sourceRates('b', [{ id: '1', username: 'carl', bytes: 4 * MB }], 9000);
    expect(sourceRates('b', [{ id: '1', username: 'carl', bytes: 4 * MB }], 16000)!.get('carl')).toBe(0);
  });

  it('a track that started over elsewhere never counts as negative', () => {
    sourceRates('c', [{ id: 'x', username: 'dora', bytes: 5 * MB }], 0);
    const r = sourceRates('c', [{ id: 'x', username: 'dora', bytes: MB }], 2000)!;
    expect(r.get('dora')).toBeGreaterThanOrEqual(0);
  });

  it('keeps albums apart', () => {
    sourceRates('one', [{ id: '1', username: 'anna', bytes: 0 }], 0);
    sourceRates('two', [{ id: '2', username: 'anna', bytes: 0 }], 0);
    expect(sourceRates('one', [{ id: '1', username: 'anna', bytes: 2 * MB }], 2000)!.get('anna')! / MB).toBeCloseTo(1, 1);
    expect(sourceRates('two', [{ id: '2', username: 'anna', bytes: 8 * MB }], 2000)!.get('anna')! / MB).toBeCloseTo(4, 1);
  });
});
