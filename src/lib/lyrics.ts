import { useEffect, useState } from 'react';

export interface LyricLine {
  /** Seconds from the start of the track; null when the lyrics aren't synced. */
  at: number | null;
  text: string;
}

export interface Lyrics {
  synced: boolean;
  lines: LyricLine[];
}

/** What the lyrics for one track turned out to be. */
export type LyricsState = { status: 'loading' } | { status: 'none' } | { status: 'ready'; lyrics: Lyrics };

/** Reads "[mm:ss.xx] text" lines. A line may carry several stamps; tags like [ar:…] are skipped. */
export function parseLrc(text: string): Lyrics | null {
  const lines: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) {
      const frac = s[3] ? parseInt(s[3], 10) / 10 ** s[3].length : 0;
      lines.push({ at: parseInt(s[1], 10) * 60 + parseInt(s[2], 10) + frac, text: words });
    }
  }
  if (!lines.length) return null;
  lines.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  return { synced: true, lines };
}

export function parsePlain(text: string): Lyrics | null {
  const lines = text.split(/\r?\n/).map((t) => ({ at: null, text: t.trim() }));
  while (lines.length && !lines[lines.length - 1].text) lines.pop();
  return lines.some((l) => l.text) ? { synced: false, lines } : null;
}

/** The index of the line being sung at `time`, or -1 before the first line. */
export function activeLine(lines: LyricLine[], time: number): number {
  let lo = 0, hi = lines.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((lines[mid].at ?? Infinity) <= time) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

interface LrcLibHit {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
  duration?: number;
}

function fromHit(hit: LrcLibHit): Lyrics | null {
  return (hit.syncedLyrics && parseLrc(hit.syncedLyrics)) || (hit.plainLyrics && parsePlain(hit.plainLyrics)) || null;
}

const API = 'https://lrclib.net/api';
const memory = new Map<string, Lyrics | null>();
const inflight = new Map<string, Promise<Lyrics | null>>();

/** Asks LRCLIB for a track's lyrics. Sends the artist, title, album and length of the track, nothing else. */
async function fetchLrclib(t: { title: string; artist: string | null; album: string | null; seconds: number }): Promise<Lyrics | null> {
  if (!t.artist) return null;
  const q = new URLSearchParams({ artist_name: t.artist, track_name: t.title });
  if (t.album) q.set('album_name', t.album);
  if (t.seconds > 0) q.set('duration', String(Math.round(t.seconds)));
  const signal = AbortSignal.timeout(10_000);
  const exact = await fetch(`${API}/get?${q}`, { signal });
  if (exact.ok) return fromHit((await exact.json()) as LrcLibHit);
  if (exact.status !== 404) throw new Error(`LRCLIB ${exact.status}`);
  // Not found with the album and length: look by artist and title, and take the closest length.
  const s = new URLSearchParams({ artist_name: t.artist, track_name: t.title });
  const res = await fetch(`${API}/search?${s}`, { signal });
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  const hits = ((await res.json()) as LrcLibHit[]).filter((h) => !h.instrumental);
  const near = hits
    .filter((h) => t.seconds <= 0 || h.duration == null || Math.abs(h.duration - t.seconds) <= 4)
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics));
  for (const h of near) {
    const l = fromHit(h);
    if (l) return l;
  }
  return null;
}

export function loadLyrics(t: { path: string; title: string; artist: string | null; album: string | null; seconds: number }): Promise<Lyrics | null> {
  if (memory.has(t.path)) return Promise.resolve(memory.get(t.path) ?? null);
  let p = inflight.get(t.path);
  if (!p) {
    p = fetchLrclib(t)
      .then((l) => {
        memory.set(t.path, l);
        return l;
      })
      .finally(() => inflight.delete(t.path));
    inflight.set(t.path, p);
  }
  return p;
}

/** The lyrics of a track, fetched only while `enabled` (the lyrics view is open). A failed lookup counts as none. */
export function useLyrics(t: { path: string; title: string; artist: string | null; album: string | null; seconds: number } | undefined, enabled: boolean): LyricsState {
  const [state, setState] = useState<LyricsState>({ status: 'loading' });
  const path = t?.path;
  useEffect(() => {
    if (!enabled || !t) return;
    let alive = true;
    setState(memory.has(t.path) ? stateOf(memory.get(t.path) ?? null) : { status: 'loading' });
    loadLyrics(t)
      .then((l) => alive && setState(stateOf(l)))
      .catch(() => alive && setState({ status: 'none' }));
    return () => {
      alive = false;
    };
  }, [path, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

const stateOf = (l: Lyrics | null): LyricsState => (l ? { status: 'ready', lyrics: l } : { status: 'none' });
