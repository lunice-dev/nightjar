import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { onThisComputer } from '../api/remote';
import { usePrefs } from '../prefs';
import { useStore } from '../store';
import { findAutomated, type Suspect } from './automated';
import { blockAndStop } from './blocking';
import { accountsFromFiles, accountsOf, findWaves } from './swarm';

/** Someone Nightjar blocked on its own, and why, so it can be undone. */
export interface AutoBlocked {
  /** Who, or for a wave of new accounts its key ("wave:u:12"), with the accounts in `users`. */
  user: string;
  at: number;
  summary: string;
  users?: string[];
}

interface GuardState {
  /** Block people who are far beyond what a person can do (see automated.ts). */
  auto: boolean;
  /** People marked "not a program": never flagged or blocked again. */
  allowed: string[];
  blocked: AutoBlocked[];
  /** Kinds of made-up account names that came in a wave (see swarm.ts), and when it was last seen. */
  waves: Record<string, number>;
  setAuto(on: boolean): void;
  allow(user: string): void;
  recordBlock(b: AutoBlocked): void;
  /** Adds accounts of a wave to its one entry. */
  recordWave(kind: string, users: string[], summary: string): void;
  forgetBlock(user: string): void;
}

/** Kept on this device only (the computer running Nightjar does the guarding). */
export const useGuard = create<GuardState>()(
  persist(
    (set) => ({
      auto: true,
      allowed: [],
      blocked: [],
      waves: {},
      setAuto: (auto) => set({ auto }),
      allow: (user) =>
        set((s) => ({
          allowed: s.allowed.includes(user) ? s.allowed : [...s.allowed, user],
          // One account of a wave allowed again leaves the wave's entry; the rest stay blocked.
          blocked: s.blocked
            .map((b) => (b.users ? { ...b, users: b.users.filter((u) => u !== user) } : b))
            .filter((b) => b.user !== user && (!b.users || b.users.length > 0)),
        })),
      recordBlock: (b) => set((s) => ({ blocked: [b, ...s.blocked.filter((x) => x.user !== b.user)].slice(0, 100) })),
      recordWave: (kind, users, summary) =>
        set((s) => {
          const key = `wave:${kind}`;
          const had = s.blocked.find((b) => b.user === key);
          const all = [...new Set([...(had?.users ?? []), ...users])];
          return {
            waves: { ...s.waves, [kind]: Date.now() },
            blocked: [{ user: key, at: Date.now(), summary: `${all.length} new accounts with made-up names ${summary.replace(/^\d+ new accounts with made-up names /, '')}`, users: all }, ...s.blocked.filter((b) => b.user !== key)].slice(0, 100),
          };
        }),
      forgetBlock: (user) => set((s) => ({ blocked: s.blocked.filter((b) => b.user !== user) })),
    }),
    { name: 'nightjar.guard' },
  ),
);

/** Who looks like a program right now (the last day), without the ones marked "not a program". */
export function useSuspects(): Suspect[] {
  const activity = usePrefs((s) => s.activity);
  const allowed = useGuard((s) => s.allowed);
  return useMemo(() => findAutomated(activity).filter((s) => !allowed.includes(s.user)), [activity, allowed]);
}

/** One attempt per person per page load: an early failure must not become a request every few seconds. */
const tried = new Set<string>();

/**
 * Blocks whoever is far beyond what a person can do, when that is switched on. Runs on the computer only, and never
 * touches people on your People list. Called whenever new activity has been read.
 */
export async function runGuard() {
  if (!onThisComputer) return;
  const guard = useGuard.getState();
  if (!guard.auto) return;
  const { backend, me } = useStore.getState();
  if (!backend) return;
  const buddies = new Set(usePrefs.getState().buddies.map((b) => b.username));
  for (const s of findAutomated(usePrefs.getState().activity)) {
    if (s.level !== 'sure' || tried.has(s.user) || guard.allowed.includes(s.user) || buddies.has(s.user) || s.user === me) continue;
    tried.add(s.user);
    try {
      const settings = await backend.settings();
      if (!settings.editable || settings.blocked.includes(s.user) || settings.friends.includes(s.user)) continue;
      const stopped = await blockAndStop(s.user, s.summary);
      if (stopped !== null) useGuard.getState().recordBlock({ user: s.user, at: Date.now(), summary: s.summary });
    } catch {
      /* try again after a restart of the page */
    }
  }
  await runWaveGuard();
}

/** Waves of accounts being blocked right now: one pass at a time. */
let sweeping = false;
/** The first pass after the page opens looks at every upload, cleared ones included; later passes at the ones in the list. */
let lookedAtAll = false;

/**
 * Blocks waves of new accounts with made-up names (see swarm.ts), all in one change to the blocked list, and stops what
 * they are taking. Never touches people on your People list, friends, accounts marked "not a program" or yourself.
 */
export async function runWaveGuard() {
  if (sweeping || !onThisComputer) return;
  const guard = useGuard.getState();
  if (!guard.auto) return;
  const { backend, me, uploads, refreshTransfers } = useStore.getState();
  if (!backend || uploads.length === 0) return;
  const spared = new Set([...usePrefs.getState().buddies.map((b) => b.username), ...guard.allowed, me ?? '']);
  sweeping = true;
  try {
    let accounts = accountsOf(uploads);
    if (!lookedAtAll) {
      lookedAtAll = true;
      // Everyone who ever asked for anything (a big answer, once): a wave is often already cleared from the list.
      const all = await backend.history('upload').catch(() => null);
      if (all) accounts = accountsFromFiles(all);
    }
    const waves = findWaves(accounts, useGuard.getState().waves);
    if (!waves.length) return;
    const settings = await backend.settings();
    if (!settings.editable) return;
    const already = new Set([...settings.blocked, ...settings.friends]);
    const fresh = waves.map((w) => ({ ...w, users: w.users.filter((u) => !spared.has(u) && !already.has(u)) })).filter((w) => w.users.length > 0);
    if (!fresh.length) return;
    // One save for every account: a wave can be hundreds.
    await backend.saveSettings({ blocked: [...settings.blocked, ...fresh.flatMap((w) => w.users)] });
    const names = new Set(fresh.flatMap((w) => w.users));
    const running = uploads
      .filter((u) => names.has(u.username))
      .flatMap((u) => u.directories.flatMap((d) => d.files))
      .filter((f) => !f.state.startsWith('Completed'));
    await Promise.all(running.map((f) => backend.cancel('upload', f.username, f.id, false).catch(() => undefined)));
    for (const w of fresh) {
      useGuard.getState().recordWave(w.kind, w.users, w.summary);
      useStore.getState().toast(`${w.users.length} new accounts with made-up names were blocked: ${w.summary.replace(/^\d+ new accounts with made-up names /, 'they ')}. You can undo this in Settings.`);
    }
    refreshTransfers('upload');
  } catch {
    /* the next read tries again */
  } finally {
    sweeping = false;
  }
}
