import type { DownloadPlan } from '../prefs';

const SAME_ALBUM_WITHIN_MS = 6 * 3_600_000;

const sameAlbum = (a: DownloadPlan, b: DownloadPlan) =>
  a.key === b.key && a.destination.toLowerCase() === b.destination.toLowerCase() && Math.abs(a.createdAt - b.createdAt) < SAME_ALBUM_WITHIN_MS;

/**
 * The same album asked for twice, minutes apart (two clicks, or two devices), is one album: its plans fold into the
 * oldest one, so there is one card and one set of files to look after. Plans that are far apart in time stay apart:
 * that is the album downloaded again on purpose.
 */
export function mergeDuplicatePlans(plans: DownloadPlan[]): DownloadPlan[] {
  const oldestFirst = [...plans].sort((a, b) => a.createdAt - b.createdAt);
  const kept: DownloadPlan[] = [];
  for (const p of oldestFirst) {
    const into = kept.find((k) => sameAlbum(k, p));
    if (!into) {
      kept.push(p);
      continue;
    }
    const have = new Set(into.tracks.map((t) => `${t.username}\u0000${t.filename}`));
    const merged: DownloadPlan = {
      ...into,
      batches: [...new Set([...into.batches, ...p.batches])],
      tracks: [...into.tracks, ...p.tracks.filter((t) => !have.has(`${t.username}\u0000${t.filename}`))],
      notes: [...into.notes, ...p.notes].sort((a, b) => a.at - b.at),
      finishedAt: into.finishedAt && p.finishedAt ? Math.max(into.finishedAt, p.finishedAt) : undefined,
    };
    kept[kept.indexOf(into)] = merged;
  }
  // Keep the order the list had (newest first).
  return kept.sort((a, b) => b.createdAt - a.createdAt);
}
