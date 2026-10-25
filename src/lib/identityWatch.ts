import type { Transfer, TransferUser } from '../api/types';
import { usePrefs, type DownloadPlan } from '../prefs';
import { useStore } from '../store';
import { tagsSayOtherAlbum } from './identity';
import { AUDIO_EXT, extOf } from './quality';
import { phaseOf } from './transfers';
import { uuid } from './uuid';

/**
 * While an album downloads: as soon as enough of a track has arrived (its tags sit at the start of the file), read
 * whose album it really is. When the tags name another artist AND another album, the rest is paused, you're told,
 * and the person is remembered (their copies go last in searches). Downloads shows what happened, with
 * "Delete it" and "Keep downloading".
 */

/**
 * Enough of a track for its tags. A FLAC's come first and Nightjar reads them even when a picture after them is
 * still arriving; an MP3's pictures can come before them, so a little more than the minimum.
 */
const enough = (filename: string) => (extOf(filename) === 'flac' ? 64 * 1024 : 384 * 1024);
const tries = new Map<string, { n: number; at: number }>();

export async function watchIdentity(notify: (title: string, body?: string) => void) {
  const { plans, updatePlan, recordFake } = usePrefs.getState();
  const { backend, downloads, toast } = useStore.getState();
  if (!backend) return;
  const transfers: Transfer[] = downloads.flatMap((u: TransferUser) => u.directories.flatMap((d) => d.files));
  const now = Date.now();

  for (const plan of plans) {
    if (plan.finishedAt || plan.identity || !plan.title) continue;
    const mine = transfers.filter((t) => t.batchId && plan.batches.includes(t.batchId) && AUDIO_EXT.has(extOf(t.filename)));
    const ready = mine.filter((t) => phaseOf(t.state) === 'done' || t.bytesTransferred >= enough(t.filename)).sort((a, b) => b.bytesTransferred - a.bytesTransferred);
    if (!ready.length) continue;
    const tried = tries.get(plan.id) ?? { n: 0, at: 0 };
    // Again on the next round (every 5 s) while more of the track arrives: a fast album is done in seconds.
    if (now - tried.at < 4000) continue;
    if (tried.n >= 12) {
      updatePlan(plan.id, { identity: { state: 'ok', at: now } }); // no readable tags: nothing to judge by
      continue;
    }
    tries.set(plan.id, { n: tried.n + 1, at: now });

    const t = ready[0];
    const dest = plan.tracks.find((k) => k.username === t.username && k.filename === t.filename)?.dest ?? plan.destination;
    const tags = await backend.files.peekTags(t.username, t.filename, dest);
    if (!tags || (!tags.artist && !tags.albumArtist && !tags.album)) continue;
    // The hidden test: this album is judged as if it were meant to be one that matches no real tags.
    const test = usePrefs.getState().testWrongAlbum;
    const expected = test ? { artist: 'Nightjar Test Artist', album: 'Nightjar Test Album' } : { artist: plan.artist, album: plan.title };
    if (!tagsSayOtherAlbum(expected, tags)) {
      updatePlan(plan.id, { identity: { state: 'ok', at: now } });
      continue;
    }
    if (test) usePrefs.getState().setTestWrongAlbum(false);
    await pause(plan, mine, tags, t.username, now, !!test);
    const real = [tags.albumArtist || tags.artist, tags.album].filter(Boolean).join(' – ');
    const wanted = plan.artist ? `${plan.artist} – ${plan.title}` : plan.title;
    recordFake({ user: t.username, album: wanted, verdict: 'Wrong album', dir: `wrong-album:${plan.id}`, at: now });
    const why = test ? ' This was the fake-album test: choose Keep downloading to carry on and clear the mark.' : '';
    toast(`Paused ${plan.title}: the files are ${real}, not ${wanted}.${why}`, 'error');
    notify(`Paused ${plan.title}`, `The files are ${real}, not ${wanted}.${why}`);
  }
}

/** Takes the album's unfinished tracks off the list, remembering them so "Keep downloading" can ask for them again. */
async function pause(plan: DownloadPlan, mine: Transfer[], tags: { artist?: string; albumArtist?: string; album?: string }, user: string, now: number, test: boolean) {
  const { backend, refreshTransfers } = useStore.getState();
  const unfinished = mine.filter((t) => phaseOf(t.state) !== 'done');
  // Covers and logs of the same copy too.
  const { downloads } = useStore.getState();
  const extras = downloads
    .flatMap((u: TransferUser) => u.directories.flatMap((d) => d.files))
    .filter((t) => t.batchId && plan.batches.includes(t.batchId) && !AUDIO_EXT.has(extOf(t.filename)) && phaseOf(t.state) !== 'done');
  const paused = [...unfinished, ...extras].map((t) => {
    const k = plan.tracks.find((x) => x.username === t.username && x.filename === t.filename);
    return { username: t.username, filename: t.filename, size: t.size, dest: k?.dest };
  });
  // Cancelled but left in the list, so the album stays in Downloads with the explanation and the choice.
  for (const t of [...unfinished, ...extras]) await backend?.cancel('download', t.username, t.id, false).catch(() => undefined);
  usePrefs.getState().updatePlan(plan.id, {
    identity: { state: 'mismatch', artist: tags.albumArtist || tags.artist, album: tags.album, user, paused, test: test || undefined, at: now },
    notes: [
      ...plan.notes,
      {
        at: now,
        text: `Paused: the tags of ${user}'s files say ${[tags.albumArtist || tags.artist, tags.album].filter(Boolean).join(' – ')}, not ${plan.artist ? `${plan.artist} – ` : ''}${plan.title}.`,
      },
    ],
  });
  refreshTransfers('download');
}

/** "Keep downloading": the tags were fine after all (a compilation, a renamed artist). Asks for the paused tracks again. */
export async function keepDownloading(plan: DownloadPlan) {
  const { backend, refreshTransfers } = useStore.getState();
  const { updatePlan, forgetFakes } = usePrefs.getState();
  if (!backend) return;
  const paused = plan.identity?.paused ?? [];
  const groups = new Map<string, typeof paused>();
  for (const p of paused) groups.set(`${p.username}\u0000${p.dest ?? ''}`, [...(groups.get(`${p.username}\u0000${p.dest ?? ''}`) ?? []), p]);
  const batches: string[] = [];
  for (const list of groups.values()) {
    const batchId = uuid();
    await backend
      .enqueue(list[0].username, list.map((p) => ({ filename: p.filename, size: p.size })), { batchId, destination: list[0].dest ?? plan.destination })
      .then(() => batches.push(batchId))
      .catch(() => undefined);
  }
  forgetFakes({ dir: `wrong-album:${plan.id}` });
  updatePlan(plan.id, {
    identity: { ...plan.identity!, state: 'kept', paused: [] },
    batches: [...plan.batches, ...batches],
    tracks: plan.tracks.map((k) => (paused.some((p) => p.username === k.username && p.filename === k.filename) ? { ...k, dropped: false } : k)),
    finishedAt: undefined,
    notes: [...plan.notes, { at: Date.now(), text: 'You chose to keep downloading it.' }],
  });
  refreshTransfers('download');
}
