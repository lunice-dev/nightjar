import type { EnqueueFile } from '../api/types';
import { usePrefs } from '../prefs';
import { useStore } from '../store';
import { basename } from './quality';
import { dirOf, joinPath } from './covers';

/** The folder a track is listed in, in the other person's words. */
const remoteFolder = (filename: string) => filename.slice(0, Math.max(0, filename.lastIndexOf('\\')));

/** A path on this computer relative to the downloads folder ("Album\CD2"), or undefined when it isn't inside it. */
function relativeToDownloads(path: string): string | undefined {
  const dl = useStore.getState().local.downloadDir?.replace(/[\\/]+$/, '');
  if (!dl) return undefined;
  const p = path.replace(/[\\/]+$/, '');
  return p.toLowerCase().startsWith(dl.toLowerCase() + '\\') ? p.slice(dl.length + 1) : undefined;
}

/**
 * Where an album's files should go when more of its tracks are asked for later (a retry, a single track from the
 * search results): the folder the album already has. Without it the engine puts them in a folder named after the other
 * person's folder, and one album ends up in two places. Looks at the album's plan, then at where its files from this
 * person already are, then at the history of finished albums. Undefined when nothing is known: the engine's folder.
 */
export async function existingDestination(username: string, filename: string): Promise<string | undefined> {
  const folder = remoteFolder(filename).toLowerCase();
  if (!folder) return undefined;
  const { plans, finished } = usePrefs.getState();
  // 1. An album started in nightjar: its own folder (a disc folder inside it when the file lives in one).
  for (const p of [...plans].sort((a, b) => b.createdAt - a.createdAt)) {
    const t = p.tracks.find((k) => k.username === username && remoteFolder(k.filename).toLowerCase() === folder);
    if (t) return t.dest ?? p.destination;
  }
  const { backend, downloads } = useStore.getState();
  // 2. Files already downloaded from this person's folder: where most of them are.
  const user = downloads.find((u) => u.username === username);
  const dir = user?.directories.find((d) => d.directory.toLowerCase() === folder);
  if (backend && dir) {
    const paths = await backend.localFiles().catch(() => null);
    if (paths) {
      const count = new Map<string, number>();
      for (const f of dir.files) {
        const p = paths.get(f.id);
        if (!p || !f.state.startsWith('Completed, Succeeded')) continue;
        const rel = relativeToDownloads(dirOf(p));
        if (rel) count.set(rel, (count.get(rel) ?? 0) + 1);
      }
      const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) return best[0];
    }
  }
  // 3. The history: this folder was downloaded before, even if its entries have left the list.
  const done = finished.find((a) => a.key === `${username}\u0000${remoteFolder(filename)}` && a.dir);
  return done?.dir ? relativeToDownloads(done.dir) : undefined;
}

/**
 * Of the files about to be asked for, the ones that are already in the album's folder with the same name (and size,
 * when the folder says it): asking again would only make a second copy.
 */
export async function alreadyThere(username: string, files: EnqueueFile[], destination: string | undefined): Promise<EnqueueFile[]> {
  const { backend, local } = useStore.getState();
  if (!backend || !local.downloadDir || files.length === 0) return [];
  const folder = destination ?? basename(remoteFolder(files[0].filename));
  if (!folder) return [];
  const have = await backend.library.tracks(joinPath(local.downloadDir, folder)).catch(() => null);
  if (!have?.tracks.length) return [];
  const known = new Map(have.tracks.map((t) => [basename(t.path).toLowerCase(), t.size]));
  void username;
  return files.filter((f) => {
    const size = known.get(basename(f.filename).toLowerCase());
    return size !== undefined && (!size || size === f.size);
  });
}
