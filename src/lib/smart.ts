import type { EnqueueFile, Transfer, TransferUser } from '../api/types';
import { usePrefs, type DownloadPlan, type PlanTrack, type SourceOption } from '../prefs';
import { useStore } from '../store';
import { AUDIO_EXT, basename, expectedTracks, extOf, type FolderResult, type Release } from './quality';
import { phaseOf, planFinder } from './transfers';
import { uuid } from './uuid';
import { isMismatch } from './identity';

// ---------------------------------------------------------------------------
// Why a download didn't happen, in plain words. The remote client sends a
// short reason ("File not shared.", "Too many files"); slskd adds its own for
// timeouts and dropped connections.

export function failureReason(t: Pick<Transfer, 'state' | 'exception'>): string | null {
  const s = t.state;
  if (!s.startsWith('Completed') || s === 'Completed, Succeeded' || s === 'Completed, Cancelled') return null;
  const e = (t.exception ?? '').toLowerCase();
  if (e.includes('file not shared')) return 'They no longer share this file';
  // Their file is no longer the one their search result listed (re-tagged or replaced since): it won't arrive as listed.
  if (e.includes('does not match expected size')) return 'Their copy changed since the search';
  if (e.includes('too many files') || e.includes('too many megabytes') || (e.includes('queue') && e.includes('limit')))
    return 'They limit how much one person can queue';
  if (e.includes('banned') || e.includes('blocked')) return 'They have blocked you';
  if (e.includes('disallowed') || e.includes('not allowed')) return 'They don’t allow this kind of file';
  if (e.includes('pending shutdown') || e.includes('shutting down')) return 'They were closing their client';
  if (e.includes('offline') || e.includes('not online')) return 'They went offline';
  if (e.includes('remote connection closed') || e.includes('connection reset')) return 'The connection dropped';
  if (e.includes('cancel')) return 'They cancelled it';
  if (s === 'Completed, TimedOut' || e.includes('timed out')) return 'They didn’t answer in time';
  if (s === 'Completed, Rejected') return t.exception ? `They refused: ${t.exception.replace(/\.$/, '')}` : 'They refused the download';
  if (t.exception) return t.exception.replace(/^.*?:\s*(?=[A-Z])/, '').slice(0, 120);
  return 'The download failed';
}

/** The size the other person's file really has, when it failed for not being the size their search listed. */
export function changedSize(t: Pick<Transfer, 'exception'>): number | undefined {
  const m = t.exception?.match(/remote size of (\d+) does not match/i);
  return m ? Number(m[1]) : undefined;
}

// ---------------------------------------------------------------------------
// How fast a source really is

/**
 * Speed to plan with: what this person actually sent you before (slskd keeps
 * that history), otherwise what their client advertises, which is often old
 * or optimistic.
 */
export function expectedSpeed(s: Pick<SourceOption, 'username' | 'uploadSpeed'>) {
  const measured = useStore.getState().speeds.get(s.username);
  return measured ?? s.uploadSpeed * 0.8;
}

/** Seconds until an album of this size would be done from this source. */
function etaOf(s: Pick<SourceOption, 'username' | 'uploadSpeed' | 'hasFreeUploadSlot' | 'queueLength'>, bytes = 400_000_000) {
  return (s.hasFreeUploadSlot ? 0 : 60 + s.queueLength * 30) + bytes / Math.max(expectedSpeed(s), 20_000);
}

/** Copies of the same album, quickest to arrive first. */
export function rankSources<T extends Pick<SourceOption, 'username' | 'uploadSpeed' | 'hasFreeUploadSlot' | 'queueLength'>>(list: T[]): T[] {
  // People who sent a fake copy before go last, however fast they are.
  const fakers = new Set(usePrefs.getState().fakes.map((f) => f.user));
  return [...list].sort((a, b) => Number(fakers.has(a.username)) - Number(fakers.has(b.username)) || etaOf(a) - etaOf(b));
}

/** The fastest copy among the given ones, for the Download button. */
export const fastestSource = (sources: FolderResult[]) => rankSources(sources)[0];

// ---------------------------------------------------------------------------
// Matching files between two copies of an album

const isAudioName = (name: string) => AUDIO_EXT.has(extOf(name));
const isImage = (name: string) => /\.(jpe?g|png|gif|bmp|webp)$/i.test(name);

function trackKey(path: string) {
  const name = basename(path).replace(/\.[^.]+$/, '').toLowerCase();
  const num = name.match(/^\s*(?:cd\s*\d+\s*[-.]?\s*)?(\d{1,3})\b/)?.[1];
  const words = name
    .replace(/^\s*\d{1,3}[\s._-]+/, '')
    .replace(/[([].*?[)\]]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return { num: num ? parseInt(num, 10) : undefined, words };
}

/** Finds the file in `option` that is the same track as `remotePath`. */
export function matchTrack(remotePath: string, option: Pick<SourceOption, 'files'>) {
  const want = trackKey(remotePath);
  const audio = option.files.filter((f) => isAudioName(f.filename));
  const byWords = want.words && audio.find((f) => trackKey(f.filename).words === want.words);
  if (byWords) return byWords;
  const byWordsLoose =
    want.words.length > 4 &&
    audio.find((f) => {
      const k = trackKey(f.filename).words;
      return k.includes(want.words) || want.words.includes(k);
    });
  if (byWordsLoose) return byWordsLoose;
  if (want.num !== undefined) {
    const candidates = audio.filter((f) => trackKey(f.filename).num === want.num);
    if (candidates.length === 1) return candidates[0];
  }
  return undefined;
}

/** True when every track of `a` exists in `b` with exactly the same size: the same rip. */
function sameRip(tracks: { name: string; size: number }[], b: Pick<SourceOption, 'files'>) {
  return tracks.every((t) => matchTrack(t.name, b)?.size === t.size);
}

// ---------------------------------------------------------------------------
// Starting a download

/**
 * Where to start an album from. A single fast copy loses to three identical
 * copies sending at once, so copies are grouped by their exact files (same
 * track sizes) and the group that can send fastest together wins; within it,
 * its fastest member is the one the album starts from.
 */
/**
 * The slowest a helper may be. Tracks are shared out in proportion to speed, and every helper gets at least one;
 * a helper at 1/n of the first copy's speed (n tracks) finishes its one track about when the first copy finishes
 * the rest. Slower than that, it would hold up the album's end. Never below 512 KB/s.
 */
const helperFloor = (firstSpeed: number, tracks: number) => Math.max(512 * 1024, firstSpeed / Math.max(tracks, 1));

const sigOf = (r: FolderResult) => r.audio.map((f) => f.size).sort((a, b) => a - b).join(',');
const groupCache = new WeakMap<Release, Map<string, FolderResult[]>>();

/** Copies of this release in the same quality and track count, grouped by their exact files. */
function rips(release: Release, like: FolderResult) {
  let groups = groupCache.get(release);
  if (!groups) {
    groups = new Map();
    for (const s of release.sources) {
      const key = `${s.tier}|${s.audio.length}|${sigOf(s)}`;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    groupCache.set(release, groups);
  }
  return groups.get(`${like.tier}|${like.audio.length}|${sigOf(like)}`) ?? [like];
}

/**
 * For the search list: how many people have exactly the files of this copy, and how many of them would
 * send it at once if you downloaded it now (free upload slot, and not too slow to help).
 */
export function sameFiles(release: Release, r: FolderResult) {
  const members = rips(release, r);
  const floor = helperFloor(expectedSpeed(r), r.audio.length);
  const helpers = r.audio.length < 4 ? 0 : members.filter((m) => m.key !== r.key && m.hasFreeUploadSlot && expectedSpeed(m) >= floor).length;
  return { copies: members.length, atOnce: Math.min(MAX_PARALLEL, 1 + helpers) };
}

export function bestStart(release: Release): FolderResult {
  // Copies whose track names aren't this album's are left out while any other copy exists.
  const trusted = release.sources.filter((s) => !isMismatch(s.key));
  const candidates = trusted.length ? trusted : release.sources;
  const best = isMismatch(release.best.key) && trusted.length ? trusted[0] : release.best;
  const pool = candidates.filter((s) => s.tier === best.tier && s.audio.length === best.audio.length);
  const groups = new Map<string, FolderResult[]>();
  for (const s of pool) {
    const sig = s.audio.map((f) => f.size).sort((a, b) => a - b).join(',');
    groups.set(sig, [...(groups.get(sig) ?? []), s]);
  }
  let pick = best;
  let pickSpeed = expectedSpeed(best) * (best.hasFreeUploadSlot ? 1 : 0.5);
  for (const members of groups.values()) {
    const ranked = rankSources(members);
    // The same rule Download uses: the fastest copy, plus helpers with a free slot that are fast enough to help.
    const lead = ranked[0];
    const floor = helperFloor(expectedSpeed(lead), lead.audio.length);
    const ready = [lead, ...ranked.slice(1).filter((s) => s.hasFreeUploadSlot && expectedSpeed(s) >= floor && lead.audio.length >= 4)].slice(0, MAX_PARALLEL);
    const speed = ready.reduce((n, s) => n + expectedSpeed(s), 0);
    if (speed > pickSpeed * 1.15) {
      pick = lead;
      pickSpeed = speed;
    }
  }
  return pick;
}

const toOption = (f: FolderResult): SourceOption => ({
  username: f.username,
  folder: f.folder,
  files: f.files.map((x) => ({ filename: x.filename, size: x.size })),
  uploadSpeed: f.uploadSpeed,
  hasFreeUploadSlot: f.hasFreeUploadSlot,
  queueLength: f.queueLength,
});

/** Splitting albums between people is on unless you turned it off. */
const parallelOn = (smart: { parallel?: boolean }) => smart.parallel !== false;

/** At most this many people send one album at the same time. */
const MAX_PARALLEL = 3;
/** Below this (bytes/s), a source counts as crawling whatever the others do. */
const MIN_SPEED = 150 * 1024;
/** A source sending at less than this share of the album's fastest source counts as slow. */
const SLOW_SHARE = 0.25;
/** How long a track must have been coming in before its speed is judged. */
const JUDGE_AFTER_MS = 20_000;
/** What starting a track again elsewhere costs: asking, queueing, connecting. */
const RESTART_COST_S = 15;

const safeFolder = (name: string) => name.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '_').replace(/[. ]+$/, '').slice(0, 120) || 'Nightjar download';

/**
 * Splits `n` tracks into contiguous runs, one per source, sized by how fast
 * each source is expected to be. Every source gets at least one track.
 */
export function splitRuns(n: number, weights: number[]) {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const counts = weights.map((w) => Math.max(1, Math.round((w / total) * n)));
  let diff = n - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; diff !== 0; i = (i + 1) % counts.length) {
    if (diff > 0) {
      counts[i]++;
      diff--;
    } else if (counts[i] > 1) {
      counts[i]--;
      diff++;
    }
  }
  return counts;
}

/**
 * Downloads `chosen`, splitting the album between up to three identical copies
 * when they exist, and remembers every other copy as a fallback.
 */
export async function smartDownload(release: Release, chosen: FolderResult) {
  const { backend, toast, refreshTransfers } = useStore.getState();
  if (!backend) return;
  const { smart } = usePrefs.getState();

  // A search result lists only the files that matched your words, and some clients cap how many they send.
  // Ask for the whole folder (and its disc folders) so the album arrives complete.
  const listed = await backend.folderContents(chosen.username, chosen.folder).catch(() => null);
  const byName = new Map(chosen.files.map((f) => [f.filename.toLowerCase(), { filename: f.filename, size: f.size }]));
  let found = 0;
  for (const f of listed ?? []) {
    if (byName.has(f.filename.toLowerCase()) || /(^|[\\/])(__MACOSX|\._[^\\/]*$)/.test(f.filename)) continue;
    byName.set(f.filename.toLowerCase(), f);
    if (isAudioName(f.filename)) found++;
  }
  const allFiles = [...byName.values()];
  const wanted = allFiles
    .filter((f) => isAudioName(f.filename))
    .sort((a, b) => a.filename.localeCompare(b.filename))
    .map((f) => ({ name: f.filename, size: f.size }));
  const expected = expectedTracks(release.sources).of;
  // Disc folders keep their own sub-folder ("Album\CD2"), so tracks with the same number don't collide.
  const destination = safeFolder(basename(chosen.folder));
  const destOf = (path: string) => {
    const dir = path.slice(0, Math.max(0, path.lastIndexOf('\\')));
    const sub = dir.length > chosen.folder.length ? dir.slice(chosen.folder.length + 1) : '';
    return sub ? `${destination}\\${sub.split('\\').map(safeFolder).join('\\')}` : undefined;
  };
  // Every other copy with exactly the same files (same tracks, same sizes): only those may send part of this album,
  // so the folder ends up as one copy. All of them count, not just the fastest few: a popular album can have
  // two hundred copies and only a handful identical.
  const others = release.sources.filter((s) => s.key !== chosen.key && s.tier === chosen.tier && s.audio.length === chosen.audio.length);
  const sources = rankSources(others.map(toOption).filter((s) => sameRip(wanted, s))).slice(0, 20);
  const identical = sources.map((s) => s.username);

  // Who sends what: the chosen copy plus the best identical copies that can start soon.
  // Helpers start only with a free upload slot and a speed worth having (see helperFloor); anyone slower would only
  // hold up the album's last track. Others can still join later, if they prove faster.
  const floor = helperFloor(expectedSpeed(chosen), wanted.length);
  const helpers =
    smart.enabled && parallelOn(smart) && wanted.length >= 4
      ? sources.filter((s) => s.hasFreeUploadSlot && expectedSpeed(s) >= floor).slice(0, MAX_PARALLEL - 1)
      : [];
  const team = [toOption(chosen), ...helpers];
  const runs = splitRuns(wanted.length, team.map((s) => expectedSpeed(s)));

  const tracks: PlanTrack[] = [];
  let at = 0;
  team.forEach((s, i) => {
    for (let k = 0; k < runs[i]; k++, at++) {
      const t = wanted[at];
      const file = i === 0 ? { filename: t.name, size: t.size } : matchTrack(t.name, s)!;
      tracks.push({ name: t.name, size: t.size, username: s.username, filename: file.filename, failedBy: [], dest: destOf(t.name) });
    }
  });

  const plan: DownloadPlan = {
    id: uuid(),
    key: chosen.key,
    title: chosen.title,
    artist: chosen.parent || undefined,
    destination,
    tracks,
    sources,
    identical,
    batches: [],
    notes: [],
    createdAt: Date.now(),
    expected: Math.max(expected, wanted.length),
  };
  if (found > 0)
    plan.notes.push({ at: Date.now(), text: `${chosen.username}'s folder has ${found} more ${found === 1 ? 'track' : 'tracks'} than the search showed: downloading all ${wanted.length}.` });
  const short = expected > 1 && wanted.length < expected * 0.75;
  if (short)
    plan.notes.push({ at: Date.now(), text: `${chosen.username} shares only ${wanted.length} of this album's ${expected} tracks.` });

  // Covers, logs and cues come from the chosen copy along with its tracks.
  const extras = allFiles.filter((f) => !isAudioName(f.filename)).map((f) => ({ ...f, dest: destOf(f.filename) }));
  const failures: string[] = [];
  for (const s of team) {
    const files: (EnqueueFile & { dest?: string })[] = tracks.filter((t) => t.username === s.username).map((t) => ({ filename: t.filename, size: t.size, dest: t.dest }));
    // The cover first, so the album shows its art while the tracks are still coming.
    if (s.username === chosen.username) files.unshift(...[...extras].sort((a, b) => Number(isImage(b.filename)) - Number(isImage(a.filename))));
    // One batch per folder: the album's own, and each disc folder.
    const byDest = new Map<string, EnqueueFile[]>();
    for (const f of files) byDest.set(f.dest ?? '', [...(byDest.get(f.dest ?? '') ?? []), { filename: f.filename, size: f.size }]);
    try {
      for (const [dest, list] of byDest) {
        const batchId = uuid();
        await backend.enqueue(s.username, list, { batchId, destination: dest || plan.destination });
        plan.batches.push(batchId);
      }
    } catch {
      failures.push(s.username);
    }
  }
  // A helper that couldn't be reached: its tracks go back to the chosen copy.
  if (failures.length && !failures.includes(chosen.username)) {
    const back = tracks.filter((t) => failures.includes(t.username));
    back.forEach((t) => {
      t.failedBy.push(t.username);
      t.username = chosen.username;
      t.filename = t.name;
    });
    for (const dest of new Set(back.map((t) => t.dest))) {
      const batchId = uuid();
      const list = back.filter((t) => t.dest === dest).map((t) => ({ filename: t.filename, size: t.size }));
      await backend.enqueue(chosen.username, list, { batchId, destination: dest ?? plan.destination }).catch(() => undefined);
      plan.batches.push(batchId);
    }
  } else if (failures.includes(chosen.username)) {
    toast(`${chosen.username} is offline. Try another source.`, 'error');
    if (plan.batches.length === 0) return;
  }

  const used = [...new Set(tracks.map((t) => t.username))];
  if (used.length > 1) {
    const parts = used.map((u) => `${u} (${tracks.filter((t) => t.username === u).length})`);
    plan.notes.push({ at: Date.now(), text: `Downloading from ${used.length} people at once: ${listOf(parts)}.` });
  }
  usePrefs.getState().addPlan(plan);
  useStore.setState((st) => ({ queuedKeys: new Set([...st.queuedKeys, ...chosen.files.map((f) => `${chosen.username}\u0000${f.filename}`)]) }));
  if (short) toast(`${chosen.username} shares only ${wanted.length} of the ${expected} tracks of ${chosen.title}. Downloading those; a complete copy is usually further down the list.`, 'error');
  else toast(used.length > 1 ? `Queued ${chosen.title} from ${used.length} people at once` : `Queued ${chosen.title} from ${chosen.username}`);
  refreshTransfers('download');
}

export const listOf = (items: string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

// ---------------------------------------------------------------------------
// The manager: every few seconds, keeps each album moving.

const stuckSince = new Map<string, number>(); // transfer id → when its queue position last changed
/** First time each running transfer was seen, and how much it had then: its real speed since. */
const firstSeen = new Map<string, { at: number; bytes: number }>();

function liveSpeed(t: Transfer, now: number) {
  const seen = firstSeen.get(t.id);
  if (!seen) {
    firstSeen.set(t.id, { at: now, bytes: t.bytesTransferred });
    return undefined;
  }
  const secs = (now - seen.at) / 1000;
  if (secs * 1000 < JUDGE_AFTER_MS) return undefined;
  const own = (t.bytesTransferred - seen.bytes) / secs;
  // slskd's own average covers the whole transfer; the worse of the two is the honest one.
  return t.averageSpeed > 0 ? Math.min(own, t.averageSpeed) : own;
}
const lastPlace = new Map<string, number>();

/** The newest transfer for this user and file. */
function latest(transfers: Transfer[], username: string, filename: string) {
  let best: Transfer | undefined;
  for (const t of transfers) {
    if (t.username !== username || t.filename !== filename) continue;
    if (!best || Date.parse(t.requestedAt) > Date.parse(best.requestedAt)) best = t;
  }
  return best;
}

const notStarted = (t: Transfer | undefined) => !!t && t.bytesTransferred === 0 && (t.state.startsWith('Queued') || t.state === 'Requested');

export async function manageDownloads() {
  const { smart, plans, updatePlan } = usePrefs.getState();
  const { backend, downloads, toast } = useStore.getState();
  if (!backend || !smart.enabled) return;

  const transfers = downloads.flatMap((u: TransferUser) => u.directories.flatMap((d) => d.files));
  const now = Date.now();

  const planOf = planFinder(plans);
  for (const plan of plans) {
    if (plan.finishedAt) continue;
    // Paused because its files are another album: nothing moves until you decide (Downloads).
    if (plan.identity?.state === 'mismatch') continue;
    const mine = transfers.filter((t) => planOf(t) === plan);
    if (mine.length === 0) {
      // Cleared from the list, or not created yet; give up on it after a day.
      if (now - plan.createdAt > 86_400_000) updatePlan(plan.id, { finishedAt: now });
      continue;
    }

    // Tidy up: entries we cancelled while moving a track elsewhere.
    for (const t of mine) {
      if (t.state !== 'Completed, Cancelled') continue;
      const owner = plan.tracks.find((k) => k.username === t.username && k.filename === t.filename);
      if (!owner || owner.dropped) continue;
      const current = latest(mine, t.username, t.filename);
      if (current && current.id !== t.id) backend.cancel('download', t.username, t.id, true).catch(() => undefined);
    }

    const state = plan.tracks.map((k) => ({ k, t: latest(mine, k.username, k.filename) }));
    // You cancelled a track yourself: stop managing it.
    let changed = false;
    for (const { k, t } of state) {
      if (t?.state === 'Completed, Cancelled' && !k.dropped && !movedRecently.has(t.id)) {
        k.dropped = true;
        changed = true;
      }
    }
    const live = state.filter(({ k }) => !k.dropped);
    if (live.every(({ t }) => t && phaseOf(t.state) === 'done')) {
      updatePlan(plan.id, { finishedAt: now, tracks: plan.tracks });
      continue;
    }

    // 0. Tracks that failed because of this computer (the engine restarted while they were coming in): not the
    //    other person's fault, so ask the same person again, up to three times.
    const ours = live.filter(({ k, t }) => t && phaseOf(t.state) === 'failed' && ourFault(t) && (k.retries ?? 0) < 3);
    if (ours.length) {
      const user = ours[0].k.username;
      const dest = ours[0].k.dest;
      const again = ours.filter(({ k }) => k.username === user && k.dest === dest);
      for (const { k, t } of again) {
        await backend.cancel('download', t!.username, t!.id, true).catch(() => undefined);
        k.retries = (k.retries ?? 0) + 1;
      }
      const batchId = uuid();
      await backend
        .enqueue(user, again.map(({ k }) => ({ filename: k.filename, size: k.size })), { batchId, destination: dest ?? plan.destination })
        .catch(() => undefined);
      const n = again.length;
      updatePlan(plan.id, {
        tracks: [...plan.tracks],
        batches: [...plan.batches, batchId],
        notes: [...plan.notes, { at: now, text: `Asked ${user} again for ${n} ${n === 1 ? 'track' : 'tracks'}: Nightjar's engine restarted while ${n === 1 ? 'it was' : 'they were'} coming in.` }],
      });
      useStore.getState().refreshTransfers('download');
      return;
    }

    // 1. Tracks that need a new home: refused or failed, or stuck in a remote queue.
    const needy: { i: number; why: string }[] = [];
    live.forEach(({ k, t }) => {
      if (!t) return;
      const i = plan.tracks.indexOf(k);
      const phase = phaseOf(t.state);
      if (phase === 'failed') needy.push({ i, why: failureReason(t) ?? 'it failed' });
      else if (t.state === 'Queued, Remotely') {
        const place = t.placeInQueue ?? 0;
        if (lastPlace.get(t.id) !== place) {
          lastPlace.set(t.id, place);
          stuckSince.set(t.id, now);
        }
        if (now - (stuckSince.get(t.id) ?? now) > smart.queueMinutes * 60_000)
          needy.push({ i, why: `you waited in their queue for ${smart.queueMinutes} minutes` });
      }
    });

    // Someone who refuses one track (not shared, blocked, queue limit, gone, changed their copy) will refuse the rest too.
    const refusers = new Set(
      needy
        .map(({ i }) => live.find(({ k }) => plan.tracks.indexOf(k) === i)!)
        .filter(({ t }) => t && /no longer share|blocked|limit how much|went offline|refused|copy changed/i.test(failureReason(t) ?? ''))
        .map(({ k }) => k.username),
    );
    live.forEach(({ k, t }) => {
      const i = plan.tracks.indexOf(k);
      if (refusers.has(k.username) && notStarted(t) && !needy.some((n) => n.i === i)) needy.push({ i, why: needy.find((n) => plan.tracks[n.i].username === k.username)!.why });
    });

    // How fast each person has really been on this album: tracks finished, and tracks coming in now.
    const observed = new Map<string, number>();
    for (const t of mine) {
      const v = t.state === 'InProgress' ? (liveSpeed(t, now) ?? 0) : phaseOf(t.state) === 'done' && t.averageSpeed > 0 ? t.averageSpeed : 0;
      if (v > (observed.get(t.username) ?? 0)) observed.set(t.username, v);
    }
    const fastest = Math.max(0, ...observed.values());
    const busy = (u: string) => live.some(({ k, t }) => k.username === u && t && ['active', 'queued'].includes(phaseOf(t.state)));
    const failed = (u: string) => plan.tracks.some((k) => k.failedBy.includes(u));

    // 1b. A track coming in far slower than this album's other sources goes to a faster one, but only when
    //     starting it again there finishes sooner than waiting, and never more than twice per track.
    const slowIdx = new Set<number>();
    const quietIdx = new Set<number>(); // moves that only go in the notes, no message
    if (needy.length === 0) {
      for (const { k, t } of live) {
        if (!t || t.state !== 'InProgress' || (k.slowMoves ?? 0) >= 2) continue;
        const v = liveSpeed(t, now);
        if (v === undefined) continue;
        const i = plan.tracks.indexOf(k);
        const target = pickTarget(plan, k, observed, busy);
        if (!target) continue;
        const remaining = Math.max(0, k.size - t.bytesTransferred);
        const crawling = v < MIN_SPEED;
        const slow = v < fastest * SLOW_SHARE;
        const restartWins = remaining / Math.max(v, 1) > k.size / Math.max(target.speed, 1) + RESTART_COST_S;
        if ((crawling || slow) && restartWins && target.speed > v * 2) {
          needy.push({ i, why: `it was coming in at only ${speedText(v)}` });
          slowIdx.add(i);
          break; // one at a time
        }
      }
    }

    // 1c. Someone caught sending slowly on this album gets no more of it: their tracks that haven't started go too.
    if (needy.length === 0) {
      const slowPeople = new Set(plan.tracks.filter((k) => (k.slowMoves ?? 0) > 0).flatMap((k) => k.failedBy));
      const waiting = live.filter(({ k, t }) => slowPeople.has(k.username) && notStarted(t));
      if (waiting.length && waiting.some(({ k }) => pickTarget(plan, k, observed, busy))) {
        for (const { k } of waiting) {
          const i = plan.tracks.indexOf(k);
          needy.push({ i, why: `${k.username} was sending slowly` });
          quietIdx.add(i);
        }
      }
    }

    // 2. Otherwise, a source that has finished its share takes tracks still waiting elsewhere.
    let steal: { from: string; to: string; idx: number[] } | undefined;
    if (needy.length === 0 && parallelOn(smart)) {
      const pending = new Map<string, number[]>();
      live.forEach(({ k, t }) => {
        if (notStarted(t)) pending.set(k.username, [...(pending.get(k.username) ?? []), plan.tracks.indexOf(k)]);
      });
      // Only people already sending part of this album, with the identical copy; the fastest idle one first.
      const inPlan = new Set(plan.tracks.map((k) => k.username));
      const team = [...inPlan]
        .filter((u) => (u === firstSource(plan) || plan.identical.includes(u)) && !failed(u) && (observed.get(u) ?? MIN_SPEED) >= MIN_SPEED)
        .sort((a, b) => (observed.get(b) ?? 0) - (observed.get(a) ?? 0));
      let to = team.find((u) => !busy(u));
      // Nobody idle: bring in another identical copy, up to three people sending this album.
      const sending = new Set(live.filter(({ t }) => t && ['active', 'queued'].includes(phaseOf(t.state))).map(({ k }) => k.username));
      if (!to && sending.size < MAX_PARALLEL) {
        to = plan.sources.find((s) => plan.identical.includes(s.username) && !inPlan.has(s.username) && !failed(s.username) && s.hasFreeUploadSlot)?.username;
      }
      // Waiting tracks move to someone idle: half of a long wait, or a single track when the receiver is no slower.
      const donor = [...pending]
        .filter(([u, idx]) => u !== to && (idx.length >= 2 || (observed.get(to ?? '') ?? 0) >= (observed.get(u) ?? 0)))
        .sort((a, b) => b[1].length - a[1].length)[0];
      if (to && donor) steal = { from: donor[0], to, idx: donor[1].length === 1 ? donor[1] : donor[1].slice(Math.ceil(donor[1].length / 2)) };
    }

    if (needy.length === 0 && !steal) {
      if (changed) updatePlan(plan.id, { tracks: plan.tracks });
      continue;
    }

    // Moving tracks: cancel the old entries first so nothing downloads twice.
    const moves: { i: number; to: SourceOption | 'first'; why: string }[] = [];
    if (steal) {
      const to = steal.to === firstSource(plan) ? 'first' : plan.sources.find((s) => s.username === steal!.to)!;
      steal.idx.forEach((i) => moves.push({ i, to, why: `${steal!.to} finished first` }));
    } else {
      for (const { i, why } of needy) {
        const k = plan.tracks[i];
        // Only identical copies (the album stays one copy, never a mix of files), the fastest proven one first.
        const next = pickTarget(plan, k, observed, busy);
        if (!next) continue;
        moves.push({ i, to: next.to, why });
      }
      if (moves.length === 0) {
        if (!plan.notes.some((n) => n.text.startsWith('No other'))) {
          updatePlan(plan.id, { notes: [...plan.notes, { at: now, text: 'No other identical copy left to try. Search again, or choose a different copy of the album.' }] });
        }
        continue;
      }
    }

    // Group by destination source; one enqueue (one batch) per source.
    const bySource = new Map<string, typeof moves>();
    moves.forEach((m) => {
      const u = m.to === 'first' ? firstSource(plan) : m.to.username;
      bySource.set(u, [...(bySource.get(u) ?? []), m]);
    });
    const [toUser, all] = [...bySource][0];
    // One folder per batch (disc folders are separate); the rest follow on the next pass.
    const group = all.filter((m) => plan.tracks[m.i].dest === plan.tracks[all[0].i].dest);
    const groupDest = plan.tracks[group[0].i].dest;
    const files: EnqueueFile[] = [];
    const fromUsers = new Set<string>();
    for (const m of group) {
      const k = plan.tracks[m.i];
      const t = latest(mine, k.username, k.filename);
      if (t && !t.state.startsWith('Completed')) {
        movedRecently.add(t.id);
        await backend.cancel('download', t.username, t.id, false).catch(() => undefined);
      } else if (t) {
        await backend.cancel('download', t.username, t.id, true).catch(() => undefined);
      }
      fromUsers.add(k.username);
      if (!steal) k.failedBy = [...new Set([...k.failedBy, k.username])];
      if (slowIdx.has(m.i)) k.slowMoves = (k.slowMoves ?? 0) + 1;
      const file = m.to === 'first' ? { filename: k.name, size: k.size } : matchTrack(k.name, m.to)!;
      k.username = toUser;
      k.filename = file.filename;
      files.push({ filename: file.filename, size: file.size });
    }
    const batchId = uuid();
    try {
      await backend.enqueue(toUser, files, { batchId, destination: groupDest ?? plan.destination });
    } catch {
      // That source isn't reachable: count it as failed for these tracks and try again next round.
      group.forEach((m) => plan.tracks[m.i].failedBy.push(toUser));
    }
    const n = group.length;
    const why = group[0].why;
    const text = `Moved ${n} ${n === 1 ? 'track' : 'tracks'} from ${listOf([...fromUsers])} to ${toUser}: ${why.charAt(0).toLowerCase()}${why.slice(1)}.`;
    // Refusals are worth a word; routine speed-ups only go in the album's notes.
    if (!steal && slowIdx.size === 0 && quietIdx.size === 0) toast(`${plan.title}\n${text}`);
    updatePlan(plan.id, { tracks: [...plan.tracks], batches: [...plan.batches, batchId], notes: addNote(plan.notes, now, n, [...fromUsers], toUser, why) });
    useStore.getState().refreshTransfers('download');
    return; // one move per pass keeps the network calm
  }
}

/**
 * Where a track should go next: someone with exactly the same file who hasn't failed it, fastest first by what
 * they really sent on this album (or before), idle people before busy ones. The album's first copy counts too.
 */
function pickTarget(
  plan: DownloadPlan,
  k: PlanTrack,
  observed: Map<string, number>,
  busy: (u: string) => boolean,
): { to: SourceOption | 'first'; username: string; speed: number } | undefined {
  const tried = new Set([...k.failedBy, k.username]);
  const slowAnywhere = (u: string) => plan.tracks.some((x) => x.failedBy.includes(u) && (x.slowMoves ?? 0) > 0);
  const options: { to: SourceOption | 'first'; username: string; speed: number }[] = [];
  const first = firstSource(plan);
  if (!tried.has(first) && !slowAnywhere(first)) options.push({ to: 'first', username: first, speed: observed.get(first) ?? useStore.getState().speeds.get(first) ?? 0 });
  for (const s of plan.sources) {
    if (!plan.identical.includes(s.username) || tried.has(s.username) || slowAnywhere(s.username) || !matchTrack(k.name, s)) continue;
    const seen = observed.get(s.username);
    // Someone not tried yet: their known speed, discounted when they have a queue.
    const speed = seen ?? expectedSpeed(s) * (s.hasFreeUploadSlot ? 1 : 0.3);
    options.push({ to: s, username: s.username, speed });
  }
  options.sort((a, b) => b.speed * (busy(b.username) ? 0.5 : 1) - a.speed * (busy(a.username) ? 0.5 : 1));
  return options[0];
}

const speedText = (bytesPerSecond: number) =>
  bytesPerSecond >= 1024 * 1024 ? `${(bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s` : `${Math.round(bytesPerSecond / 1024)} KB/s`;

/** Adds "Moved N tracks from A to B: why", folding repeats of the same move into one line. */
function addNote(notes: DownloadPlan['notes'], at: number, n: number, from: string[], to: string, why: string) {
  const reason = `${why.charAt(0).toLowerCase()}${why.slice(1)}`;
  const last = notes[notes.length - 1];
  const m = last?.text.match(/^Moved (\d+) tracks? from (.+) to (.+?): (.*)\.$/);
  if (m && m[2] === listOf(from) && m[3] === to && m[4] === reason) n += parseInt(m[1], 10);
  const text = `Moved ${n} ${n === 1 ? 'track' : 'tracks'} from ${listOf(from)} to ${to}: ${reason}.`;
  return m && m[2] === listOf(from) && m[3] === to && m[4] === reason ? [...notes.slice(0, -1), { at, text }] : [...notes, { at, text }];
}

/** A failure caused on this computer, not by the other person: the engine stopped, or the disk refused the file. */
export const ourFault = (t: Pick<Transfer, 'exception'>) =>
  /application shut ?down|no space left|disk (is )?full|being used by another process|access to the path/i.test(t.exception ?? '');

/** Transfers this manager cancelled on purpose, so they don't read as "you cancelled it". */
const movedRecently = new Set<string>();

/** The copy the album was started from. */
const firstSource = (plan: DownloadPlan) => plan.key.split('\u0000')[0];

