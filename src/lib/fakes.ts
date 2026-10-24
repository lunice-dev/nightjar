import { usePrefs, type SavedCheck } from '../prefs';

/** Album verdicts that mean "not what it claims to be". Damaged files aren't on the list: that can happen in transit. */
const FAKE = new Set(['Lossy source', 'Suspicious', 'Upsampled', 'Fake 24-bit', 'Upconverted']);

export const isFake = (c: Pick<SavedCheck, 'verdict'>) => FAKE.has(c.verdict);

/**
 * After a quality check: remember who sent a fake copy of this album, or clear the mark when it now passes.
 * The sender comes from the downloads history (the album's folder), so it works for checks run from
 * Downloads and from the Library alike.
 */
export function noteCheck(dir: string, check: SavedCheck) {
  const prefs = usePrefs.getState();
  if (!isFake(check)) {
    prefs.forgetFakes({ dir });
    return;
  }
  const album = prefs.finished.find((a) => a.dir && a.dir.toLowerCase() === dir.toLowerCase());
  if (!album) return;
  for (const user of album.from)
    prefs.recordFake({ user, album: album.artist ? `${album.artist} – ${album.title}` : album.title, verdict: check.verdict, dir, at: check.at || Date.now() });
}

/** Albums checked before Nightjar kept this list: mark their senders once. */
export function backfillFakes() {
  const p = usePrefs.getState();
  for (const [dir, c] of Object.entries(p.checks))
    if (isFake(c) && !p.fakes.some((f) => f.dir.toLowerCase() === dir)) noteCheck(dir, c);
}

/** How many fake copies each person has sent you, for search ranking. */
export function fakeCounts(fakes: { user: string }[]) {
  const m = new Map<string, number>();
  for (const f of fakes) m.set(f.user, (m.get(f.user) ?? 0) + 1);
  return m;
}
