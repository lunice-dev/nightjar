/**
 * How fast each person is really sending an album: the bytes that arrived from them over the last few seconds.
 *
 * slskd's own figure is each file's average since that file started, so a total of those jumps whenever a source
 * moves on to its next track (the new one starts near zero, and between tracks the source has none running).
 * Bytes over a window don't: they are what reached the computer.
 */
const WINDOW = 6000;
/** Below this much history the measure would be noise; the caller falls back to slskd's figures. */
const MIN_SPAN = 1500;

export interface Delivered {
  /** The transfer's id: a track that starts again elsewhere is another transfer. */
  id: string;
  username: string;
  /** Bytes of this file on the computer so far (a finished file counts whole). */
  bytes: number;
}

type Snapshot = { at: number; files: Map<string, number> };
const history = new Map<string, Snapshot[]>();

/**
 * Bytes per second from each person for one album (`key`), measured from the snapshots this function was given
 * over the last few seconds; null until there is enough history. Every person in `files` is in the answer.
 */
export function sourceRates(key: string, files: Delivered[], now = Date.now()): Map<string, number> | null {
  const list = history.get(key) ?? [];
  const last = list[list.length - 1];
  if (!last || now > last.at) list.push({ at: now, files: new Map(files.map((f) => [f.id, f.bytes])) });
  // Keep one snapshot from before the window, so the window is always covered.
  while (list.length > 2 && now - list[1]!.at >= WINDOW) list.shift();
  history.set(key, list);
  forgetOld(now);

  const base = list[0]!;
  const span = now - base.at;
  if (span < MIN_SPAN) return null;
  const rates = new Map<string, number>();
  for (const f of files) {
    // A file may only grow; one that went back (cancelled and started again) counts from zero.
    const before = base.files.get(f.id) ?? 0;
    const grew = f.bytes >= before ? f.bytes - before : f.bytes;
    rates.set(f.username, (rates.get(f.username) ?? 0) + grew / (span / 1000));
  }
  return rates;
}

let swept = 0;
/** Albums nobody asked about for a minute (finished, or the list moved on) are forgotten. */
function forgetOld(now: number) {
  if (now - swept < 60_000) return;
  swept = now;
  for (const [key, list] of history) if (now - list[list.length - 1]!.at > 60_000) history.delete(key);
}

/** For tests: start with no history. */
export function resetRates() {
  history.clear();
  swept = 0;
}
