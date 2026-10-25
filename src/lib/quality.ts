import type { SearchFile, SearchResponse } from '../api/types';

/**
 * Fidelity tiers, best first. The tier drives the coloured spine shown next to
 * every result, so its order matters.
 */
export const TIERS = ['hires', 'lossless', 'high', 'mid', 'low', 'unknown'] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABEL: Record<Tier, string> = {
  hires: 'Hi-res',
  lossless: 'Lossless',
  high: '320 kbps',
  mid: 'VBR / 256',
  low: 'Under 192',
  unknown: 'Unknown',
};

const LOSSLESS_EXT = new Set(['flac', 'alac', 'wav', 'aiff', 'aif', 'ape', 'wv', 'dsf', 'dff']);
const LOSSY_EXT = new Set(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wma', 'mpc']);
export const AUDIO_EXT = new Set([...LOSSLESS_EXT, ...LOSSY_EXT]);

export const extOf = (filename: string, given?: string) => {
  const e = (given || filename.split('.').pop() || '').toLowerCase().replace(/^\./, '');
  return e.length <= 5 ? e : '';
};

export const isAudio = (f: SearchFile) => AUDIO_EXT.has(extOf(f.filename, f.extension));

export function tierOf(f: SearchFile): Tier {
  const ext = extOf(f.filename, f.extension);
  const lossless = LOSSLESS_EXT.has(ext) || (!!f.bitDepth && !LOSSY_EXT.has(ext));
  if (lossless) {
    if ((f.bitDepth ?? 0) >= 24 || (f.sampleRate ?? 0) > 48000) return 'hires';
    return 'lossless';
  }
  const br = f.bitRate ?? 0;
  if (!br) return 'unknown';
  if (br >= 300) return 'high';
  if (br >= 192) return 'mid';
  return 'low';
}

export const tierRank = (t: Tier) => TIERS.length - TIERS.indexOf(t);

/** "FLAC 24/96", "MP3 320", "MP3 V0 ~245" */
export function formatLabel(f: SearchFile): string {
  const ext = extOf(f.filename, f.extension).toUpperCase() || '?';
  const tier = tierOf(f);
  if (tier === 'hires' || tier === 'lossless') {
    const depth = f.bitDepth ? `${f.bitDepth}` : '';
    const rate = f.sampleRate ? `${+(f.sampleRate / 1000).toFixed(1)}` : '';
    return depth && rate ? `${ext} ${depth}/${rate}` : ext;
  }
  if (!f.bitRate) return ext;
  return f.isVariableBitRate ? `${ext} VBR ~${f.bitRate}` : `${ext} ${f.bitRate}`;
}

// ---------------------------------------------------------------------------
// Grouping: Soulseek returns flat file lists per user. People look for albums,
// so results are regrouped by folder, then folders that look like the same
// release are clustered so one row can offer several sources.

export interface FolderResult {
  key: string;
  username: string;
  folder: string;
  title: string;
  parent: string;
  year?: number;
  files: SearchFile[];
  audio: SearchFile[];
  extras: number;
  locked: number;
  tier: Tier;
  format: string;
  size: number;
  length: number;
  hasFreeUploadSlot: boolean;
  uploadSpeed: number;
  queueLength: number;
  score: number;
  /** Only seen in an earlier search for the same words. */
  earlier?: boolean;
  /** How many fake copies this person has sent you before (Check quality found them). */
  fakes?: number;
  /** This copy has far fewer tracks than the album (judged from the other copies found). */
  partial?: { have: number; of: number };
}

export interface Release {
  key: string;
  best: FolderResult;
  sources: FolderResult[];
  /** Order among results: relevance, then the best copy, then how many people have it. */
  score: number;
}

const SEP = /[\\/]/;
// Sub-folders for one disc or side of an album: "CD1", "Disc 2", "Disc 2 - Twilight to Starlight", "Side A", '12" Vinyl 01'
const DISC = /^((cd|disc|disk)\s*\d{1,2}(\s*[-–—:._]\s*.+|\s*[([].+[)\]])?|(side|vinyl|lp)\s*[\da-d]{1,2}|\d{1,2}("|''|”|in|inch)?\s*vinyl\s*\d{1,2})$/i;

export function splitFolder(path: string) {
  const parts = path.split(SEP).filter(Boolean);
  parts.pop(); // file name
  let titleIdx = parts.length - 1;
  if (titleIdx > 0 && DISC.test(parts[titleIdx])) titleIdx--;
  return {
    folder: parts.join('\\'),
    /** The album's own folder: the same as `folder`, or its parent when the file sits in a disc folder. */
    root: parts.slice(0, titleIdx + 1).join('\\'),
    title: parts[titleIdx] ?? '(root)',
    parent: parts[titleIdx - 1] ?? '',
  };
}

export const basename = (path: string) => path.split(SEP).pop() ?? path;

// Share roots that say nothing about the music inside them.
const GENERIC = /^(@@.*|music|shared?|albums?|mp3s?|flac|downloads?|complete|library|audio|my music|media)$/i;

/**
 * Folder names follow a handful of habits: "Artist - Album (2009) [FLAC]",
 * "2009 - Album" under an artist folder, or just "Album". Pull out the parts
 * so different habits for the same release can be matched and shown alike.
 */
// Technical tags people append to folder names; they say nothing about the music.
const TECH =
  /\b(flac|mp3|aac|alac|ogg|opus|wav|320|256|192|v0|v2|vbr|cbr|lossless|web|webflac|cd|cdda|vinyl|lp|24bit|16bit|24-?bit|16-?bit|\d{2}(?:[.,]\d)?-?khz|\d{2}-\d{2,3}|hi-?res|remaster(?:ed)?|deluxe|edition|scene|retail|log|cue)\b/gi;

// Format details only; editions like "(Super Deluxe)" stay in the title.
const FORMAT = /\b(flac|mp3|aac|alac|wav|320|v0|vbr|lossless|web|cd|vinyl|24-?bit|16-?bit|\d{2}(?:[.,]\d)?-?khz|\d{2}-\d{2,3}|hi-?res)\b/i;

export function parseRelease(rawTitle: string, rawParent: string) {
  // Scene-style names use underscores and dots for spaces: Artist-2002-Album_WEB_FLAC
  const spaced = /\s/.test(rawTitle) ? rawTitle : rawTitle.replace(/[_.]+/g, ' ');
  let t = spaced.replace(/[[{].*?[\]}]/g, ' ');
  let year: number | undefined;
  let artist = GENERIC.test(rawParent.trim()) ? '' : rawParent.trim();

  // Artist-Album-WEB-2002: dash-separated with the year last
  const tail = t.trim().match(/^([^-]+)-(.+)-((?:19|20)\d{2})$/);
  if (tail) t = `${tail[1]} - ${tail[3]} - ${tail[2].split('-').join(' ')}`;
  const scene = t.match(/^\s*(.+?)\s*-\s*((?:19|20)\d{2})\s*-\s*(.+)$/);
  // "1998 - Album", or "1998 Album" inside an artist's folder
  const lead = t.match(/^\s*((?:19|20)\d{2})\s*[-–.]\s*(.+)$/) ?? (artist ? t.match(/^\s*((?:19|20)\d{2})\s+(\p{L}.+)$/u) : null);
  if (scene) {
    artist = scene[1].trim();
    year = +scene[2];
    t = scene[3];
  } else if (lead) {
    year = +lead[1];
    t = lead[2];
  }
  const paren = t.match(/\(\s*((?:19|20)\d{2})\s*\)/);
  if (paren) {
    year ??= +paren[1];
    t = t.replace(paren[0], ' ');
  }
  if (!scene) {
    const split = t.match(/^(.+?)\s+[-–]\s+(.+)$/);
    if (split) {
      artist = split[1].trim();
      t = split[2];
    }
  }
  // Parentheses holding label, catalogue or format details aren't part of the title.
  t = t.replace(/\(([^)]*)\)/g, (m, inner: string) =>
    FORMAT.test(inner) || /records|recordings|\b[A-Z]{2,}\s?\d{2,}\b|\bcat\b/i.test(inner) ? ' ' : m,
  );
  // Drop trailing tech tags (and the separators between them), keep the title.
  const words = t.replace(/\(\s*\)/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length > 1 && (words[words.length - 1].replace(TECH, '').replace(/[-–_]/g, '') === '')) words.pop();
  const album = words.join(' ').replace(/\s*[-–]\s*$/, '').trim() || rawTitle;
  return { artist, album, year };
}

function dominantTier(files: SearchFile[]): Tier {
  const counts = new Map<Tier, number>();
  files.forEach((f) => counts.set(tierOf(f), (counts.get(tierOf(f)) ?? 0) + 1));
  let best: Tier = 'unknown';
  let n = -1;
  counts.forEach((c, t) => {
    if (c > n || (c === n && tierRank(t) > tierRank(best))) {
      best = t;
      n = c;
    }
  });
  return best;
}

function score(r: Omit<FolderResult, 'score'>, speeds?: Map<string, number>) {
  // Someone who sent you a fake before: their "lossless" may not be. Below an honest copy of the same quality.
  const fakePenalty = r.fakes ? 90 + Math.min(60, (r.fakes - 1) * 30) : 0;
  // What this person really sent you before beats what their client claims.
  const speedMbps = (speeds?.get(r.username) ?? r.uploadSpeed) / 1_000_000;
  return (
    tierRank(r.tier) * 100 +
    (r.hasFreeUploadSlot && !r.earlier ? 60 : 0) +
    Math.min(40, Math.log2(1 + speedMbps) * 12) -
    Math.min(50, r.queueLength * 2) +
    Math.min(20, r.audio.length) -
    (r.earlier ? 40 : 0) -
    fakePenalty
  );
}

export function toFolders(responses: SearchResponse[], speeds?: Map<string, number>, fakes?: Map<string, number>): FolderResult[] {
  const out: FolderResult[] = [];
  for (const resp of responses) {
    const byFolder = new Map<string, { title: string; parent: string; files: SearchFile[]; locked: number }>();
    const add = (f: SearchFile, locked: boolean) => {
      // macOS leaves "__MACOSX" folders and "._name" shadow files in zips; they aren't music.
      if (/(^|[\\/])(__MACOSX|\._[^\\/]*$)/.test(f.filename)) return;
      // Disc folders (CD1, CD2…) are one album: they're grouped under the album's own folder.
      const { root, title, parent } = splitFolder(f.filename);
      const entry = byFolder.get(root) ?? { title, parent, files: [], locked: 0 };
      if (locked) entry.locked++;
      else entry.files.push(f);
      byFolder.set(root, entry);
    };
    resp.files.forEach((f) => add(f, false));
    resp.lockedFiles?.forEach((f) => add(f, true));

    byFolder.forEach((g, folder) => {
      const audio = g.files.filter(isAudio);
      if (audio.length === 0) return;
      const tier = dominantTier(audio);
      const sample = audio.find((f) => tierOf(f) === tier) ?? audio[0];
      const named = parseRelease(g.title, g.parent);
      const base = {
        key: `${resp.username}\u0000${folder}`,
        username: resp.username,
        folder,
        title: named.album,
        parent: named.artist,
        year: named.year,
        files: g.files,
        audio: audio.sort((a, b) => a.filename.localeCompare(b.filename)),
        extras: g.files.length - audio.length,
        locked: g.locked,
        tier,
        format: formatLabel(sample),
        size: g.files.reduce((s, f) => s + f.size, 0),
        length: audio.reduce((s, f) => s + (f.length ?? 0), 0),
        hasFreeUploadSlot: resp.hasFreeUploadSlot,
        uploadSpeed: resp.uploadSpeed,
        queueLength: resp.queueLength,
        earlier: resp.earlier,
        fakes: fakes?.get(resp.username),
      };
      out.push({ ...base, score: score(base, speeds) });
    });
  }
  return out;
}

export const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[([{].*?[)\]}]/g, ' ') // drop "(2003)", "[FLAC]", "{WEB}"
    .replace(/\b(flac|mp3|320|v0|web|cd|vinyl|24bit|16bit|24-96|24-48|lossless)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Copies of the same album are stacked into one release, whatever their format,
 * so a release offers every quality on the network for that album. Copies whose
 * folder doesn't name the artist join the matching album by the artist that has
 * the most copies.
 */
/**
 * How well a release answers the search: every word in its artist, album or
 * folder name is a strong match; words found only in track names are weaker.
 */
function relevance(r: FolderResult, words: string[]) {
  if (!words.length) return 1;
  const name = `${r.parent} ${r.title} ${r.folder}`.toLowerCase();
  const tracks = r.audio.map((f) => f.filename).join(' ').toLowerCase();
  let s = 0;
  for (const w of words) s += name.includes(w) ? 1 : tracks.includes(w) ? 0.4 : 0;
  return s / words.length;
}

/** Score that orders releases; also used after filters change which copies remain. */
export function releaseScore(best: FolderResult, sources: FolderResult[], query = '') {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const people = new Set(sources.map((s) => s.username)).size;
  // A release many people share is usually the real, complete album rather than a stray folder.
  return relevance(best, words) * 120 + best.score + Math.min(45, Math.log2(1 + people) * 15);
}

/**
 * How many tracks the album has, judged from its copies: the track count most people have (single stray tracks
 * aside; a tie goes to the bigger count), or the biggest count found when no two copies agree. Deluxe editions
 * with more tracks don't change it.
 */
export function expectedTracks(sources: Pick<FolderResult, 'audio'>[]) {
  const counts = new Map<number, number>();
  for (const s of sources) counts.set(s.audio.length, (counts.get(s.audio.length) ?? 0) + 1);
  const common = [...counts].filter(([c, n]) => c > 1 && n >= 2).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  return common ? { of: common[0], agreed: true } : { of: Math.max(0, ...counts.keys()), agreed: false };
}

/**
 * Copies with far fewer tracks than the album (someone sharing two songs of it) are marked and sink below
 * every complete copy, whatever their quality or speed. A deluxe edition with more tracks isn't penalised.
 */
function markPartial(sources: FolderResult[]) {
  const { of, agreed } = expectedTracks(sources);
  for (const s of sources) {
    const have = s.audio.length;
    // When two people agree on the count, a quarter missing is enough; otherwise only half or more missing counts.
    if (of > 1 && (agreed ? have < of * 0.75 : have <= of * 0.5)) {
      s.partial = { have, of };
      s.score -= 250;
    }
  }
}

export function toReleases(folders: FolderResult[], query = ''): Release[] {
  const byAlbum = new Map<string, FolderResult[]>();
  for (const f of folders) {
    const k = normalise(f.title) || f.title.toLowerCase();
    const list = byAlbum.get(k);
    if (list) list.push(f);
    else byAlbum.set(k, [f]);
  }
  const releases: Release[] = [];
  byAlbum.forEach((group, albumKey) => {
    const byArtist = new Map<string, FolderResult[]>();
    const unnamed: FolderResult[] = [];
    for (const f of group) {
      const a = normalise(f.parent);
      if (!a) unnamed.push(f);
      else byArtist.set(a, [...(byArtist.get(a) ?? []), f]);
    }
    if (byArtist.size === 0) byArtist.set('', unnamed);
    else {
      // An "artist" seen on a single copy is usually a stray folder name
      // ("1 Albums", someone's own label); it joins the main group.
      const ranked = [...byArtist.entries()].sort((x, y) => y[1].length - x[1].length);
      const [, biggest] = ranked[0];
      biggest.push(...unnamed);
      if (biggest.length >= 2) {
        for (const [k, list] of ranked.slice(1)) {
          if (list.length === 1) {
            biggest.push(...list);
            byArtist.delete(k);
          }
        }
      }
    }
    byArtist.forEach((sources, artistKey) => {
      markPartial(sources);
      sources.sort((a, b) => b.score - a.score);
      const year = sources.find((x) => x.year)?.year;
      if (year) sources.forEach((x) => (x.year ??= year));
      const named = sources.find((x) => x.parent);
      if (named) sources.forEach((x) => (x.parent ||= named.parent));
      releases.push({ key: `${artistKey}|${albumKey}`, best: sources[0], sources, score: releaseScore(sources[0], sources, query) });
    });
  });
  return releases.sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Formatting helpers

export function bytes(n: number) {
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/** Measured speeds are fractions (bytes over seconds); anything under 1 KB/s is a trickle, not worth digits. */
export const speed = (bps: number) => (bps >= 1024 ? `${bytes(bps)}/s` : bps > 0 ? 'under 1 KB/s' : '—');

export function duration(seconds: number) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
