import { beforeEach, describe, expect, it } from 'vitest';
import type { Backend } from '../api/backend';
import type { Transfer, TransferUser } from '../api/types';
import { useStore } from '../store';
import { enqueueOnce, forgetRecent } from './ask';

const FOLDER = 'Shared\\An Artist\\An Album';
const file = (n: number) => ({ filename: `${FOLDER}\\0${n}. Track.flac`, size: 100 });
const live = (n: number, state: string) =>
  ({ id: `t${n}`, username: 'anna', filename: file(n).filename, size: 100, state }) as unknown as Transfer;
const withDownloads = (files: Transfer[]) =>
  useStore.setState({ downloads: [{ username: 'anna', directories: [{ directory: FOLDER, files }] }] as unknown as TransferUser[] });

describe('asking for files', () => {
  const asked: string[][] = [];
  const backend = { enqueue: async (_u: string, files: { filename: string }[]) => void asked.push(files.map((f) => f.filename)) } as unknown as Backend;
  beforeEach(() => {
    asked.length = 0;
    forgetRecent();
    withDownloads([]);
  });

  it('asks for what is not coming yet', async () => {
    expect(await enqueueOnce(backend, 'anna', [file(1), file(2)])).toHaveLength(2);
    expect(asked).toHaveLength(1);
  });

  it('leaves out files already coming or waiting, but not failed ones', async () => {
    withDownloads([live(1, 'InProgress'), live(2, 'Queued, Remotely'), live(3, 'Completed, TimedOut')]);
    const sent = await enqueueOnce(backend, 'anna', [file(1), file(2), file(3), file(4)]);
    expect(sent.map((f) => f.filename)).toEqual([file(3).filename, file(4).filename]);
  });

  it('does not ask twice within a moment, and asks again if the first try failed', async () => {
    await enqueueOnce(backend, 'anna', [file(1)]);
    expect(await enqueueOnce(backend, 'anna', [file(1)])).toEqual([]);
    forgetRecent();
    const broken = { enqueue: async () => { throw new Error('offline'); } } as unknown as Backend;
    await expect(enqueueOnce(broken, 'anna', [file(2)])).rejects.toThrow();
    expect(await enqueueOnce(backend, 'anna', [file(2)])).toHaveLength(1);
  });
});
