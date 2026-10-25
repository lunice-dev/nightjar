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

/** A title with its words, prepared once (comparing is the hot part). */
interface Title {
  t: string;
  words: Set<string>;
}
const prepared = new Map<string, Title>();
function prep(t: string): Title {
  let p = prepared.get(t);
  if (!p) {
    if (prepared.size > 20_000) prepared.clear();
    p = { t, words: new Set(t.split(' ')) };
    prepared.set(t, p);
  }
  return p;
}

function sameTitle(a: Title, b: Title) {
  if (a.t === b.t) return true;
  const [short, long] = a.t.length < b.t.length ? [a.t, b.t] : [b.t, a.t];
  if (short.length >= 5 && short.length >= long.length * 0.4 && long.includes(short)) return true;
  let both = 0;
  a.words.forEach((w) => b.words.has(w) && both++);
  return both / (a.words.size + b.words.size - both) >= 0.6;
}

/** How many of `titles` appear in `reference` (exact names first, then near ones). */
function overlap(titles: Title[], reference: Title[], exact = new Set(reference.map((r) => r.t))) {
  let matched = 0;
  for (const t of titles) if (exact.has(t.t) || reference.some((r) => sameTitle(t, r))) matched++;
  return { matched, of: titles.length };
}

const titleCache = new WeakMap<object, Title[]>();
function titlesOf(r: Pick<FolderResult, 'audio' | 'parent' | 'title'>) {
  let got = titleCache.get(r);
  if (!got) {
    got = [...new Set(r.audio.map((f) => titleOf(f.filename, r.parent, r.title)))].filter(telling).map(prep);
    titleCache.set(r, got);
  }
  return got;
}

/**
 * Copies with exactly the same track names, together: most copies of an album are the same rip, so the
 * comparisons run between a handful of groups instead of between every pair of copies.
 */
interface Group {
  titles: Title[];
  exact: Set<string>;
  users: Set<string>;
}
const MAX_GROUPS = 40;
function groupsOf(release: Release) {
  const bySig = new Map<string, Group>();
  const ofCopy = new Map<string, Group | null>();
  for (const s of release.sources) {
    const titles = titlesOf(s);
    if (titles.length < MIN_TITLES) {
      ofCopy.set(s.key, null);
      continue;
    }
    const sig = titles.map((t) => t.t).sort().join('\u0001');
    let g = bySig.get(sig);
    if (!g) {
      if (bySig.size >= MAX_GROUPS) {
        ofCopy.set(s.key, null); // a very mixed release: leave the rest unjudged
        continue;
      }
      g = { titles, exact: new Set(titles.map((t) => t.t)), users: new Set() };
      bySig.set(sig, g);
    }
    g.users.add(s.username);
    ofCopy.set(s.key, g);
  }
  const groups = [...bySig.values()];
  // How much of group a is in group b, once per pair.
  const share = new Map<Group, Map<Group, number>>();
  for (const a of groups) {
    const row = new Map<Group, number>();
    for (const b of groups) row.set(b, a === b ? 1 : overlap(a.titles, b.titles, b.exact).matched / a.titles.length);
    share.set(a, row);
  }
  return { groups, ofCopy, share: (a: Group, b: Group) => share.get(a)!.get(b)! };
}

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

/** Compares with the other people's copies of the release: no internet needed. */
function byOthers(release: Release): Record<string, CopyCheck> {
  const { groups, ofCopy, share } = groupsOf(release);
  // Groups that other people agree on: two or more people have them, or two groups that match each other.
  const agreed = groups.filter((h) => h.users.size >= 2 || groups.some((k) => k !== h && share(h, k) >= SAME && [...k.users].some((u) => !h.users.has(u))));
  const out: Record<string, CopyCheck> = {};
  for (const s of release.sources) {
    const base = { unidentified: unidentifiedFolder(s.folder) || undefined };
    const g = ofCopy.get(s.key);
    if (!g) {
      out[s.key] = { kind: 'unknown', ...base };
      continue;
    }
    const others = (h: Group) => [...h.users].filter((u) => u !== s.username);
    const supported = others(g).length > 0 || groups.some((h) => h !== g && share(g, h) >= SAME && others(h).length > 0);
    if (supported) {
      out[s.key] = { kind: 'ok', ...base };
      continue;
    }
    const voters = new Set(agreed.filter((h) => h !== g).flatMap(others));
    if (voters.size >= 2) {
      const best = agreed.filter((h) => h !== g).reduce((m, h) => Math.max(m, Math.round(share(g, h) * g.titles.length)), 0);
      out[s.key] = best / g.titles.length < TOO_FEW ? { kind: 'mismatch', matched: best, of: g.titles.length, against: 'others', ...base } : { kind: 'ok', ...base };
    } else out[s.key] = { kind: 'unknown', ...base };
  }
  return out;
}

const checked = new Map<string, Promise<void>>();

/**
 * Judges every copy of a release: first against the other copies, then against the album's track list on
 * MusicBrainz when it knows the album. A copy that MusicBrainz disagrees with but two other people's copies back up
 * isn't flagged (MusicBrainz may have matched another album of the same name).
 */
export function checkRelease(release: Release, urgent = false): Promise<void> {
  const key = release.key + '|' + release.sources.length;
  const had = checked.get(key);
  if (had && !urgent) return had;
  if (checked.size > 2000) checked.clear();
  save(byOthers(release));
  const job = (async () => {
    const r = release.best;
    if (!r.title) return;
    const names = await albumTitles(r.parent, r.title, urgent).catch(() => null);
    if (!names || names.length < MIN_TITLES) return;
    const reference = names.map(prep);
    const exact = new Set(names);
    const { groups, ofCopy, share } = groupsOf(release);
    const vsAlbum = new Map(groups.map((g) => [g, overlap(g.titles, reference, exact).matched]));
    const out: Record<string, CopyCheck> = {};
    for (const s of release.sources) {
      const g = ofCopy.get(s.key);
      if (!g) continue;
      const unidentified = unidentifiedFolder(s.folder) || undefined;
      const matched = vsAlbum.get(g)!;
      const of = g.titles.length;
      if (matched / of >= TOO_FEW) {
        out[s.key] = { kind: 'ok', matched, of, against: 'musicbrainz', unidentified };
        continue;
      }
      const backers = new Set(groups.filter((h) => share(g, h) >= SAME).flatMap((h) => [...h.users].filter((u) => u !== s.username)));
      out[s.key] = backers.size >= 2 ? { kind: 'unknown', unidentified } : { kind: 'mismatch', matched, of, against: 'musicbrainz', unidentified };
    }
    save(out);
  })();
  checked.set(key, job);
  return job;
}

const waiting = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * For the search list: judges a release once its copies stop arriving (a search adds copies every second or so;
 * judging each time would keep a phone busy), and never while a row is being drawn.
 */
export function checkReleaseSoon(release: Release) {
  const t = waiting.get(release.key);
  if (t) clearTimeout(t);
  waiting.set(
    release.key,
    setTimeout(() => {
      waiting.delete(release.key);
      void checkRelease(release);
    }, 1200),
  );
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
