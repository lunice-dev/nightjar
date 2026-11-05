import type { LibAlbum, RecentMove, WaitingAlbum } from '../api/library';
import type { FinishedAlbum } from '../prefs';
import { parseRelease, splitFolder } from './quality';

export interface RecentRow {
  h: FinishedAlbum;
  a: LibAlbum | undefined;
}

const low = (s?: string) => (s ?? '').toLowerCase();
const inside = (dir: string, parent: string) => low(dir) === low(parent) || low(dir).startsWith(low(parent).replace(/[\\/]+$/, '') + '\\');

/** Artist and title of an album from the name of its folder. */
function fromFolder(dir: string) {
  const f = splitFolder(`${dir}\\x`);
  const r = parseRelease(f.title, f.parent);
  return { title: r.album || f.title, artist: r.artist || undefined };
}

/**
 * The albums on the home page's "Recently added", newest first. They come from three places, because each one alone
 * misses some: albums nightjar saw finish downloading (a window has to be open when that happens, and an album with a
 * track that failed never counts as finished), albums waiting in the downloads folder, and albums put in the library
 * lately. An album still being downloaded is left out, and an album is shown once however many places know it.
 */
export function recentAlbums(input: {
  history: FinishedAlbum[];
  waiting: WaitingAlbum[];
  moved: RecentMove[];
  /** Keys of the albums being downloaded now. */
  live: Set<string>;
  /** Folders of the albums being downloaded now. */
  comingDirs: string[];
  /** Where an album's folder is now (albums moved into the library took theirs along). */
  relocate: (dir: string) => string;
  library: Map<string, LibAlbum>;
  limit: number;
}): RecentRow[] {
  const items: FinishedAlbum[] = [];
  for (const h of input.history) {
    if (input.live.has(h.key)) continue;
    items.push(h.dir ? { ...h, dir: input.relocate(h.dir) } : h);
  }
  for (const w of input.waiting) {
    if (input.comingDirs.some((c) => c && inside(w.dir, c))) continue;
    const what = fromFolder(w.dir);
    items.push({ key: `dir:${w.dir}`, title: what.title, artist: what.artist, dir: w.dir, size: w.size, tracks: w.tracks, from: [], at: w.at });
  }
  for (const m of input.moved) {
    const a = input.library.get(low(m.to));
    const what = a ? { title: a.album, artist: a.artist } : fromFolder(m.to);
    items.push({ key: `dir:${m.to}`, title: what.title, artist: what.artist, dir: m.to, size: a?.size ?? 0, tracks: 0, from: [], at: m.at });
  }
  items.sort((x, y) => y.at - x.at);

  const dirs = new Set<string>();
  const ids = new Set<string>();
  const rows: RecentRow[] = [];
  for (const h of items) {
    // The same album downloaded twice (or from two people), or known from two places, is one tile.
    const id = `${low(h.artist)}|${low(h.title)}`;
    if (ids.has(id) || (h.dir && dirs.has(low(h.dir)))) continue;
    ids.add(id);
    if (h.dir) dirs.add(low(h.dir));
    rows.push({ h, a: h.dir ? input.library.get(low(h.dir)) : undefined });
    if (rows.length >= input.limit) break;
  }
  return rows;
}
