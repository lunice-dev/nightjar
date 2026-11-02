import { beforeEach, describe, expect, it } from 'vitest';
import type { Transfer, TransferUser } from '../api/types';
import { usePrefs, type DownloadPlan } from '../prefs';
import { useStore } from '../store';
import { alreadyThere, existingDestination } from './folderDest';
import { hasUnknownBatch } from './transfers';

const DL = 'C:\\Music\\FLAC\\UNSORTED';
const FOLDER = 'Shared\\An Artist\\An Album (2026)';
const file = (n: number) => `${FOLDER}\\${String(n).padStart(2, '0')}. Track.flac`;
const tr = (id: string, n: number, extra: Partial<Transfer> = {}): Transfer =>
  ({ id, username: 'anna', filename: file(n), size: 100, state: 'Completed, Succeeded', requestedAt: new Date().toISOString(), ...extra }) as unknown as Transfer;
const users = (files: Transfer[]) => [{ username: 'anna', directories: [{ directory: FOLDER, files }] }] as unknown as TransferUser[];

const setUp = (opts: { plans?: DownloadPlan[]; downloads?: TransferUser[]; paths?: Record<string, string>; onDisk?: { path: string; size: number }[] } = {}) => {
  usePrefs.setState({ plans: opts.plans ?? [], finished: [] });
  useStore.setState({
    local: { downloadDir: DL, roots: [] },
    downloads: opts.downloads ?? [],
    backend: {
      localFiles: async () => new Map(Object.entries(opts.paths ?? {})),
      library: { tracks: async () => (opts.onDisk ? { dir: '', tracks: opts.onDisk } : null) },
    } as never,
  });
};

describe('where more of an album goes', () => {
  beforeEach(() => setUp());

  it('uses the album’s own folder when it has a plan', async () => {
    const plan = { id: 'p', destination: 'An Artist - An Album (2026)', createdAt: 1, batches: [], tracks: [{ name: file(1), size: 100, username: 'anna', filename: file(1), failedBy: [] }] } as unknown as DownloadPlan;
    setUp({ plans: [plan] });
    expect(await existingDestination('anna', file(13))).toBe('An Artist - An Album (2026)');
  });

  it('follows the files already downloaded from that folder', async () => {
    const home = 'An Artist - An Album (2026)';
    setUp({
      downloads: users([tr('a', 1), tr('b', 2), tr('c', 3, { state: 'Completed, Rejected' })]),
      paths: { a: `${DL}\\${home}\\01. Track.flac`, b: `${DL}\\${home}\\02. Track.flac` },
    });
    expect(await existingDestination('anna', file(13))).toBe(home);
  });

  it('knows nothing about a folder it never saw', async () => {
    expect(await existingDestination('anna', file(13))).toBeUndefined();
  });
});

describe('what is already in the folder', () => {
  it('leaves out tracks with the same name and size, not a different file with the same name', async () => {
    setUp({ onDisk: [{ path: `${DL}\\Album\\01. Track.flac`, size: 100 }, { path: `${DL}\\Album\\02. Track.flac`, size: 999 }] });
    const files = [1, 2, 3].map((n) => ({ filename: file(n), size: 100 }));
    const there = await alreadyThere('anna', files, 'Album');
    expect(there.map((f) => f.filename)).toEqual([file(1)]);
  });

  it('asks for everything when the folder can’t be read', async () => {
    setUp();
    expect(await alreadyThere('anna', [{ filename: file(1), size: 100 }], 'Album')).toEqual([]);
  });
});

describe('an album another device just started', () => {
  const plan = (batch: string) => ({ id: 'p', batches: [batch], tracks: [], createdAt: 1 }) as unknown as DownloadPlan;
  it('is noticed when its batch is new here', () => {
    expect(hasUnknownBatch(users([tr('a', 1, { batchId: 'new' })]), [plan('old')])).toBe(true);
  });
  it('is not when this device knows the batch, or the download is old', () => {
    expect(hasUnknownBatch(users([tr('a', 1, { batchId: 'old' })]), [plan('old')])).toBe(false);
    const longAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(hasUnknownBatch(users([tr('a', 1, { batchId: 'new', requestedAt: longAgo })]), [plan('old')])).toBe(false);
  });
});
