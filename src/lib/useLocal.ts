import { useEffect, useState } from 'react';
import type { Direction } from '../api/backend';
import type { LocalFiles } from '../api/types';
import { useStore } from '../store';
import { basename } from './quality';
import { dirOf, joinPath } from './covers';
import type { DownloadGroup } from './transfers';

/** Where finished downloads were saved, by transfer id (refreshed every few seconds). */
export function useLocalFiles(direction: Direction = 'download') {
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
