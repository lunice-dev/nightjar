import type { ActivityEvent } from '../prefs';

/**
 * Who looks like a program rather than a person, judged by how fast they use your share. A person opens a folder
 * every few seconds and takes an album or two at a time; a crawler opens several folders a second and a mass
 * downloader takes hundreds of files in a sitting.
 *
 * "likely" gets a mark in the activity feed. "sure" is far beyond what a person can do (more than 40 folders a
 * minute, a thousand files in half an hour), and is what Nightjar blocks on its own when that is switched on.
 */
export type SuspectKind = 'crawl' | 'mass' | 'volume';

export interface Suspect {
  user: string;
  level: 'likely' | 'sure';
  kind: SuspectKind;
  /** When the burst ended. */
  at: number;
  /** In plain words, for the notice. */
  summary: string;
}

const SEC = 1000;
const MIN = 60 * SEC;

export const LIMITS = {
  // Folders opened: someone fetching a whole discography at once can reach the "likely" line, but not the "sure" one.
  crawl: { likely: { ms: 30 * SEC, n: 15 }, sure: { ms: MIN, n: 40 } },
  // Files and albums asked for.
  massFiles: { likely: { ms: 15 * MIN, n: 400 }, sure: { ms: 30 * MIN, n: 1000 } },
  massAlbums: { likely: { ms: 15 * MIN, n: 25 }, sure: { ms: 30 * MIN, n: 60 } },
  // Files actually taken.
  volume: { likely: { ms: 60 * MIN, n: 400 }, sure: { ms: 60 * MIN, n: 800 } },
};

/** The most events that fall inside any window of `ms` (times in ascending order), and when that window ended. */
function densest(times: number[], ms: number) {
  let best = { n: 0, end: 0, from: 0 };
  let j = 0;
  for (let i = 0; i < times.length; i++) {
    while (times[i] - times[j] > ms) j++;
    if (i - j + 1 > best.n) best = { n: i - j + 1, end: times[i], from: times[j] };
  }
  return best;
}

/** The most different albums inside any window of `ms`. */
function densestAlbums(items: { at: number; album: string }[], ms: number) {
  const inside = new Map<string, number>();
  let best = { n: 0, end: 0 };
  let j = 0;
  for (let i = 0; i < items.length; i++) {
    inside.set(items[i].album, (inside.get(items[i].album) ?? 0) + 1);
    while (items[i].at - items[j].at > ms) {
      const left = (inside.get(items[j].album) ?? 1) - 1;
      if (left) inside.set(items[j].album, left);
      else inside.delete(items[j].album);
      j++;
    }
    if (inside.size > best.n) best = { n: inside.size, end: items[i].at };
  }
  return best;
}

/** The album folder in a "requested" event ("Asked for Album › track.flac"). */
const albumOf = (detail: string) => detail.replace(/^Asked for\s*/, '').split(' › ')[0] ?? detail;

const minutes = (ms: number) => Math.max(1, Math.round(ms / MIN));

/** The people in the last day who look automated, the most serious reason for each. */
export function findAutomated(events: ActivityEvent[], now = Date.now(), horizon = 24 * 60 * MIN): Suspect[] {
  const byUser = new Map<string, ActivityEvent[]>();
  for (const e of events) {
    if (now - e.at > horizon) continue;
    const list = byUser.get(e.user);
    if (list) list.push(e);
    else byUser.set(e.user, [e]);
  }
  const out: Suspect[] = [];
  for (const [user, list] of byUser) {
    list.sort((a, b) => a.at - b.at);
    const found: Suspect[] = [];

    const folders = densest(list.filter((e) => e.kind === 'folder').map((e) => e.at), LIMITS.crawl.sure.ms);
    const quick = densest(list.filter((e) => e.kind === 'folder').map((e) => e.at), LIMITS.crawl.likely.ms);
    if (folders.n >= LIMITS.crawl.sure.n) found.push({ user, level: 'sure', kind: 'crawl', at: folders.end, summary: `Opened ${folders.n} of your folders in ${Math.max(1, Math.round((folders.end - folders.from) / SEC))} seconds` });
    else if (quick.n >= LIMITS.crawl.likely.n) found.push({ user, level: 'likely', kind: 'crawl', at: quick.end, summary: `Opened ${quick.n} of your folders in ${Math.max(1, Math.round((quick.end - quick.from) / SEC))} seconds` });

    const asked = list.filter((e) => e.kind === 'requested');
    const askedAt = asked.map((e) => e.at);
    const albums = asked.map((e) => ({ at: e.at, album: albumOf(e.detail) }));
    for (const level of ['sure', 'likely'] as const) {
      const f = densest(askedAt, LIMITS.massFiles[level].ms);
      const a = densestAlbums(albums, LIMITS.massAlbums[level].ms);
      if (f.n >= LIMITS.massFiles[level].n || a.n >= LIMITS.massAlbums[level].n) {
        const ms = LIMITS.massFiles[level].ms;
        found.push({ user, level, kind: 'mass', at: Math.max(f.end, a.end), summary: `Asked for ${f.n} files from ${a.n} albums within ${minutes(ms)} minutes` });
        break;
      }
    }

    const taken = densest(list.filter((e) => e.kind === 'uploaded').map((e) => e.at), LIMITS.volume.sure.ms);
    if (taken.n >= LIMITS.volume.sure.n) found.push({ user, level: 'sure', kind: 'volume', at: taken.end, summary: `Took ${taken.n} files in an hour` });
    else if (taken.n >= LIMITS.volume.likely.n) found.push({ user, level: 'likely', kind: 'volume', at: taken.end, summary: `Took ${taken.n} files in an hour` });

    if (!found.length) continue;
    found.sort((x, y) => (y.level === 'sure' ? 1 : 0) - (x.level === 'sure' ? 1 : 0) || y.at - x.at);
    out.push(found[0]);
  }
  return out.sort((x, y) => y.at - x.at);
}
