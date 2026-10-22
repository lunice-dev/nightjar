import { create } from 'zustand';
import type { Backend } from '../api/backend';
import { usePrefs, type SavedCheck } from '../prefs';
import { useStore } from '../store';

/**
 * Checks one album's files with the Nightjar app and keeps the verdict with the album.
 * Returns an error message, or null when the check finished.
 */
export async function runCheck(backend: Backend, dir: string, onProgress?: (done: number, total: number) => void, stopped?: () => boolean): Promise<string | null> {
  const start = await backend.library.check(dir);
  if (!start.id) return start.error ?? 'The check couldn’t start.';
  for (;;) {
    await new Promise((r) => setTimeout(r, 800));
    if (stopped?.()) return 'Stopped.';
    const p = await backend.library.progress(start.id);
    if (!p) continue;
    onProgress?.(p.done, p.total);
    if (!p.finished) continue;
    if (p.error || !p.album) {
      const reason = p.error ?? 'The check didn’t finish.';
      // Kept with the album, so it isn't tried again and again: "Check again" tries once more.
      usePrefs.getState().saveCheck(dir, { verdict: 'Couldn’t check', note: reason, severity: -1, at: Date.now(), tracks: [] });
      return reason;
    }
    const check: SavedCheck = {
      verdict: p.album.verdict,
      note: p.album.note,
      severity: p.album.severity,
      at: Date.now(),
      tracks: p.tracks.map((t) => ({ name: t.name, verdict: t.verdict, note: t.note, cutoff: t.cutoff, severity: t.severity })),
    };
    usePrefs.getState().saveCheck(dir, check);
    return null;
  }
}

interface CheckAll {
  /** Albums still to check, in order. */
  queue: string[];
  total: number;
  done: number;
  current: string | null;
  currentTracks: { done: number; total: number } | null;
  failed: { dir: string; error: string }[];
  running: boolean;
  start(dirs: string[]): void;
  stop(): void;
}

/**
 * Checks a whole list of albums one after the other, in the background: it keeps going while you use
 * the rest of Nightjar, and stops when you ask (or when Nightjar quits; what's done stays done).
 */
export const useCheckAll = create<CheckAll>((set, get) => ({
  queue: [],
  total: 0,
  done: 0,
  current: null,
  currentTracks: null,
  failed: [],
  running: false,
  start(dirs) {
    if (get().running) {
      // Add to the list already running.
      const known = new Set([...get().queue, get().current].filter(Boolean).map((d) => d!.toLowerCase()));
      const more = dirs.filter((d) => !known.has(d.toLowerCase()));
      set((s) => ({ queue: [...s.queue, ...more], total: s.total + more.length }));
      return;
    }
    set({ queue: [...dirs], total: dirs.length, done: 0, failed: [], running: true, current: null, currentTracks: null });
    void loop();
  },
  stop() {
    set({ queue: [], running: false });
  },
}));

async function loop() {
  for (;;) {
    const s = useCheckAll.getState();
    const backend = useStore.getState().backend;
    if (!s.running || !backend || s.queue.length === 0) break;
    const [dir, ...rest] = s.queue;
    useCheckAll.setState({ queue: rest, current: dir, currentTracks: null });
    const error = await runCheck(
      backend,
      dir,
      (done, total) => useCheckAll.setState({ currentTracks: { done, total } }),
      () => !useCheckAll.getState().running,
    );
    if (!useCheckAll.getState().running) break;
    useCheckAll.setState((x) => ({ done: x.done + 1, failed: error ? [...x.failed, { dir, error }] : x.failed }));
  }
  useCheckAll.setState({ running: false, current: null, currentTracks: null });
}
