/**
 * Album art. In order of preference:
 *  1. the picture in the album's folder on this computer (cover.jpg, folder.png…),
 *     served by the local helper;
 *  2. the front cover from MusicBrainz's Cover Art Archive, looked up by artist
 *     and album (works on a phone too, and before anything has downloaded);
 *  3. a generated cover, so the layout never has holes.
 */
import { mbFetch } from './musicbrainz';

declare const __DEMO__: boolean;
const isDemo = typeof __DEMO__ !== 'undefined' && __DEMO__;

const STORE_KEY = 'ssk-lite.covers';
type Cache = Record<string, string>; // "artist|album" → release-group id, or '' when none

let cache: Cache = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Cache;
  } catch {
    return {};
  }
})();
const pending = new Map<string, Promise<string | null>>();

function save() {
  try {
    const keys = Object.keys(cache);
    if (keys.length > 3000) cache = Object.fromEntries(keys.slice(-2000).map((k) => [k, cache[k]]));
    localStorage.setItem(STORE_KEY, JSON.stringify(cache));
  } catch {
    /* storage full or blocked: lookups just repeat */
  }
}

const clean = (s: string) =>
  s
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\b(disc|cd|disk)\s*\d+\b/gi, ' ')
    .replace(/["\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The MusicBrainz release group (the album, whatever its editions) for an artist and album, or null when there's
 * no confident match. Remembered on this device.
 */
export function releaseGroupId(artist: string | undefined, album: string | undefined, urgent = false): Promise<string | null> {
  if (isDemo || !album) return Promise.resolve(null);
  const a = clean(artist ?? '');
  const t = clean(album);
  if (!t) return Promise.resolve(null);
  const key = `${a.toLowerCase()}|${t.toLowerCase()}`;
  if (key in cache) return Promise.resolve(cache[key] || null);
  const q = a ? `releasegroup:"${t}" AND artist:"${a}"` : `releasegroup:"${t}"`;
  const url = `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=1`;
  const had = pending.get(key);
  if (had) {
    if (urgent) void mbFetch(url, true); // already waiting: move it to the front
    return had;
  }
  const job = mbFetch<{ 'release-groups'?: { id: string; score: number }[] }>(url, urgent).then((j) => {
    if (!j) return null; // no answer: ask again another time
    const hit = j['release-groups']?.[0];
    cache[key] = hit && hit.score >= 90 ? hit.id : '';
    save();
    return cache[key] || null;
  });
  pending.set(key, job);
  job.finally(() => pending.delete(key));
  return job;
}

/** Cover Art Archive address for an album, or null. */
export async function onlineCover(artist: string | undefined, album: string | undefined): Promise<string | null> {
  const id = await releaseGroupId(artist, album);
  return id ? `https://coverartarchive.org/release-group/${id}/front-500` : null;
}

// ---------------------------------------------------------------------------
// Generated covers: calm two-tone fields with one shape, seeded by the album.

const PALETTES = [
  ['#2f3a32', '#c9b79c'],
  ['#3b2f2a', '#d08c60'],
  ['#25303b', '#9fb4c7'],
  ['#3a3530', '#e3d5bf'],
  ['#2b2b2b', '#b8a47a'],
  ['#41322f', '#c47a6a'],
  ['#2d3436', '#a3b18a'],
  ['#1f2a36', '#e0a458'],
];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const generated = new Map<string, string>();
export function generatedCover(seed: string) {
  const had = generated.get(seed);
  if (had) return had;
  const h = hash(seed);
  const [bg, fg] = PALETTES[h % PALETTES.length];
  const kind = (h >>> 3) % 4;
  const x = 20 + ((h >>> 6) % 60);
  const y = 20 + ((h >>> 12) % 60);
  const r = 18 + ((h >>> 18) % 22);
  const shape =
    kind === 0
      ? `<circle cx="${x}" cy="${y}" r="${r}" fill="${fg}"/>`
      : kind === 1
        ? `<rect x="0" y="${y}" width="100" height="${100 - y}" fill="${fg}"/><circle cx="${x}" cy="${y}" r="${r / 2}" fill="${bg}"/>`
        : kind === 2
          ? `<path d="M0 ${y} Q ${x} ${y - r} 100 ${y + 10} L100 100 L0 100Z" fill="${fg}"/>`
          : `<circle cx="50" cy="50" r="${r + 14}" fill="none" stroke="${fg}" stroke-width="${4 + (h % 6)}"/><circle cx="50" cy="50" r="3" fill="${fg}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="100" height="100" fill="${bg}"/>${shape}</svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  generated.set(seed, url);
  return url;
}

// ---------------------------------------------------------------------------
// Local folders

const SEP = /[\\/]/;
export const joinPath = (a: string, b: string) => `${a.replace(/[\\/]+$/, '')}\\${b.replace(/^[\\/]+/, '')}`;
export const dirOf = (p: string) => p.split(SEP).slice(0, -1).join('\\');

/** Turns a shared folder as others see it ("@@lunice\FLAC\Artist\Album") into its path on this computer. */
export function localShareDir(remoteDir: string, roots: { remote: string; local: string }[]) {
  for (const r of roots) {
    const prefix = r.remote.replace(/[\\/]+$/, '');
    if (remoteDir === prefix) return r.local;
    if (remoteDir.startsWith(prefix + '\\') || remoteDir.startsWith(prefix + '/')) return joinPath(r.local, remoteDir.slice(prefix.length + 1));
  }
  return undefined;
}

