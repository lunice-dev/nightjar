import { beforeEach, describe, expect, it } from 'vitest';
import type { Backend } from '../api/backend';
import { usePrefs } from '../prefs';
import { useStore } from '../store';
import type { FolderResult, Release } from './quality';
import { smartDownload } from './smart';

const DIR = 'Music\\Korn\\Issues (1999)';
const names = Array.from({ length: 8 }, (_, i) => `${DIR}\\${String(i + 1).padStart(2, '0')} - Track ${i + 1}.flac`);

const copy = (username: string): FolderResult =>
  ({
    key: `${username}\u0000${DIR}`,
    username,
    folder: DIR,
    title: 'Issues',
    parent: 'Korn',
    tier: 'lossless',
    files: names.map((filename, i) => ({ filename, size: 1000 + i })),
    audio: names.map((filename, i) => ({ filename, size: 1000 + i })),
    uploadSpeed: 5_000_000,
    hasFreeUploadSlot: true,
    queueLength: 0,
  }) as unknown as FolderResult;

/** A pretend engine: who can't be reached, and who was asked for what. */
function engine(unreachable: string[]) {
  const asked: { user: string; files: string[] }[] = [];
  const backend = {
    folderContents: async () => null,
    enqueue: async (user: string, files: { filename: string }[]) => {
      if (unreachable.includes(user)) throw new Error(`Failed to connect to ${user}`);
      asked.push({ user, files: files.map((f) => f.filename) });
    },
    transfers: async () => [],
  } as unknown as Backend;
  useStore.setState({ backend, toast: () => undefined, refreshTransfers: async () => undefined, speeds: new Map() } as never);
  return asked;
}

const release = (...sources: FolderResult[]) => ({ key: 'korn|issues', best: sources[0], sources }) as unknown as Release;

describe('starting a download when someone can’t be reached', () => {
  beforeEach(() => usePrefs.setState({ plans: [], smart: { enabled: true, queueMinutes: 10, parallel: true } }));

  it('gives the chosen person’s tracks to the helpers who answered', async () => {
    const asked = engine(['chosen']);
    await smartDownload(release(copy('chosen'), copy('anna'), copy('bert')), copy('chosen'));
    const plan = usePrefs.getState().plans[0];
    expect(plan).toBeDefined();
    // Every track is with someone who answered; nobody is left waiting on the person who didn't.
    expect(plan.tracks.every((t) => t.username !== 'chosen')).toBe(true);
    expect(asked.flatMap((a) => a.files).sort()).toEqual([...names].sort());
    expect(plan.notes.some((n) => n.text.startsWith('Couldn’t reach chosen'))).toBe(true);
  });

  it('tries the next identical copies when nobody in the team answered', async () => {
    const asked = engine(['chosen', 'anna', 'bert']);
    await smartDownload(release(copy('chosen'), copy('anna'), copy('bert'), copy('carl')), copy('chosen'));
    expect(asked.map((a) => a.user)).toEqual(['carl']);
    expect(usePrefs.getState().plans[0].tracks.every((t) => t.username === 'carl')).toBe(true);
  });

  it('adds nothing, and says so, when nobody can be reached', async () => {
    engine(['chosen', 'anna']);
    await smartDownload(release(copy('chosen'), copy('anna')), copy('chosen'));
    expect(usePrefs.getState().plans).toHaveLength(0);
  });
});
