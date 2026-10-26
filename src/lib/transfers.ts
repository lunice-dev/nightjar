import type { Transfer, TransferUser } from '../api/types';
import type { DownloadPlan } from '../prefs';
import { AUDIO_EXT, basename, extOf, parseRelease, splitFolder } from './quality';
import { sourceRates } from './rates';

export type Phase = 'active' | 'queued' | 'done' | 'failed' | 'cancelled';

export function phaseOf(state: string): Phase {
  if (state === 'Completed, Succeeded') return 'done';
  if (state === 'Completed, Cancelled') return 'cancelled';
  if (state.startsWith('Completed')) return 'failed';
  if (state === 'InProgress' || state === 'Initializing') return 'active';
  return 'queued';
}

export interface DownloadGroup {
  key: string;
  /** The first (or only) person sending this album. */
  username: string;
  /** Everyone sending part of it. */
  usernames: string[];
  directory: string;
  title: string;
  parent: string;
  files: Transfer[];
  size: number;
  transferred: number;
  /** Bytes per second arriving now, all sources together: the sum of `sources`. */
  speed: number;
  /** Each person sending part of it and how fast, fastest first. */
  sources: { username: string; speed: number }[];
  phase: Phase;
  counts: Record<Phase, number>;
  placeInQueue?: number;
  /** When you queued it, for newest-first order. */
  time: number;
  /** When the first file was asked for, the first one started, and the last one ended (ms; 0 if not yet). */
  requestedAt: number;
  startedAt: number;
  endedAt: number;
  plan?: DownloadPlan;
}

/**
 * Finds the album (plan) a download belongs to: by its batch, which every download Nightjar starts carries; or, for
 * one without (slskd asks again for downloads that were interrupted when it stopped, as new entries with no batch),
 * by who sends it and from which folder. Then a restart in the middle of an album doesn't split it in two.
 */
export function planFinder(plans: DownloadPlan[]) {
  const byBatch = new Map<string, DownloadPlan>();
  const byFolder = new Map<string, DownloadPlan>();
  // Oldest first, so a folder downloaded again later belongs to its latest plan.
  for (const p of [...plans].sort((a, b) => a.createdAt - b.createdAt)) {
    for (const b of p.batches) byBatch.set(b, p);
    for (const k of p.tracks) byFolder.set(folderKey(k.username, k.filename), p);
  }
  return (t: Pick<Transfer, 'batchId' | 'username' | 'filename'>) =>
    (t.batchId ? byBatch.get(t.batchId) : undefined) ?? (!t.batchId || !byBatch.has(t.batchId) ? byFolder.get(folderKey(t.username, t.filename)) : undefined);
}

const folderKey = (username: string, filename: string) => `${username}\u0000${filename.slice(0, Math.max(0, filename.lastIndexOf('\\'))).toLowerCase()}`;

/**
 * Groups transfers into albums. Downloads that belong to one plan (one album
 * from several people) form a single group; anything else groups by person
 * and folder. Newest first.
 */
export function groupDownloads(users: TransferUser[], plans: DownloadPlan[] = []): DownloadGroup[] {
  const buckets = new Map<string, { files: Transfer[]; plan?: DownloadPlan; directory: string; username: string }>();
  const planOf = planFinder(plans);
  for (const u of users) {
    for (const d of u.directories) {
      for (const f of d.files) {
        const plan = planOf(f);
        const key = plan ? `plan:${plan.id}` : `${u.username}\u0000${d.directory}`;
        const b = buckets.get(key) ?? { files: [], plan, directory: d.directory, username: u.username };
        b.files.push(f);
        buckets.set(key, b);
      }
    }
  }

  const groups: DownloadGroup[] = [];
  for (const [key, b] of buckets) {
    let files = b.files;
    if (b.plan) {
      // A track moved to another person leaves the old entry behind; show only who sends it now.
      const current = new Set(b.plan.tracks.map((k) => `${k.username}\u0000${k.filename}`));
      files = files.filter((f) => !AUDIO_EXT.has(extOf(f.filename)) || current.has(`${f.username}\u0000${f.filename}`));
      const newest = new Map<string, Transfer>();
      for (const f of files) {
        const id = `${f.username}\u0000${f.filename}`;
        const had = newest.get(id);
        if (!had || Date.parse(f.requestedAt) > Date.parse(had.requestedAt)) newest.set(id, f);
      }
      files = [...newest.values()];
    }
    if (files.length === 0) continue;
    files = [...files].sort((a, b) => basename(a.filename).localeCompare(basename(b.filename)));

    const counts: Record<Phase, number> = { active: 0, queued: 0, done: 0, failed: 0, cancelled: 0 };
    let size = 0;
    let transferred = 0;
    let speed = 0;
    let place: number | undefined;
    let time = Infinity;
    let started = Infinity;
    let ended = 0;
    for (const f of files) {
      const p = phaseOf(f.state);
      counts[p]++;
      time = Math.min(time, timeOf(f.requestedAt) || Infinity);
      started = Math.min(started, timeOf(f.startedAt) || Infinity);
      ended = Math.max(ended, timeOf(f.endedAt));
      if (p === 'cancelled') continue;
      size += f.size;
      transferred += p === 'done' ? f.size : f.bytesTransferred;
      if (p === 'active') speed += f.averageSpeed;
      if (f.placeInQueue) place = Math.min(place ?? Infinity, f.placeInQueue);
    }
    const phase: Phase = counts.active ? 'active' : counts.queued ? 'queued' : counts.failed ? 'failed' : counts.done ? 'done' : 'cancelled';
    const usernames = [...new Set(files.filter((f) => phaseOf(f.state) !== 'cancelled').map((f) => f.username))];
    // What really arrived over the last seconds; slskd's per-file averages until there's enough history.
    const measured = sourceRates(
      key,
      files.map((f) => ({ id: f.id, username: f.username, bytes: phaseOf(f.state) === 'done' ? f.size : f.bytesTransferred })),
    );
    const slskdSpeed = (u: string) => files.filter((f) => f.username === u && phaseOf(f.state) === 'active').reduce((n, f) => n + f.averageSpeed, 0);
    const sources = (usernames.length ? usernames : [b.username])
      .map((u) => ({ username: u, speed: phase === 'active' ? (measured ? (measured.get(u) ?? 0) : slskdSpeed(u)) : 0 }))
      .sort((x, y) => y.speed - x.speed);
    if (measured && phase === 'active') speed = sources.reduce((n, s) => n + s.speed, 0);
    let title: string;
    let parent: string;
    if (b.plan) {
      title = b.plan.title;
      parent = b.plan.artist ?? '';
    } else {
      const folder = splitFolder(`${b.directory}\\x`);
      ({ album: title, artist: parent } = parseRelease(folder.title, folder.parent));
    }
    groups.push({
      key,
      username: b.plan ? b.plan.key.split('\u0000')[0] : b.username,
      usernames: usernames.length ? usernames : [b.username],
      directory: b.directory,
      title,
      parent,
      files,
      size,
      transferred,
      speed,
      sources,
      phase,
      counts,
      placeInQueue: place,
      time: b.plan ? b.plan.createdAt : Number.isFinite(time) ? time : 0,
      requestedAt: Number.isFinite(time) ? time : 0,
      startedAt: Number.isFinite(started) ? started : 0,
      endedAt: ended,
      plan: b.plan,
    });
  }
  return groups.sort((a, b) => b.time - a.time);
}

export const fileName = (t: Transfer) => basename(t.filename);

/** A transfer timestamp in ms. The engine stores UTC; a time without a zone is read as UTC, not local time. */
export function timeOf(iso?: string | null) {
  if (!iso) return 0;
  const t = Date.parse(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(t) ? t : 0;
}

/** "13:42" today, "Yesterday 21:05", "Wed 22 Oct 09:10" this year, with the year after that. */
export function clock(t: number, now = Date.now()) {
  const d = new Date(t);
  const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const day = dayLabel(t, now);
  return day === 'Today' ? hm : `${day} ${hm}`;
}

/** The heading for a day: Today, Yesterday, then "Wed 22 Oct". */
export function dayLabel(t: number, now = Date.now()) {
  const d = new Date(t);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (t >= start.getTime()) return 'Today';
  if (t >= start.getTime() - 86_400_000) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== start.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}

/** A span of time in words: "40 s", "12 min", "2 h 5 min", "3 days". */
export function span(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.round(h / 24)} days`;
}

export function eta(remaining: number, speed: number) {
  if (speed <= 0 || remaining <= 0) return '';
  const s = Math.round(remaining / speed);
  if (s < 60) return `${s}s left`;
  if (s < 3600) return `${Math.round(s / 60)} min left`;
  return `${(s / 3600).toFixed(1)} h left`;
}
