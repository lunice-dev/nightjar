import { describe, expect, it } from 'vitest';
import { parkedRetries, tidyUploads, uploadKey, uploadReason } from './uploads';
import type { TransferUser } from '../api/types';

describe('a file someone asks for again after it failed', () => {
  const user = (files: { id: string; filename: string; state: string }[]) =>
    [{ username: 'nothery222', directories: [{ directory: 'd', files }] }] as unknown as TransferUser[];

  it('clears the old failed entry, so the retry can start', async () => {
    const removed: string[] = [];
    const backend = { cancel: async (_d: string, _u: string, id: string) => void removed.push(id) } as never;
    const n = await tidyUploads(backend, user([
      { id: 'old', filename: 'd\\13.flac', state: 'Completed, Errored' },
      { id: 'new', filename: 'd\\13.flac', state: 'Queued, Locally' },
      { id: 'done', filename: 'd\\12.flac', state: 'Completed, Succeeded' },
      { id: 'lone', filename: 'd\\14.flac', state: 'Completed, Errored' },
    ]));
    expect(n).toBe(1);
    expect(removed).toEqual(['old']);
    expect(parkedRetries.has(uploadKey('nothery222', 'd\\13.flac'))).toBe(true);
  });
});

const r = (state: string, exception?: string) => uploadReason({ state, exception } as never);

describe('why an upload didn’t go through', () => {
  it('says whose side it was when that is clear, without alarm', () => {
    expect(r('Completed, Errored', 'Remote connection closed')).toMatchObject({ text: expect.stringMatching(/^Their side stopped it/), ours: false });
    expect(r('Completed, Errored', 'Failed to read 4096 bytes from 1.2.3.4:5: Remote connection closed')?.text).toMatch(/^Their side/);
    expect(r('Completed, Errored', 'User jirayang appears to be offline')?.text).toBe('They went offline');
    expect(r('Completed, Rejected', 'Transfer rejected: Cancelled')?.text).toBe('They cancelled it');
    expect(r('Completed, TimedOut')?.text).toBe('They didn’t start it in time');
  });

  it('stays neutral when either side could be the cause', () => {
    const c = r('Completed, Errored', 'Failed to establish a direct or indirect message connection to nothery222 (89.187.187.67:63983)');
    expect(c?.text).toMatch(/^Couldn’t connect to them/);
    expect(c?.ours).toBe(false);
    expect(c?.detail).toContain('nothery222');
  });

  it('marks only a problem on this computer as ours', () => {
    expect(r('Completed, Errored', 'Could not find file C:\\Music\\a.flac')?.ours).toBe(true);
    expect(r('Completed, Cancelled', 'The operation was canceled.')).toMatchObject({ text: expect.stringMatching(/^Stopped on this computer/), ours: false });
  });

  it('says nothing about uploads that went fine or are still going', () => {
    expect(r('Completed, Succeeded')).toBeNull();
    expect(r('InProgress')).toBeNull();
  });
});
