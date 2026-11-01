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
export type LyricsState = { status: 'loading' } | { status: 'none' } | { status: 'error'; why: string } | { status: 'ready'; lyrics: Lyrics };

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
  // The lyrics are shown as plain text: the untimed version when there is one, else the words of the timed one.
  return (hit.plainLyrics && parsePlain(hit.plainLyrics)) || (hit.syncedLyrics && parseLrc(hit.syncedLyrics)) || null;
}

const API = 'https://lrclib.net/api';
const memory = new Map<string, Lyrics | null>();
const inflight = new Map<string, Promise<Lyrics | null>>();

/** Why a lookup failed, shown next to "couldn't reach the lyrics service" so a repeat problem can be told apart. */
export class LyricsError extends Error {}
let lastFailure = '';
export const lyricsFailure = () => lastFailure;

// Found lyrics are kept on this device, so a track asked for before is instant and works offline. "Not found" is not kept.
const STORE = 'nightjar.lyrics.v3';
const KEEP = 150;
const readStore = (): Record<string, Lyrics> => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, Lyrics>;
  } catch {
    return {};
  }
};
const saveStore = (key: string, l: Lyrics) => {
  try {
    const all = readStore();
    delete all[key];
    all[key] = l;
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete all[k];
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* storage full or blocked: carry on without it */
  }
};
const keyOf = (t: { artist: string | null; title: string; seconds: number }) => `${t.artist ?? ''}|${t.title}|${Math.round(t.seconds)}`.toLowerCase();

async function ask(url: string): Promise<Response> {
  // AbortSignal.timeout is missing on iOS before 16.4, so the timer is made by hand.
  const stop = new AbortController();
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    stop.abort();
  }, 8_000);
  try {
    return await fetch(url, { signal: stop.signal });
  } catch {
    throw new LyricsError(late ? 'timed out' : 'no connection');
  } finally {
    clearTimeout(timer);
  }
}

/** Asks LRCLIB for a track's lyrics. Sends the artist, title, album and length of the track, nothing else. */
async function fetchLrclib(t: { title: string; artist: string | null; album: string | null; seconds: number }): Promise<Lyrics | null> {
  if (!t.artist) return null;
  const q = new URLSearchParams({ artist_name: t.artist, track_name: t.title });
  if (t.album) q.set('album_name', t.album);
  if (t.seconds > 0) q.set('duration', String(Math.round(t.seconds)));
  const exact = await ask(`${API}/get?${q}`);
  if (exact.ok) return fromHit((await exact.json()) as LrcLibHit);
  // A busy service (5xx) still gets the search tried, which is served by a different query path.
  if (exact.status !== 404 && exact.status < 500) throw new LyricsError(`error ${exact.status}`);
  // Not found with the album and length: look by artist and title, and take the closest length.
  const s = new URLSearchParams({ artist_name: t.artist, track_name: t.title });
  const res = await ask(`${API}/search?${s}`);
  if (!res.ok) throw new LyricsError(`error ${res.status}`);
  const hits = ((await res.json()) as LrcLibHit[]).filter((h) => !h.instrumental);
  const near = hits.filter((h) => t.seconds <= 0 || h.duration == null || Math.abs(h.duration - t.seconds) <= 4);
  for (const h of near) {
    const l = fromHit(h);
    if (l) return l;
  }
  return null;
}

/** The service is often busy (503) for a few seconds at a time: keep asking, waiting longer each time, before giving up. */
async function withRetries(t: Parameters<typeof fetchLrclib>[0]): Promise<Lyrics | null> {
  for (let i = 0; ; i++) {
    try {
      return await fetchLrclib(t);
    } catch (e) {
      lastFailure = (e as Error).message;
      if (i >= 7) throw e;
      await new Promise((r) => setTimeout(r, Math.min(600 * 2 ** i, 6000) + Math.random() * 400));
    }
  }
}

export function loadLyrics(t: { path: string; title: string; artist: string | null; album: string | null; seconds: number }): Promise<Lyrics | null> {
  if (memory.has(t.path)) return Promise.resolve(memory.get(t.path) ?? null);
  const kept = readStore()[keyOf(t)];
  if (kept) {
    memory.set(t.path, kept);
    return Promise.resolve(kept);
  }
  let p = inflight.get(t.path);
  if (!p) {
    p = withRetries(t)
      .then((l) => {
        memory.set(t.path, l);
        if (l) saveStore(keyOf(t), l);
        return l;
      })
      .finally(() => inflight.delete(t.path));
    inflight.set(t.path, p);
  }
  return p;
}

const USED = 'nightjar.lyrics.used';
/** Once lyrics have been opened on this device, the playing track's lyrics are fetched in the background, so they are ready. */
export function markLyricsUsed() {
  try {
    localStorage.setItem(USED, '1');
  } catch {
    /* fine */
  }
}
export function prefetchLyrics(t: { path: string; title: string; artist: string | null; album: string | null; seconds: number } | undefined) {
  try {
    if (!t || localStorage.getItem(USED) !== '1') return;
  } catch {
    return;
  }
  loadLyrics(t).catch(() => undefined);
}

/** The lyrics of a track, fetched only while `enabled` (the lyrics view is open). A failed lookup counts as none. */
export function useLyrics(t: { path: string; title: string; artist: string | null; album: string | null; seconds: number } | undefined, enabled: boolean): { state: LyricsState; retry: () => void } {
  const [state, setState] = useState<LyricsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const path = t?.path;
  useEffect(() => {
    if (!enabled || !t) return;
    markLyricsUsed();
    let alive = true;
    setState(memory.has(t.path) ? stateOf(memory.get(t.path) ?? null) : { status: 'loading' });
    loadLyrics(t)
      .then((l) => alive && setState(stateOf(l)))
      .catch(() => alive && setState({ status: 'error', why: lastFailure }));
    return () => {
      alive = false;
    };
  }, [path, enabled, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  return { state, retry: () => setAttempt((n) => n + 1) };
}

const stateOf = (l: Lyrics | null): LyricsState => (l ? { status: 'ready', lyrics: l } : { status: 'none' });
