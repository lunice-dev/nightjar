import { useEffect, useMemo, useState } from 'react';
import type { Direction } from '../api/backend';
import type { LocalFiles } from '../api/types';
import { usePrefs } from '../prefs';
import { useStore } from '../store';
import { basename } from './quality';
import { dirOf, joinPath } from './covers';
import type { DownloadGroup } from './transfers';

/**
 * Where a downloaded file is now: an album moved into the library (Put in library, Tidy library) takes its files
 * along, disc folders included. Undefined when it never moved.
 */
export function relocated(path: string, moves: Record<string, string> | undefined): string | undefined {
  if (!moves) return undefined;
  const lower = path.toLowerCase();
  for (let i = lower.lastIndexOf('\\'); i > 0; i = lower.lastIndexOf('\\', i - 1)) {
    const from = lower.slice(0, i);
    const to = moves[from];
    // A move that was undone reads "back where it was".
    if (to) return to.toLowerCase() === from ? undefined : to + path.slice(i);
  }
  return undefined;
}

/** Where a folder is now, following albums moved into the library (see relocated). */
export function relocatedDir(dir: string, moves: Record<string, string> | undefined): string {
  const now = relocated(`${dir}\\x`, moves);
  return now ? now.slice(0, -2) : dir;
}

/**
 * Where finished downloads are, by transfer id (refreshed every few seconds): where they were saved, or where they
 * went in the library since. `moved` holds the ids of files that went to the library.
 */
export function useLocalFiles(direction: Direction = 'download') {
  const raw = useSavedFiles(direction);
  const moves = usePrefs((s) => s.moves);
  return useMemo(() => {
    const map: LocalFiles = new Map();
    const moved = new Set<string>();
    for (const [id, p] of raw) {
      const now = relocated(p, moves);
      map.set(id, now ?? p);
      if (now) moved.add(id);
    }
    return Object.assign(map, { moved });
  }, [raw, moves]);
}

/** Where finished downloads were saved, by transfer id, as the engine recorded it. */
function useSavedFiles(direction: Direction) {
  const backend = useStore((s) => s.backend);
  const [map, setMap] = useState<LocalFiles>(new Map());
  useEffect(() => {
    if (!backend || direction !== 'download') return;
    let alive = true;
    const load = () => backend.localFiles().then((m) => alive && setMap(m)).catch(() => undefined);
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [backend, direction]);
  return map;
}

/** The folder on this computer an album downloads into, where its cover will be. */
export function groupCoverDir(g: DownloadGroup, files: LocalFiles, downloadDir?: string) {
  for (const f of g.files) {
    const p = files.get(f.id);
    if (p) return dirOf(p);
  }
  if (!downloadDir) return undefined;
  if (g.plan) return joinPath(downloadDir, g.plan.destination);
  // slskd's default: a folder named like the source folder.
  return joinPath(downloadDir, basename(g.directory));
}
