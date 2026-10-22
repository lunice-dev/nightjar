import type { TransferUser } from '../api/types';
import type { SentFile } from '../prefs';

const WEEK = 7 * 24 * 3600_000;

/**
 * What your share did: who is downloading from you right now and how fast, and
 * over the last week how many people, how much and at what average speed.
 */
export function uploadStats(live: TransferUser[], sent: SentFile[], now = Date.now()) {
  let nowSpeed = 0;
  const nowPeople = new Set<string>();
  let waiting = 0;
  let sending = 0;
  for (const u of live)
    for (const d of u.directories)
      for (const f of d.files) {
        if (f.state === 'InProgress') {
          nowSpeed += f.averageSpeed;
          nowPeople.add(u.username);
          sending += f.bytesTransferred;
        } else if (f.state.startsWith('Queued')) waiting++;
      }
  const week = sent.filter((f) => f.at >= now - WEEK);
  // What's being sent right now counts too.
  const bytes = week.reduce((n, f) => n + f.bytes, 0) + sending;
  const people = new Set([...week.map((f) => f.user), ...nowPeople]);
  // Average weighted by size: a big file sent slowly counts more than a cover sent fast.
  const weighted = week.filter((f) => f.speed > 0);
  const weight = weighted.reduce((n, f) => n + f.bytes, 0);
  const avg = weight ? weighted.reduce((n, f) => n + f.speed * f.bytes, 0) / weight : 0;
  return {
    now: { people: nowPeople.size, speed: nowSpeed, waiting },
    week: { people: people.size, files: week.length, bytes, avgSpeed: avg },
  };
}
