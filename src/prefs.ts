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
type Saved = { state?: Record<string, unknown>; version?: number };
type Item = Record<string, unknown>;

/**
 * The lists every open device adds to. Each device saves its whole copy, so without merging, the phone saving after
 * the computer would drop the albums the computer started (their plans: one album then shows as one row per person,
 * and nothing moves its tracks any more). Same id on both: the copy that has seen more (batches, notes) wins.
 */
const MERGED: Record<string, { id: (x: Item) => string; more?: (x: Item) => number; order: (x: Item) => number; max: number }> = {
  plans: {
    id: (p) => String(p.id),
    more: (p) => ((p.batches as unknown[])?.length ?? 0) * 1000 + ((p.notes as unknown[])?.length ?? 0) + (p.finishedAt ? 1 : 0),
    order: (p) => Number(p.createdAt) || 0,
    max: 100,
  },
  sent: { id: (s) => String(s.id), order: (s) => Number(s.at) || 0, max: 5000 },
};
// Lists you can remove things from (finished albums, fakes, checks, activity) aren't merged: a removal would come back
// from the other copy. Only lists that are added to and never pruned by hand are.

/** This device's saved copy with what only the other copy has added to the shared lists. */
export function mergeShared(mine: string, theirs: string | null): string {
  if (!theirs) return mine;
  let a: Saved;
  let b: Saved;
  try {
    a = JSON.parse(mine);
    b = JSON.parse(theirs);
  } catch {
    return mine;
  }
  if (!a.state || !b.state || a.version !== b.version) return mine;
  let changed = false;
  for (const [field, rule] of Object.entries(MERGED)) {
    const ours = a.state[field];
    const other = b.state[field];
    if (!Array.isArray(ours) || !Array.isArray(other)) continue;
    const byId = new Map<string, Item>(ours.map((x: Item) => [rule.id(x), x]));
    let added = false;
    for (const x of other as Item[]) {
      const id = rule.id(x);
      const had = byId.get(id);
      if (!had || (rule.more && rule.more(x) > rule.more(had))) {
        byId.set(id, x);
        added = true;
      }
    }
    if (!added) continue;
    a.state[field] = [...byId.values()].sort((x, y) => rule.order(y) - rule.order(x)).slice(0, rule.max);
    changed = true;
  }
  // Quality checks made on the other device (a check from the phone), by album folder: the newer one wins. A check
  // that comes back for a folder that has since moved is harmless, unlike a removed download coming back.
  const ca = (a.state.checks ?? {}) as Record<string, { at?: number }>;
  const cb = (b.state.checks ?? {}) as Record<string, { at?: number }>;
  const newer = Object.keys(cb).filter((k) => !ca[k] || (cb[k].at ?? 0) > (ca[k].at ?? 0));
  if (newer.length) {
    a.state.checks = { ...ca, ...Object.fromEntries(newer.map((k) => [k, cb[k]])) };
    changed = true;
  }
  // Albums moved into the library on the other device: their downloads follow them here too.
  const ma = (a.state.moves ?? {}) as Record<string, string>;
  const mb = (b.state.moves ?? {}) as Record<string, string>;
  const fresh = Object.keys(mb).filter((k) => !(k in ma));
  if (fresh.length) {
    a.state.moves = { ...ma, ...Object.fromEntries(fresh.map((k) => [k, mb[k]])) };
    changed = true;
  }
  return changed ? JSON.stringify(a) : mine;
}

/**
 * The shared copy as last seen. It is over a megabyte, too much to fetch on every save or every few seconds on a
 * phone on mobile data (it slowed searches down), so a copy younger than RECENT_MS is reused.
 */
let lastShared: { at: number; prefs: string | null } | null = null;
const RECENT_MS = 60_000;

async function fetchShared(base: string, maxAge = 0) {
  if (lastShared && Date.now() - lastShared.at < maxAge) return lastShared.prefs;
  const res = await fetch(`${base}/prefs`, { signal: AbortSignal.timeout(2500) });
  if (!res.ok) throw new Error(String(res.status));
  const prefs = ((await res.json()) as { prefs?: string | null }).prefs ?? null;
  lastShared = { at: Date.now(), prefs };
  return prefs;
}

/** The newest copy waiting to go to the shared one. */
let pending: string | null = null;

/**
 * Sends this window's copy to the shared one, at most every 1.5 s. Changes in between ride along with the next
 * send. (It used to wait for 1.5 s without changes, which never came while something saved every second.)
 */
function push(v: string) {
  if (!sharedAt) return;
  pending = v;
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = undefined;
    const next = pending;
    pending = null;
    if (next) send(next);
  }, 1500);
}

function send(v: string) {
  const base = sharedAt;
  if (!base) return;
  void (async () => {
    // Fold in what another device saved meanwhile, so neither copy loses the other's albums.
    const remote = await fetchShared(base, RECENT_MS).catch(() => null);
    const merged = mergeShared(v, remote);
    if (merged !== v) adopt(merged);
    // Plain ASCII (non-ASCII as \u escapes, still the same JSON), so the
    // launcher's small helper can count characters as bytes.
    const ascii = merged.replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
    fetch(`${base}/prefs`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: ascii })
      .then((r) => r.ok && (lastShared = { at: Date.now(), prefs: merged }))
      .catch(() => undefined);
  })();
}

/** Takes another device's additions into this page's state (the shared lists only). */
function adopt(merged: string) {
  try {
    const s = (JSON.parse(merged) as Saved).state ?? {};
    const patch: Record<string, unknown> = {};
    for (const field of [...Object.keys(MERGED), 'moves', 'checks']) if (field in s) patch[field] = s[field];
    usePrefs.setState(patch as Partial<Prefs>);
  } catch {
    // keep this device's copy
  }
}

/**
 * Picks up what other devices added while this one sat idle (a download started from the phone), so this device's
 * download manager and list know those albums too. Called every so often; saving merges as well.
 */
export async function pullShared() {
  const base = sharedAt;
  if (!base) return;
  const remote = await fetchShared(base).catch(() => null);
  const local = localGet('ssk-lite.prefs');
  if (!remote || !local) return;
  const merged = mergeShared(local, remote);
  if (merged !== local) adopt(merged);
}

const safeStorage: StateStorage = {
  getItem: async (k) => {
    const local = localGet(k);
    if (!sharedAt) return local;
    try {
      // The shared copy is over a megabyte and the computer may still be starting Nightjar: give it time.
      const res = await fetch(`${sharedAt}/prefs`, { signal: AbortSignal.timeout(10_000) });
      if (res.status === 404) {
        sharedAt = null; // an older launcher without /prefs: this browser's copy only
        return local;
      }
      if (!res.ok) throw new Error(String(res.status));
      const remote = ((await res.json()) as { prefs?: string | null }).prefs ?? null;
      if (savedAt(remote) > savedAt(local)) {
        localSet(k, remote!);
        return remote;
      }
      if (local) push(local);
      return local;
    } catch {
      // Slow or briefly unreachable (the computer starting up): carry on with this copy, and keep saving to the shared
      // one with the next change; each save merges with it first (see push). Giving up here for good used to mean
      // nothing changed in this window reached the other devices, or the file, until the next restart.
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
  /** Folder under the downloads folder it goes into, when not the album's own (a disc folder: "Album\CD2"). */
  dest?: string;
  /** How often it was asked for again after failing on this computer's side (the engine restarted). */
  retries?: number;
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
  /** How many tracks the album has, judged from every copy search found (for "only 2 of 17 tracks"). */
  expected?: number;
  /**
   * What the first track's tags said while it arrived. "mismatch": they name another album, so the rest was paused
   * (`paused`) until you decide; "kept": you said to download it anyway.
   */
  identity?: {
    state: 'ok' | 'mismatch' | 'kept';
    artist?: string;
    album?: string;
    /** Whose files they were. */
    user?: string;
    paused?: { username: string; filename: string; size: number; dest?: string }[];
    /** Paused by the hidden fake-album test, not because anything was wrong. */
    test?: boolean;
    at: number;
  };
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

/** An album that failed Check quality as a fake (lossy source, upsampled, fake 24-bit…), and who sent it. */
export interface FakeCopy {
  user: string;
  album: string;
  verdict: string;
  /** The album's folder when it was checked, so checking it again doesn't count twice. */
  dir: string;
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
  /** Albums moved out of their download folder (Put in library, Tidy library): old folder, lower case → new folder. */
  moves?: Record<string, string>;
  /** Fake copies, newest first: who sent them gets pushed down in search results. */
  fakes: FakeCopy[];
  recordFake(fake: FakeCopy): void;
  /** Forgets one album's fake mark (it was checked again and passed) or everything about one person. */
  forgetFakes(match: { dir?: string; user?: string }): void;
  /**
   * For trying the fake-album check on a real download (hidden, see AboutScreen): the next album whose tags are read
   * is treated as the wrong one, then this turns itself off.
   */
  testWrongAlbum?: boolean;
  setTestWrongAlbum(on: boolean): void;
  /** Settings → "Check every hour": Soulseek's port test every hour, noted in Nightjar's log. Off unless chosen. */
  portWatch?: boolean;
  setPortWatch(on: boolean): void;
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
      // These three run every few seconds with mostly known items. They call set only when something is new: every
      // set saves the whole copy (over a megabyte), and saving every second kept the shared copy from ever updating.
      recordFinished(albums) {
        if (!albums.length) return;
        const have = new Map(get().finished.map((a) => [a.key, a]));
        let changed = false;
        for (const a of albums) {
          const old = have.get(a.key);
          // New, or known better now (a folder found for its cover).
          if (!old || (!old.dir && a.dir)) {
            have.set(a.key, { ...a, at: old?.at ?? a.at });
            changed = true;
          }
        }
        if (changed) set({ finished: [...have.values()].sort((x, y) => y.at - x.at).slice(0, 300) });
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
          const moved = (d?: string) => !!d && d.toLowerCase() === from.toLowerCase();
          // Where downloaded files went: a move of a move follows on.
          const moves: Record<string, string> = {};
          for (const [k, v] of Object.entries(s.moves ?? {})) moves[k] = moved(v) ? to : v;
          moves[from.toLowerCase()] = to;
          // A move back (Undo) stays as "where it was", not deleted, so another device's copy can't bring the move back.
          const keys = Object.keys(moves);
          if (keys.length > 1000) keys.slice(0, keys.length - 1000).forEach((k) => delete moves[k]);
          return {
            moves,
            checks,
            finished: s.finished.map((a) => (moved(a.dir) ? { ...a, dir: to } : a)),
            fakes: s.fakes.map((f) => (moved(f.dir) ? { ...f, dir: to } : f)),
          };
        }),
      fakes: [],
      recordFake: (fake) =>
        set((s) => ({
          fakes: [fake, ...s.fakes.filter((f) => !(f.user === fake.user && f.dir.toLowerCase() === fake.dir.toLowerCase()))].slice(0, 500),
        })),
      forgetFakes: ({ dir, user }) =>
        set((s) => ({
          fakes: s.fakes.filter((f) => !((dir && f.dir.toLowerCase() === dir.toLowerCase()) || (user && f.user === user))),
        })),
      setTestWrongAlbum: (on) => set({ testWrongAlbum: on }),
      setPortWatch: (on) => set({ portWatch: on }),
      sent: [],
      recordSent(files) {
        if (!files.length) return;
        const seen = new Set(get().sent.map((f) => f.id));
        const fresh = files.filter((f) => !seen.has(f.id));
        if (fresh.length) set((s) => ({ sent: [...fresh, ...s.sent].sort((a, b) => b.at - a.at).slice(0, 3000) }));
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
        const seen = new Set(get().activity.map((e) => e.id));
        const fresh = events.filter((e) => !seen.has(e.id));
        if (fresh.length) set((s) => ({ activity: [...fresh, ...s.activity].sort((a, b) => b.at - a.at).slice(0, 500) }));
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
