import { create } from 'zustand';
import { basename, type FolderResult, type Release } from './quality';
import { releaseGroupId } from './covers';
import { mbFetch } from './musicbrainz';

/**
 * Is this copy really the album its folder says? Some people share a folder named after one album that holds
 * another (an auto-tagger's "failed imports", or plain bait): "Mick Jenkins - The Patience" full of Foo Fighters.
 *
 * Before downloading, the copy's track names are compared with the album's real track list on MusicBrainz
 * (every edition of it), or, when MusicBrainz doesn't know the album, with the other people's copies of it.
 * While downloading, the first track's tags are read as it arrives (see watchIdentity in smart.ts).
 */

// ------------------------------------------------------------------ names

const strip = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ') // "(feat. X)", "[Remastered]", "(2003)"
    .replace(/\b(feat|ft|featuring)\b\.?.*$/, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/^the\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A name to compare artists and albums by. */
export const plainName = strip;

/** The song's title from a file name: no folder, extension, track number, or "Artist - Album - " in front. */
export function titleOf(path: string, artist = '', album = '') {
  // "01. ", "1-01 ", "CD1 03 - ", "A1. " (vinyl sides)
  const number = (s: string) => s.replace(/^\s*(?:(?:cd|disc|disk)\s*\d+\s*[-._ ]\s*)?(?:[a-d]?\d{1,3}(?:[-.]\d{1,3})?)\s*[-._)\]]*\s+/i, '');
  let name = number(basename(path).replace(/\.[a-z0-9]{2,5}$/i, ''));
  const parts = name.split(/\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1) {
    const a = strip(artist), b = strip(album);
    const kept = parts.filter((p) => {
      const n = strip(p);
      return n && !/^\d{1,3}$/.test(n) && n !== a && n !== b;
    });
    if (kept.length) name = number(kept.join(' - ')); // "Artist - Album - 10 Title"
  }
  return strip(name);
}

/** A title that says something: not "track 01" or just a number. */
const telling = (t: string) => /\p{L}{2}/u.test(t) && !/^(track|piste|faixa|pista|titel|title|audio|untitled)\s*\d*$/.test(t);

function sameTitle(a: string, b: string) {
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  if (short.length >= 5 && short.length >= long.length * 0.4 && long.includes(short)) return true;
  const x = new Set(a.split(' ')), y = new Set(b.split(' '));
  let both = 0;
  x.forEach((w) => y.has(w) && both++);
  return both / (x.size + y.size - both) >= 0.6;
}

/** How many of `titles` appear in `reference`. */
function overlap(titles: string[], reference: string[]) {
  let matched = 0;
  for (const t of titles) if (reference.some((r) => sameTitle(t, r))) matched++;
  return { matched, of: titles.length };
}

const titlesOf = (r: Pick<FolderResult, 'audio' | 'parent' | 'title'>) =>
  [...new Set(r.audio.map((f) => titleOf(f.filename, r.parent, r.title)))].filter(telling);

/** Folders an auto-tagger couldn't identify ("slskd\failed_imports" and the like). */
export const unidentifiedFolder = (folder: string) => /(^|[\\/])(failed[ _-]?imports?|unmatched|unidentified|untagged|unknown album)([\\/]|$)/i.test(folder);

// ------------------------------------------------------------------ the album's real track list

const STORE_KEY = 'nightjar.album-tracks';
let known: Record<string, string[]> = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, string[]>;
  } catch {
    return {};
  }
})();
const asking = new Map<string, Promise<string[] | null>>();

/** Every track title on any edition of the album (MusicBrainz release group), or null when unknown. */
export async function albumTitles(artist: string, album: string, urgent = false): Promise<string[] | null> {
  const id = await releaseGroupId(artist || undefined, album, urgent);
  if (!id) return null;
  if (known[id]) return known[id];
  const url = `https://musicbrainz.org/ws/2/release?release-group=${id}&inc=recordings&fmt=json&limit=10`;
  const had = asking.get(id);
  if (had) {
    if (urgent) void mbFetch(url, true);
    return had;
  }
  const job = mbFetch<{ releases?: { media?: { tracks?: { title: string }[] }[] }[] }>(url, urgent).then((j) => {
    if (!j) return null;
    const titles = [...new Set((j.releases ?? []).flatMap((r) => (r.media ?? []).flatMap((m) => (m.tracks ?? []).map((t) => strip(t.title)))))].filter(Boolean);
    if (titles.length) {
      known[id] = titles;
      try {
        const keys = Object.keys(known);
        if (keys.length > 400) known = Object.fromEntries(keys.slice(-300).map((k) => [k, known[k]]));
        localStorage.setItem(STORE_KEY, JSON.stringify(known));
      } catch {
        /* storage full: asked again next time */
      }
    }
    return titles.length ? titles : null;
  });
  asking.set(id, job);
  job.finally(() => asking.delete(id));
  return job;
}

// ------------------------------------------------------------------ verdicts

export interface CopyCheck {
  /** "mismatch": the track names aren't this album's. */
  kind: 'ok' | 'mismatch' | 'unknown';
  matched?: number;
  of?: number;
  /** What the names were compared with. */
  against?: 'musicbrainz' | 'others';
  /** The folder is one its owner's tagging tool couldn't identify. */
  unidentified?: boolean;
}

/** Verdicts by copy (FolderResult.key), shared by the search list and Download. */
export const useIdentity = create<{ checks: Record<string, CopyCheck> }>(() => ({ checks: {} }));
export const identityOf = (key: string): CopyCheck | undefined => useIdentity.getState().checks[key];
export const isMismatch = (key: string) => identityOf(key)?.kind === 'mismatch';

/** Too few names to judge by (a single, or "Track 01"…). */
const MIN_TITLES = 3;
/** Below this share of matching names, a copy is another album. */
const TOO_FEW = 0.25;
/** Two copies with at least this share in common are the same album. */
const SAME = 0.5;

function save(results: Record<string, CopyCheck>) {
  useIdentity.setState((s) => ({ checks: { ...s.checks, ...results } }));
}

/** Compares with the other people's copies of the release: right away, no internet needed. */
function byOthers(release: Release): Record<string, CopyCheck> {
  const copies = release.sources.map((s) => ({ s, titles: titlesOf(s) }));
  const out: Record<string, CopyCheck> = {};
  for (const { s, titles } of copies) {
    const base = { unidentified: unidentifiedFolder(s.folder) || undefined };
    if (titles.length < MIN_TITLES) {
      out[s.key] = { kind: 'unknown', ...base };
      continue;
    }
    const others = copies.filter((o) => o.s.username !== s.username && o.titles.length >= MIN_TITLES);
    const supporters = others.filter((o) => overlap(titles, o.titles).matched / titles.length >= SAME);
    // The others agree among themselves (at least two people), and this one shares almost nothing with them.
    const agreeing = others.filter((o) => others.some((p) => p !== o && p.s.username !== o.s.username && overlap(o.titles, p.titles).matched / o.titles.length >= SAME));
    if (supporters.length === 0 && new Set(agreeing.map((o) => o.s.username)).size >= 2) {
      const best = agreeing.reduce((m, o) => Math.max(m, overlap(titles, o.titles).matched), 0);
      out[s.key] = best / titles.length < TOO_FEW ? { kind: 'mismatch', matched: best, of: titles.length, against: 'others', ...base } : { kind: 'ok', ...base };
    } else out[s.key] = { kind: supporters.length ? 'ok' : 'unknown', ...base };
  }
  return out;
}

const checked = new Map<string, Promise<void>>();

/**
 * Judges every copy of a release: first against the other copies (instant), then against the album's track list on
 * MusicBrainz when it knows the album. A copy that MusicBrainz disagrees with but two other people's copies back up
 * isn't flagged (MusicBrainz may have matched another album of the same name).
 */
export function checkRelease(release: Release, urgent = false): Promise<void> {
  const key = release.key + '|' + release.sources.length;
  const had = checked.get(key);
  if (had && !urgent) return had;
  save(byOthers(release));
  const job = (async () => {
    const r = release.best;
    if (!r.title) return;
    const reference = await albumTitles(r.parent, r.title, urgent).catch(() => null);
    if (!reference || reference.length < MIN_TITLES) return;
    const copies = release.sources.map((s) => ({ s, titles: titlesOf(s) }));
    const out: Record<string, CopyCheck> = {};
    for (const { s, titles } of copies) {
      const unidentified = unidentifiedFolder(s.folder) || undefined;
      if (titles.length < MIN_TITLES) continue;
      const { matched, of } = overlap(titles, reference);
      if (matched / of >= TOO_FEW) {
        out[s.key] = { kind: 'ok', matched, of, against: 'musicbrainz', unidentified };
        continue;
      }
      const backers = new Set(copies.filter((o) => o.s.username !== s.username && o.titles.length >= MIN_TITLES && overlap(titles, o.titles).matched / titles.length >= SAME).map((o) => o.s.username));
      out[s.key] = backers.size >= 2 ? { kind: 'unknown', unidentified } : { kind: 'mismatch', matched, of, against: 'musicbrainz', unidentified };
    }
    save(out);
  })();
  checked.set(key, job);
  return job;
}

/** Words for a copy's warning: what was compared, and how many names matched. */
export function mismatchText(c: CopyCheck, artist: string, album: string) {
  const name = artist ? `${artist} – ${album}` : album;
  const where = c.against === 'musicbrainz' ? `on ${name}, as MusicBrainz lists it` : `in other people’s copies of ${name}`;
  return `${c.matched === 0 ? 'None' : `Only ${c.matched}`} of its ${c.of} track names ${c.matched === 1 ? 'is' : 'are'} ${where}. The folder is named after this album, but the files are probably another one.`;
}

// ------------------------------------------------------------------ while downloading: the files' own tags

const similarName = (a: string, b: string) => {
  const x = strip(a), y = strip(b);
  if (!x || !y) return true; // nothing to compare: don't accuse
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  // "The Patience" is in "Echoes, Silence, Patience & Grace", but that's another album: only a large part counts.
  if (x === y || (short.length >= 4 && short.length >= long.length * 0.5 && long.includes(short))) return true;
  const p = new Set(x.split(' ')), q = new Set(y.split(' '));
  let both = 0;
  p.forEach((w) => q.has(w) && both++);
  return both / (p.size + q.size - both) >= 0.5;
};

/**
 * The tags of a track say it belongs to another album: the artist is someone else AND the album is another one.
 * Either alone isn't enough (a guest artist, "Deluxe Edition", an artist's other name).
 */
export function tagsSayOtherAlbum(expected: { artist?: string; album?: string }, tags: { artist?: string; albumArtist?: string; album?: string }) {
  const artistKnown = !!(expected.artist && (tags.artist || tags.albumArtist));
  const albumKnown = !!(expected.album && tags.album);
  if (!artistKnown || !albumKnown) return false;
  const artistOk = [tags.artist, tags.albumArtist].some((t) => !!t && similarName(expected.artist!, t)) || /various/i.test(tags.albumArtist ?? '');
  const albumOk = similarName(expected.album!, tags.album!);
  return !artistOk && !albumOk;
}
