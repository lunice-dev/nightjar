import type { Transfer, TransferUser } from '../api/types';
import type { DownloadPlan } from '../prefs';
import { AUDIO_EXT, basename, extOf, parseRelease, splitFolder } from './quality';

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
  speed: number;
  phase: Phase;
  counts: Record<Phase, number>;
  placeInQueue?: number;
  /** When you queued it, for newest-first order. */
  time: number;
  plan?: DownloadPlan;
}

/**
 * Groups transfers into albums. Downloads that belong to one plan (one album
 * from several people) form a single group; anything else groups by person
 * and folder. Newest first.
 */
export function groupDownloads(users: TransferUser[], plans: DownloadPlan[] = []): DownloadGroup[] {
  const buckets = new Map<string, { files: Transfer[]; plan?: DownloadPlan; directory: string; username: string }>();
  for (const u of users) {
    for (const d of u.directories) {
      for (const f of d.files) {
        const plan = f.batchId ? plans.find((p) => p.batches.includes(f.batchId!)) : undefined;
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
    for (const f of files) {
      const p = phaseOf(f.state);
      counts[p]++;
      time = Math.min(time, Date.parse(f.requestedAt) || Infinity);
      if (p === 'cancelled') continue;
      size += f.size;
      transferred += p === 'done' ? f.size : f.bytesTransferred;
      if (p === 'active') speed += f.averageSpeed;
      if (f.placeInQueue) place = Math.min(place ?? Infinity, f.placeInQueue);
    }
    const phase: Phase = counts.active ? 'active' : counts.queued ? 'queued' : counts.failed ? 'failed' : counts.done ? 'done' : 'cancelled';
    const usernames = [...new Set(files.filter((f) => phaseOf(f.state) !== 'cancelled').map((f) => f.username))];
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
      phase,
      counts,
      placeInQueue: place,
      time: b.plan ? b.plan.createdAt : Number.isFinite(time) ? time : 0,
      plan: b.plan,
    });
  }
  return groups.sort((a, b) => b.time - a.time);
}

export const fileName = (t: Transfer) => basename(t.filename);

export function eta(remaining: number, speed: number) {
  if (speed <= 0 || remaining <= 0) return '';
  const s = Math.round(remaining / speed);
  if (s < 60) return `${s}s left`;
  if (s < 3600) return `${Math.round(s / 60)} min left`;
  return `${(s / 3600).toFixed(1)} h left`;
}
