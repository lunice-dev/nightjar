import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { onThisComputer } from '../api/remote';
import { usePrefs } from '../prefs';
import { useStore } from '../store';
import { findAutomated, type Suspect } from './automated';
import { blockAndStop } from './blocking';

/** Someone Nightjar blocked on its own, and why, so it can be undone. */
export interface AutoBlocked {
  user: string;
  at: number;
  summary: string;
}

interface GuardState {
  /** Block people who are far beyond what a person can do (see automated.ts). */
  auto: boolean;
  /** People marked "not a program": never flagged or blocked again. */
  allowed: string[];
  blocked: AutoBlocked[];
  setAuto(on: boolean): void;
  allow(user: string): void;
  recordBlock(b: AutoBlocked): void;
  forgetBlock(user: string): void;
}

/** Kept on this device only (the computer running Nightjar does the guarding). */
export const useGuard = create<GuardState>()(
  persist(
    (set) => ({
      auto: true,
      allowed: [],
      blocked: [],
      setAuto: (auto) => set({ auto }),
      allow: (user) => set((s) => ({ allowed: s.allowed.includes(user) ? s.allowed : [...s.allowed, user], blocked: s.blocked.filter((b) => b.user !== user) })),
      recordBlock: (b) => set((s) => ({ blocked: [b, ...s.blocked.filter((x) => x.user !== b.user)].slice(0, 100) })),
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
}
