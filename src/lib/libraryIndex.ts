import { useEffect, useMemo } from 'react';
import type { LibAlbum } from '../api/library';
import { useFilesAvailable } from './files';
import { useLibraryReview } from './libraryReview';
import { normalise, TIERS, type Release, type Tier } from './quality';

/**
 * Your library, as search results see it: "you already have this", and whether this copy is better.
 * Built from the app's latest look at the library folder (taken once if there's none yet).
 */
let asked = false;
const NONE: LibAlbum[] = [];

export function useLibraryIndex() {
  const canFiles = useFilesAvailable();
  const albums = useLibraryReview((s) => s.scan?.albums);
  useEffect(() => {
    if (!canFiles || asked || albums) return;
    asked = true;
    void useLibraryReview.getState().load();
  }, [canFiles, albums]);
  return useMemo(() => {
    const byKey = new Map<string, LibAlbum[]>();
    for (const a of albums ?? []) {
      if (a.status === 'skip') continue;
      const keys = new Set([normalise(a.album), normalise(a.album.replace(/\s*[([].*$/, ''))]);
      for (const k of keys) {
        if (!k) continue;
        const list = byKey.get(k) ?? [];
        list.push(a);
        byKey.set(k, list);
      }
    }
    return byKey;
  }, [albums]);
}

/** Library format folder to the tier a search result shows. */
export function tierOfLibrary(a: LibAlbum): Tier {
  return a.format === 'Hi-Res' ? 'hires' : a.format === 'FLAC' ? 'lossless' : a.format === 'MP3' ? 'high' : 'unknown';
}

/** The copies of this release you already have (same album, same artist when both are known). */
export function inLibrary(index: Map<string, LibAlbum[]>, release: Release): LibAlbum[] {
  const r = release.best;
  const album = normalise(r.title);
  if (!album) return [];
  const artist = normalise(r.parent);
  const candidates = index.get(album) ?? index.get(normalise(r.title.replace(/\s*[([].*$/, ''))) ?? [];
  // Without an artist, a one-word title ("Gold") could be anybody's.
  const have = candidates.filter((a) => (artist ? normalise(a.artist) === artist || normalise(a.artistFromTags || '') === artist : album.length >= 12));
  return have.length ? have : NONE;
}

/** Whether this copy is better than the best one you have: a higher tier (Hi-res over FLAC over MP3). */
export function betterThanYours(release: Release, have: LibAlbum[]) {
  if (!have.length) return false;
  const best = Math.min(...have.map((a) => TIERS.indexOf(tierOfLibrary(a))));
  return TIERS.indexOf(release.best.tier) < best;
}

export function libraryLabel(a: LibAlbum) {
  if (a.format === 'MP3' || !a.bits) return a.format;
  return `${a.format} ${a.bits}/${(a.rate / 1000).toFixed(a.rate % 1000 ? 1 : 0)}`;
}
