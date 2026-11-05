import { describe, expect, it } from 'vitest';
import type { LibAlbum, RecentMove, WaitingAlbum } from '../api/library';
import type { FinishedAlbum } from '../prefs';
import { recentAlbums } from './recentAlbums';

const DL = 'C:\\Music\\Downloads';
const done = (title: string, at: number, dir?: string): FinishedAlbum => ({ key: `k-${title}`, title, artist: 'Band', dir, size: 1, tracks: 5, from: ['anna'], at });
const waiting = (name: string, at: number): WaitingAlbum => ({ dir: `${DL}\\${name}`, name, tracks: 8, size: 100, at });
const base = { history: [] as FinishedAlbum[], waiting: [] as WaitingAlbum[], moved: [] as RecentMove[], live: new Set<string>(), comingDirs: [] as string[], relocate: (d: string) => d, library: new Map<string, LibAlbum>(), limit: 16 };

describe('recently added', () => {
  it('shows an album waiting in the downloads folder that the history never recorded', () => {
    const rows = recentAlbums({ ...base, history: [done('Old', 1000)], waiting: [waiting('Dijon - Baby (2023)', 5000)] });
    expect(rows.map((r) => r.h.title)).toEqual(['Baby', 'Old']);
    expect(rows[0].h.artist).toBe('Dijon');
  });

  it('shows an album put in the library lately that the history never recorded', () => {
    const lib = new Map([['c:\\music\\library\\flac\\band\\2020 - new', { dir: 'C:\\Music\\Library\\FLAC\\Band\\2020 - New', album: 'New', artist: 'Band', size: 5 } as LibAlbum]]);
    const rows = recentAlbums({ ...base, moved: [{ id: 'm', from: `${DL}\\New`, to: 'C:\\Music\\Library\\FLAC\\Band\\2020 - New', at: 9000 } as RecentMove], library: lib });
    expect(rows[0].h.title).toBe('New');
    expect(rows[0].a?.album).toBe('New');
  });

  it('shows an album once however many places know it', () => {
    const rows = recentAlbums({ ...base, history: [done('Baby', 4000, `${DL}\\Baby`)], waiting: [waiting('Baby', 4100)] });
    expect(rows).toHaveLength(1);
  });

  it('leaves out an album that is still coming', () => {
    const rows = recentAlbums({ ...base, waiting: [waiting('Baby', 4100)], comingDirs: [`${DL}\\Baby`] });
    expect(rows).toHaveLength(0);
    expect(recentAlbums({ ...base, history: [done('Baby', 4000)], live: new Set(['k-Baby']) })).toHaveLength(0);
  });

  it('keeps the newest sixteen', () => {
    const history = Array.from({ length: 30 }, (_, i) => done(`A${i}`, i));
    expect(recentAlbums({ ...base, history }).map((r) => r.h.title)[0]).toBe('A29');
    expect(recentAlbums({ ...base, history })).toHaveLength(16);
  });
});
