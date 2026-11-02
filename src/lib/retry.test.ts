import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transfer, TransferUser } from '../api/types';
import { usePrefs, type DownloadPlan } from '../prefs';
import { useStore } from '../store';
import { manageDownloads, RETRY_DELAYS } from './smart';

const DIR = 'Music\\Artist\\Album';
const FILE = `${DIR}\\01 - Song.flac`;

const failed = (exception: string): Transfer =>
  ({ id: 't1', username: 'bob', filename: FILE, size: 100, state: 'Completed, Errored', exception, bytesTransferred: 10, averageSpeed: 1, requestedAt: '2026-11-02T10:00:00Z', batchId: 'b1' }) as unknown as Transfer;

const setUp = (t: Transfer) => {
  const backend = { cancel: vi.fn(async (..._a: unknown[]) => undefined), enqueue: vi.fn(async (..._a: unknown[]) => undefined) };
  const plan = {
    id: 'p1',
    key: `bob\u0000${DIR}`,
    title: 'Album',
    destination: 'Album',
    tracks: [{ name: FILE, size: 100, username: 'bob', filename: FILE, failedBy: [] }],
    sources: [],
    identical: [],
    batches: ['b1'],
    notes: [],
    createdAt: Date.now(),
    expected: 1,
  } as unknown as DownloadPlan;
  usePrefs.setState({ plans: [plan], smart: { enabled: true, queueMinutes: 10, parallel: true } });
  useStore.setState({
    backend: backend as never,
    downloads: [{ username: 'bob', directories: [{ directory: DIR, files: [t] }] }] as unknown as TransferUser[],
    refreshTransfers: (() => undefined) as never,
  });
  return backend;
};

describe('a failure that usually passes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is asked for again from the same person after a wait, and the wait grows', async () => {
    const backend = setUp(failed('Remote connection closed'));
    await manageDownloads();
    // First it only plans the try: nothing is sent yet.
    expect(backend.enqueue).not.toHaveBeenCalled();
    expect(usePrefs.getState().plans[0].tracks[0].retryAt).toBeGreaterThan(Date.now());

    vi.advanceTimersByTime(RETRY_DELAYS[0] + 1000);
    await manageDownloads();
    expect(backend.cancel).toHaveBeenCalledWith('download', 'bob', 't1', true);
    expect(backend.enqueue).toHaveBeenCalledTimes(1);
    expect(backend.enqueue.mock.calls[0][0]).toBe('bob');
    const track = usePrefs.getState().plans[0].tracks[0];
    expect(track.attempts).toBe(1);
    expect(track.retryAt).toBeUndefined();

    // It fails again: the next try waits longer.
    setUp(failed('Remote connection closed'));
    usePrefs.setState((s) => ({ plans: s.plans.map((p) => ({ ...p, tracks: p.tracks.map((k) => ({ ...k, attempts: 1 })) })) }));
    await manageDownloads();
    const next = usePrefs.getState().plans[0].tracks[0].retryAt!;
    expect(next - Date.now()).toBe(RETRY_DELAYS[1]);
  });

  it('leaves a file alone when they simply don’t share it any more', async () => {
    const backend = setUp(failed('File not shared.'));
    await manageDownloads();
    vi.advanceTimersByTime(RETRY_DELAYS[0] * 10);
    await manageDownloads();
    expect(backend.enqueue).not.toHaveBeenCalled();
  });
});