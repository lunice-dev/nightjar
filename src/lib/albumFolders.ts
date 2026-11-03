import { isDiscFolder } from './quality';

/**
 * Where one album's downloaded files are, counted by album folder: a disc folder ("CD 01", "Disc 2") belongs to the
 * album folder above it, so a two-disc album in one place is one folder, not two. `target` holds most of the album,
 * `others` are the album folders the rest went to (a retry that landed in the engine's own folder), `discs` the disc
 * folders found in any of them ('' for files directly in the album folder). Only folders inside the download folder count.
 */
export function albumFolders(saved: string[], downloadDir: string | undefined) {
  const dl = downloadDir?.replace(/[\\/]+$/, '').toLowerCase();
  const count = new Map<string, { dir: string; n: number }>();
  const discs = new Set<string>();
  for (const p of saved) {
    const parts = p.split(/[\\/]/);
    parts.pop(); // the file name
    const dir = parts.join('\\');
    if (!dl || !dir.toLowerCase().startsWith(dl + '\\')) continue;
    // A disc folder directly inside the download folder is an album of its own (its parent is the download folder).
    const inDisc = parts.length > 1 && isDiscFolder(parts[parts.length - 1]) && parts.slice(0, -1).join('\\').toLowerCase() !== dl;
    const album = inDisc ? parts.slice(0, -1).join('\\') : dir;
    discs.add(inDisc ? parts[parts.length - 1] : '');
    const e = count.get(album.toLowerCase()) ?? { dir: album, n: 0 };
    e.n++;
    count.set(album.toLowerCase(), e);
  }
  const list = [...count.values()].sort((a, b) => b.n - a.n);
  return { target: list[0]?.dir as string | undefined, others: list.slice(1).map((e) => e.dir), all: list.length, discs: [...discs] };
}
