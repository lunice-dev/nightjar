import { uuid } from './lib/uuid';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import type { Presence } from './api/types';
import type { FolderResult, Tier } from './lib/quality';

/**
 * Things you set up once and expect to find again: wishlist, people, ignore
 * list and notification choices. Kept in this browser's storage; if storage
 * is blocked, everything still works for the session.
 */

const memory = new Map<string, string>();
const localGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return memory.get(k) ?? null;
  }
};
const localSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    memory.set(k, v);
  }
};

/**
 * With the real engine, preferences are also kept next to slskd (through the
 * launcher's or luniceOS's helper), so Chrome, luniceOS and the app all see the
 * same wishlist, history and activity. The newest copy wins.
 */
let sharedAt: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
export function sharePrefsThrough(helper: string | null) {
  sharedAt = helper;
}
const savedAt = (v: string | null) => {
  try {
    return v ? (JSON.parse(v).state?.savedAt as number) ?? 0 : -1;
  } catch {
    return -1;
  }
};
function push(v: string) {
  const base = sharedAt;
  if (!base) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    // Plain ASCII (non-ASCII as \u escapes, still the same JSON), so the
    // launcher's small helper can count characters as bytes.
    const ascii = v.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    fetch(`${base}/prefs`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: ascii }).catch(() => undefined);
  }, 1500);
}

const safeStorage: StateStorage = {
  getItem: async (k) => {
    const local = localGet(k);
    if (!sharedAt) return local;
    try {
      const res = await fetch(`${sharedAt}/prefs`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) throw new Error(String(res.status));
      const remote = ((await res.json()) as { prefs?: string | null }).prefs ?? null;
      if (savedAt(remote) > savedAt(local)) {
        localSet(k, remote!);
        return remote;
      }
      if (local) push(local);
      return local;
    } catch {
      // an older launcher without /prefs, or no helper at all: this browser's copy only
      sharedAt = null;
      return local;
    }
  },
  setItem: (k, v) => {
    localSet(k, v);
    push(v);
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      memory.delete(k);
    }
  },
};

export interface WishItem {
  id: string;
  query: string;
  minTier?: Tier;
  addedAt: number;
  lastRunAt?: number;
  running?: boolean;
  /** Folder keys already reported, so only new copies count as news. */
  seen: string[];
  matches: FolderResult[];
  unseen: number;
}

export interface Buddy {
  username: string;
  note: string;
  alert: boolean;
  presence?: Presence;
  lastSeen?: number;
}

export interface NotifyPrefs {
  messages: boolean;
  downloads: boolean;
  online: boolean;
  wishlist: boolean;
}

/** Another copy of an album that a download can switch to. */
export interface SourceOption {
  username: string;
  folder: string;
  files: { filename: string; size: number }[];
  uploadSpeed: number;
  hasFreeUploadSlot: boolean;
  queueLength: number;
}

/** One track of an album download, and who is sending it right now. */
export interface PlanTrack {
  /** The track as the first source names it. */
  name: string;
  size: number;
  /** Current source of this track. */
  username: string;
  filename: string;
  /** People who refused, failed or stalled on this track. */
  failedBy: string[];
  /** You cancelled it yourself: leave it alone. */
  dropped?: boolean;
  /** How often it was moved because it came in too slowly (it moves at most twice). */
  slowMoves?: number;
}

/**
 * An album download that can use several identical copies at once: tracks are
 * split between the fastest sources, a source that finishes early takes over
 * tracks still waiting elsewhere, and refused or stuck tracks move to the next
 * copy. Every source writes into the same folder.
 */
export interface DownloadPlan {
  id: string;
  /** username + NUL + remote folder of the first source, as search results key it */
  key: string;
  title: string;
  artist?: string;
  /** Folder under the downloads folder that every source writes into. */
  destination: string;
  tracks: PlanTrack[];
  /** Other copies of the album, best first. */
  sources: SourceOption[];
  /** Usernames whose copy is byte-for-byte the same album (safe to split between). */
  identical: string[];
  /** slskd batch ids queued for this plan, one per enqueue. */
  batches: string[];
  /** Plain-language history: "Moved 3 tracks from x to y because y finished first". */
  notes: { at: number; text: string }[];
  createdAt: number;
  /** Set once every track is done, so the plan stops being checked. */
  finishedAt?: number;
}

/** Something another person did with your share. */
export interface ActivityEvent {
  id: string;
  at: number;
  user: string;
  kind: 'browse' | 'folder' | 'requested' | 'uploaded' | 'refused';
  detail: string;
}

/** An album that finished downloading, kept for the home page after the Downloads list is cleared. */
export interface FinishedAlbum {
  key: string;
  title: string;
  artist?: string;
  /** Its folder on this computer, for the cover. */
  dir?: string;
  size: number;
  tracks: number;
  from: string[];
  at: number;
}

/** One file someone downloaded from you, kept for the statistics after the Uploads list is cleared. */
export interface SentFile {
  id: string;
  user: string;
  bytes: number;
  /** bytes/s */
  speed: number;
  at: number;
}

/** A quality check's result for an album folder (kept so it shows again later). */
export interface SavedCheck {
  verdict: string;
  note: string;
  severity: number;
  at: number;
  tracks: { name: string; verdict: string; note: string; cutoff: number; severity: number }[];
}

export interface SmartPrefs {
  enabled: boolean;
  /** Move on from a source whose queue hasn't moved for this many minutes. */
  queueMinutes: number;
  /** Split an album between identical copies from different people. */
  parallel?: boolean;
}

interface Prefs {
  wishlist: WishItem[];
  searchHistory: string[];
  plans: DownloadPlan[];
  activity: ActivityEvent[];
  smart: SmartPrefs;
  /** Finished albums, newest first (the home page's history; Clear finished doesn't touch it). */
  finished: FinishedAlbum[];
  recordFinished(albums: FinishedAlbum[]): void;
  /** Quality checks, by album folder. */
  checks: Record<string, SavedCheck>;
  saveCheck(dir: string, check: SavedCheck | null): void;
  /** An album moved into the library: its check and history follow it. */
  albumMoved(from: string, to: string): void;
  /** Files people finished downloading from you, newest first. */
  sent: SentFile[];
  recordSent(files: SentFile[]): void;
  forgetFinished(key: string): void;

  rememberSearch(q: string): void;
  forgetSearches(): void;
  addPlan(plan: DownloadPlan): void;
  updatePlan(id: string, patch: Partial<DownloadPlan>): void;
  addActivity(events: ActivityEvent[]): void;
  clearActivity(): void;
  setSmart(patch: Partial<SmartPrefs>): void;
  buddies: Buddy[];
  ignored: string[];
  notify: NotifyPrefs;

  addWish(query: string, minTier?: Tier): WishItem | undefined;
  updateWish(id: string, patch: Partial<WishItem>): void;
  removeWish(id: string): void;

  addBuddy(username: string): void;
  updateBuddy(username: string, patch: Partial<Buddy>): void;
  removeBuddy(username: string): void;

  ignore(username: string): void;
  unignore(username: string): void;

  setNotify(patch: Partial<NotifyPrefs>): void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set, get) => ({
      wishlist: [],
      searchHistory: [],
      plans: [],
      activity: [],
      smart: { enabled: true, queueMinutes: 10, parallel: true },
      finished: [],
      recordFinished(albums) {
        if (!albums.length) return;
        set((s) => {
          const have = new Map(s.finished.map((a) => [a.key, a]));
          let changed = false;
          for (const a of albums) {
            const old = have.get(a.key);
            // New, or known better now (a folder found for its cover).
            if (!old || (!old.dir && a.dir)) {
              have.set(a.key, { ...a, at: old?.at ?? a.at });
              changed = true;
            }
          }
          if (!changed) return s;
          return { finished: [...have.values()].sort((x, y) => y.at - x.at).slice(0, 300) };
        });
      },
      checks: {},
      saveCheck: (dir, check) =>
        set((s) => {
          const checks = { ...s.checks };
          // A whole library's worth fits: the explanation is kept only for tracks that look wrong.
          if (check) checks[dir.toLowerCase()] = { ...check, tracks: check.tracks.map((t) => (t.severity >= 3 ? t : { ...t, note: '' })) };
          else delete checks[dir.toLowerCase()];
          // Only the latest two thousand albums.
          const keys = Object.keys(checks);
          if (keys.length > 2000) keys.sort((a, b) => checks[a].at - checks[b].at).slice(0, keys.length - 2000).forEach((k) => delete checks[k]);
          return { checks };
        }),
      albumMoved: (from, to) =>
        set((s) => {
          const checks = { ...s.checks };
          const c = checks[from.toLowerCase()];
          if (c) {
            delete checks[from.toLowerCase()];
            checks[to.toLowerCase()] = c;
          }
          return { checks, finished: s.finished.map((a) => (a.dir && a.dir.toLowerCase() === from.toLowerCase() ? { ...a, dir: to } : a)) };
        }),
      sent: [],
      recordSent(files) {
        if (!files.length) return;
        set((s) => {
          const seen = new Set(s.sent.map((f) => f.id));
          const fresh = files.filter((f) => !seen.has(f.id));
          if (!fresh.length) return s;
          return { sent: [...fresh, ...s.sent].sort((a, b) => b.at - a.at).slice(0, 3000) };
        });
      },
      forgetFinished: (key) => set((s) => ({ finished: s.finished.filter((a) => a.key !== key) })),

      rememberSearch(q) {
        const t = q.trim();
        if (!t) return;
        set((s) => ({ searchHistory: [t, ...s.searchHistory.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, 30) }));
      },
      forgetSearches: () => set({ searchHistory: [] }),
      addPlan: (plan) => set((s) => ({ plans: [plan, ...s.plans.filter((p) => p.id !== plan.id)].slice(0, 100) })),
      updatePlan: (id, patch) => set((s) => ({ plans: s.plans.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      addActivity(events) {
        if (!events.length) return;
        set((s) => {
          const seen = new Set(s.activity.map((e) => e.id));
          const fresh = events.filter((e) => !seen.has(e.id));
          if (!fresh.length) return s;
          return { activity: [...fresh, ...s.activity].sort((a, b) => b.at - a.at).slice(0, 500) };
        });
      },
      clearActivity: () => set({ activity: [] }),
      setSmart: (patch) => set((s) => ({ smart: { ...s.smart, ...patch } })),
      buddies: [],
      ignored: [],
      notify: { messages: true, downloads: true, online: true, wishlist: true },

      addWish(query, minTier) {
        const q = query.trim();
        if (!q) return undefined;
        const existing = get().wishlist.find((w) => w.query.toLowerCase() === q.toLowerCase());
        if (existing) return existing;
        const item: WishItem = { id: uuid(), query: q, minTier, addedAt: Date.now(), seen: [], matches: [], unseen: 0 };
        set((s) => ({ wishlist: [item, ...s.wishlist] }));
        return item;
      },
      updateWish: (id, patch) => set((s) => ({ wishlist: s.wishlist.map((w) => (w.id === id ? { ...w, ...patch } : w)) })),
      removeWish: (id) => set((s) => ({ wishlist: s.wishlist.filter((w) => w.id !== id) })),

      addBuddy(username) {
        const u = username.trim();
        if (!u || get().buddies.some((b) => b.username === u)) return;
        set((s) => ({ buddies: [...s.buddies, { username: u, note: '', alert: true }] }));
      },
      updateBuddy: (username, patch) =>
        set((s) => ({ buddies: s.buddies.map((b) => (b.username === username ? { ...b, ...patch } : b)) })),
      removeBuddy: (username) => set((s) => ({ buddies: s.buddies.filter((b) => b.username !== username) })),

      ignore: (username) => set((s) => (s.ignored.includes(username) ? s : { ignored: [...s.ignored, username] })),
      unignore: (username) => set((s) => ({ ignored: s.ignored.filter((u) => u !== username) })),

      setNotify: (patch) => set((s) => ({ notify: { ...s.notify, ...patch } })),
    }),
    {
      name: 'ssk-lite.prefs',
      version: 3,
      migrate: (old) => {
        const s = old as { activity?: ActivityEvent[]; plans?: Partial<DownloadPlan>[] };
        if (s.activity) s.activity = s.activity.filter((e) => !e.user.includes('"'));
        // Plans from before multi-source downloads can't be continued; their downloads stay in the list.
        if (s.plans) s.plans = s.plans.filter((p) => Array.isArray(p.tracks));
        return s as never;
      },
      storage: createJSONStorage(() => safeStorage),
      // A run in progress when the page closed shouldn't look stuck forever.
      partialize: (s) => ({ ...s, savedAt: Date.now(), wishlist: s.wishlist.map((w) => ({ ...w, running: false })) }),
      // Loaded by App once it knows whether a real engine (and its shared copy) is there.
      skipHydration: true,
    },
  ),
);

export const isIgnored = (username: string) => usePrefs.getState().ignored.includes(username);
