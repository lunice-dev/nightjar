import { describe, expect, it } from 'vitest';
import type { Transfer, TransferUser } from '../api/types';
import type { DownloadPlan } from '../prefs';
import { groupDownloads, planFinder } from './transfers';

const DIR = 'Labels1\\Vision\\[VSN173] VISION and Noisia - 20 Years of VISION (2025)';
const track = (n: number) => `${DIR}\\${String(n).padStart(2, '0')}-vision.flac`;

const plan = {
  id: 'p1',
  key: `vpeter\u0000${DIR}`,
  title: '20 Years of VISION',
  destination: 'VSN173',
  tracks: [1, 2, 3, 4].map((n) => ({ name: track(n), size: 10, username: 'vpeter', filename: track(n), failedBy: [] })),
  sources: [],
  identical: [],
  batches: ['b1'],
  notes: [],
  createdAt: 1,
  expected: 4,
} as unknown as DownloadPlan;

const transfer = (n: number, batchId: string | undefined, file = track(n)): Transfer =>
  ({ id: `t${n}${batchId ?? ''}`, username: 'vpeter', filename: file, size: 10, state: 'Completed, Succeeded', bytesTransferred: 10, averageSpeed: 1, requestedAt: '2026-10-25T21:00:00Z', batchId }) as unknown as Transfer;

const users = (files: Transfer[]): TransferUser[] => [{ username: 'vpeter', directories: [{ directory: DIR, files }] }] as unknown as TransferUser[];

describe('an album interrupted by a restart', () => {
  // Tracks 1-2 arrived with the album's batch; slskd asked again for 3-4 after restarting, with no batch.
  const files = [transfer(1, 'b1'), transfer(2, 'b1'), transfer(3, undefined), transfer(4, undefined), transfer(9, undefined, `${DIR}\\cover.jpg`)];

  it('stays one album in Downloads, complete', () => {
    const groups = groupDownloads(users(files), [plan]);
    expect(groups).toHaveLength(1);
    expect(groups[0].plan?.id).toBe('p1');
    expect(groups[0].files.filter((f) => f.filename.endsWith('.flac'))).toHaveLength(4);
  });

  it('finds the album for re-asked tracks and their folder’s other files', () => {
    const find = planFinder([plan]);
    expect(find(transfer(3, undefined))?.id).toBe('p1');
    expect(find(transfer(9, undefined, `${DIR}\\cover.jpg`))?.id).toBe('p1');
  });

  it('leaves other folders and other albums’ batches alone', () => {
    const find = planFinder([plan]);
    expect(find(transfer(1, undefined, 'Other\\Folder\\01.flac'))).toBeUndefined();
    const other = { ...plan, id: 'p2', batches: ['b2'], createdAt: 2 } as DownloadPlan;
    expect(planFinder([plan, other])(transfer(1, 'b1'))?.id).toBe('p1');
  });
});
