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

describe('a folder listed flat (disc folders left out)', () => {
  beforeEach(() => usePrefs.setState({ plans: [], smart: { enabled: true, queueMinutes: 10, parallel: false } }));

  it('doesn’t queue the same tracks again under paths without their disc folder', async () => {
    const ROOT = 'music\\Oasis\\Morning Glory (1995)';
    const disc = (d: number, n: number) => ({ filename: `${ROOT}\\CD 0${d}\\${String(n).padStart(2, '0')} - Song ${d}${n}.flac`, size: 1000 * d + n });
    const real = [disc(1, 1), disc(1, 2), disc(1, 3), disc(1, 4), disc(2, 1), disc(2, 2)];
    const copy = { key: `findthelorax\u0000${ROOT}`, username: 'findthelorax', folder: ROOT, title: 'Morning Glory', parent: 'Oasis', tier: 'lossless', files: real, audio: real, uploadSpeed: 5e6, hasFreeUploadSlot: true, queueLength: 0 } as unknown as FolderResult;
    const asked: string[] = [];
    // Their client: every file, flat, straight under the album folder, plus one the search didn't show.
    const flatList = [...real.map((f) => ({ filename: `${ROOT}\\${f.filename.split('\\').pop()}`, size: f.size })), { filename: `${ROOT}\\07 - Bonus.flac`, size: 9 }];
    useStore.setState({
      backend: {
        folderContents: async () => flatList,
        enqueue: async (_u: string, files: { filename: string }[]) => void asked.push(...files.map((f) => f.filename)),
      },
      toast: () => undefined,
      refreshTransfers: async () => undefined,
      speeds: new Map(),
    } as never);
    await smartDownload(release(copy), copy);
    // Exactly the real six, with their disc folders; no flat-path phantoms, no guessed path for the bonus track.
    expect(asked.sort()).toEqual(real.map((f) => f.filename).sort());
    expect(usePrefs.getState().plans[0].tracks).toHaveLength(6);
  });
});

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
