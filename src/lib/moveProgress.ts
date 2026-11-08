import { useEffect, useState } from 'react';
import type { LibraryAccess, MoveProgress } from '../api/library';

/** One reading of how much has been copied, with the time it was read. */
export interface MoveSample {
  at: number;
  done: number;
}

/**
 * How long a copy has left, from how fast the last few seconds went. Null until there is something to go on:
 * a few seconds of copying and a few percent done, so the first guess is not wildly off.
 */
export function moveTimeLeft(samples: MoveSample[], total: number): number | null {
  if (samples.length < 2 || total <= 0) return null;
  const last = samples[samples.length - 1];
  const first = samples[0];
  if (last.at - first.at < 3000 || last.done / total < 0.02) return null;
  // Speed over the last 8 seconds, so a slow start or a quick burst fades out.
  const from = samples.find((s) => last.at - s.at <= 8000) ?? first;
  const speed = (last.done - from.done) / Math.max(1, last.at - from.at); // bytes per ms
  if (speed <= 0) return null;
  return Math.max(0, (total - last.done) / speed);
}

/** "about 3 min left", in plain words. */
export function timeLeftText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 10) return 'a few seconds left';
  if (s < 45) return 'less than a minute left';
  if (s < 90) return 'about a minute left';
  const min = Math.round(s / 60);
  if (min < 60) return `about ${min} min left`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `about ${h} h ${m} min left` : `about ${h} h left`;
}

export interface MoveView {
  progress: MoveProgress;
  /** Milliseconds left, or null while it can't be told yet. */
  left: number | null;
}

/**
 * Follows a move while `id` is set: asks for its progress about once a second. Gives nothing for a move within one
 * drive (it is instant), so the bar only appears when a copy is really happening.
 */
export function useMoveProgress(library: LibraryAccess | undefined, id: string | null): MoveView | null {
  const [view, setView] = useState<MoveView | null>(null);
  useEffect(() => {
    setView(null);
    if (!library || !id) return;
    let alive = true;
    const samples: MoveSample[] = [];
    const tick = async () => {
      const p = await library.moveProgress(id).catch(() => null);
      if (!alive || !p) return;
      if (p.phase === 'copying' && p.total) {
        samples.push({ at: Date.now(), done: p.done ?? 0 });
        if (samples.length > 40) samples.shift();
        setView({ progress: p, left: moveTimeLeft(samples, p.total) });
      } else if (p.phase === 'finishing') setView({ progress: p, left: 0 });
    };
    void tick();
    const timer = setInterval(tick, 900);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [library, id]);
  return view;
}
