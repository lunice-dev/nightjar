import { create } from 'zustand';
import type { Backend, Direction, Unsubscribe } from './api/backend';
import type { Conversation, EnqueueFile, Search, SearchResponse, TransferUser } from './api/types';
import { TIERS, type Tier } from './lib/quality';
import { usePrefs } from './prefs';

export type Route = 'search' | 'wishlist' | 'downloads' | 'library' | 'uploads' | 'messages' | 'rooms' | 'people' | 'browse' | 'settings' | 'about';

export interface SearchTab {
  search: Search;
  responses: SearchResponse[];
  /** Answers from earlier searches for the same words. */
  earlier?: SearchResponse[];
  unwatch?: Unsubscribe;
}

export interface Filters {
  tiers: Set<Tier>;
  freeSlotOnly: boolean;
  minTracks: number;
  text: string;
}

export const defaultFilters = (): Filters => ({
  tiers: new Set(TIERS),
  freeSlotOnly: false,
  minTracks: 0,
  text: '',
});

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

interface State {
  backend: Backend | null;
  phase: 'connect' | 'login' | 'setup' | 'ready' | 'closed';
  me?: string;
  /** The engine's connection to the Soulseek server, refreshed every few seconds. */
  link: { state: 'connecting' | 'online' | 'offline' | 'unreachable'; since: number; problem?: 'rejected' | 'kicked' | 'no-account' | null };
  watchLink(): () => void;
  route: Route;
  browseUser?: string;
  /** Whose profile card is open, over whatever page you're on. */
  profileUser?: string;

  tabs: SearchTab[];
  activeTab?: string;
  filters: Record<string, Filters>;

  downloads: TransferUser[];
  uploads: TransferUser[];
  conversations: Conversation[];
  /** False until the first real list arrives, so old unread messages don't notify. */
  conversationsLoaded: boolean;
  /** Current speed limits in KiB/s (null = none), for the sidebar. */
  limits?: { down: number | null; up: number | null };
  refreshLimits(): Promise<void>;
  chatWith?: string;
  room?: string;
  queuedKeys: Set<string>; // username + filename, to mark rows as queued instantly
  /** What each person actually sent you at before, bytes/s (slskd's history). */
  speeds: Map<string, number>;
  refreshSpeeds(): Promise<void>;

  toasts: Toast[];

  setBackend(b: Backend, phase: State['phase']): void;
  ready(me?: string): void;
  /** Your share in numbers, once Your shares has read it (for the home page). */
  library?: { albums: number; tracks: number; size: number; tiers: Record<Tier, number> };
  /** Where downloads land and where shared folders live on this computer, for album art. */
  local: { downloadDir?: string; roots: { remote: string; local: string }[] };
  loadLocal(): Promise<void>;
  go(route: Route): void;
  browse(username: string): void;
  openProfile(username?: string): void;
  message(username: string): void;
  openRoom(name?: string): void;
  refreshConversations(): Promise<void>;

  search(text: string): Promise<void>;
  selectTab(id: string): void;
  closeTab(id: string): void;
  stopSearch(id: string): void;
  setFilters(id: string, f: Partial<Filters>): void;

  enqueue(username: string, files: EnqueueFile[], label: string): Promise<void>;
  refreshTransfers(direction?: Direction): Promise<void>;

  toast(text: string, tone?: Toast['tone']): void;
  dismiss(id: number): void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => ({
  backend: null,
  phase: 'connect',
  route: 'search',
  tabs: [],
  filters: {},
  downloads: [],
  uploads: [],
  conversations: [],
  conversationsLoaded: false,
  link: { state: 'connecting', since: Date.now() },
  watchLink() {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const { backend, link } = get();
      if (!backend) return;
      let state: State['link']['state'];
      try {
        const s = await backend.server();
        state = s.isLoggedIn ? 'online' : s.isConnecting || s.isLoggingIn || !s.isConnected ? 'connecting' : 'offline';
        // Your own name arrives once the engine starts signing in: screens that need it wait for it.
        if (s.username && s.username !== get().me) set({ me: s.username });
      } catch {
        state = 'unreachable';
      }
      if (stop) return;
      // Not signed in: say why, when the engine's log knows.
      const problem = state === 'offline' || state === 'connecting' ? await backend.linkProblem().catch(() => null) : null;
      if (stop) return;
      if (state !== link.state || problem !== (link.problem ?? null)) set({ link: { state, since: state !== link.state ? Date.now() : link.since, problem } });
      timer = setTimeout(tick, state === 'online' ? 10_000 : 2_000);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  },

  async refreshLimits() {
    const { backend } = get();
    if (!backend) return;
    try {
      const s = await backend.settings();
      set({ limits: { down: s.downloadLimit, up: s.uploadLimit } });
    } catch {
      /* keep the last known */
    }
  },
  queuedKeys: new Set(),
  speeds: new Map(),
  local: { roots: [] },
  async loadLocal() {
    const { backend } = get();
    if (!backend) return;
    const [settings, roots] = await Promise.all([backend.settings().catch(() => undefined), backend.files.shareRoots().catch(() => [])]);
    set({ local: { downloadDir: settings?.downloadDir || undefined, roots } });
  },
  async refreshSpeeds() {
    const { backend } = get();
    if (!backend) return;
    const measured = await backend.measuredSpeeds().catch(() => new Map<string, number>());
    // Downloads running now count too: they're the freshest measurement there is.
    for (const u of get().downloads) {
      const live = u.directories.flatMap((d) => d.files).filter((f) => f.state === 'InProgress' && f.averageSpeed > 0);
      if (live.length) measured.set(u.username, Math.max(...live.map((f) => f.averageSpeed)));
    }
    set({ speeds: measured });
  },
  toasts: [],

  setBackend: (backend, phase) => set({ backend, phase }),
  ready: (me) => set({ phase: 'ready', me }),
  go: (route) => set({ route }),
  browse: (username) => set({ route: 'browse', browseUser: username, profileUser: undefined }),
  openProfile: (username) => set({ profileUser: username?.trim() || undefined }),
  message: (username) => set({ route: 'messages', chatWith: username, profileUser: undefined }),
  openRoom: (name) => set({ route: 'rooms', room: name }),

  async refreshConversations() {
    const { backend } = get();
    if (!backend) return;
    try {
      set({ conversations: await backend.conversations(), conversationsLoaded: true });
    } catch {
      /* the next poll will retry */
    }
  },

  async search(text) {
    const { backend } = get();
    const q = text.trim();
    if (!backend || !q) return;
    usePrefs.getState().rememberSearch(q);
    try {
      const search = await backend.startSearch(q);
      // Searching the same words again builds on what the last search found instead of starting from zero.
      const same = get().tabs.filter((t) => t.search.searchText.trim().toLowerCase() === q.toLowerCase());
      const earlierMap = new Map<string, SearchResponse>();
      for (const t of same) for (const r of [...(t.earlier ?? []), ...t.responses]) earlierMap.set(r.username, { ...r, earlier: true });
      same.forEach((t) => t.unwatch?.());
      const tab: SearchTab = { search, responses: [], earlier: [...earlierMap.values()] };
      if (same.length === 0)
        backend
          .pastResponses(q, search.id)
          .then((past) => {
            if (!past.length) return;
            set((s) => ({
              tabs: s.tabs.map((t) =>
                t.search.id === search.id ? { ...t, earlier: past.map((r) => ({ ...r, earlier: true })) } : t,
              ),
            }));
          })
          .catch(() => undefined);
      set((s) => ({
        tabs: [tab, ...s.tabs.filter((t) => !same.includes(t))].slice(0, 12),
        activeTab: search.id,
        route: 'search',
        filters: { ...s.filters, [search.id]: defaultFilters() },
      }));
      tab.unwatch = backend.watchSearch(search.id, {
        onResponses: (rs) =>
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.search.id === search.id ? { ...t, responses: [...t.responses, ...rs] } : t,
            ),
          })),
        onUpdate: (u) =>
          set((s) => ({
            tabs: s.tabs.map((t) => (t.search.id === search.id ? { ...t, search: { ...t.search, ...u } } : t)),
          })),
      });
    } catch (e) {
      get().toast(`Search didn't start: ${(e as Error).message}`, 'error');
    }
  },

  selectTab: (id) => set({ activeTab: id, route: 'search' }),

  closeTab(id) {
    const { tabs, backend, activeTab } = get();
    const tab = tabs.find((t) => t.search.id === id);
    tab?.unwatch?.();
    backend?.removeSearch(id).catch(() => undefined);
    const rest = tabs.filter((t) => t.search.id !== id);
    set({ tabs: rest, activeTab: activeTab === id ? rest[0]?.search.id : activeTab });
  },

  stopSearch(id) {
    get().backend?.stopSearch(id).catch(() => undefined);
  },

  setFilters: (id, f) =>
    set((s) => ({ filters: { ...s.filters, [id]: { ...(s.filters[id] ?? defaultFilters()), ...f } } })),

  async enqueue(username, files, label) {
    const { backend } = get();
    if (!backend || files.length === 0) return;
    const keys = files.map((f) => `${username}\u0000${f.filename}`);
    set((s) => ({ queuedKeys: new Set([...s.queuedKeys, ...keys]) }));
    try {
      await backend.enqueue(username, files);
      get().toast(`Queued ${label} from ${username}`);
      get().refreshTransfers('download');
    } catch (e) {
      set((s) => {
        const next = new Set(s.queuedKeys);
        keys.forEach((k) => next.delete(k));
        return { queuedKeys: next };
      });
      const status = (e as { status?: number }).status;
      get().toast(
        status === 404 ? `${username} is offline. Try another source.` : `Couldn't queue ${label}: ${(e as Error).message}`,
        'error',
      );
    }
  },

  async refreshTransfers(direction) {
    const { backend } = get();
    if (!backend) return;
    const load = async (d: Direction) => {
      try {
        const list = await backend.transfers(d);
        set(d === 'download' ? { downloads: list, queuedKeys: stillQueued(get().queuedKeys, list) } : { uploads: list });
      } catch {
        /* transient; the next poll will retry */
      }
    };
    await Promise.all(direction ? [load(direction)] : [load('download'), load('upload')]);
  },

  toast(text, tone = 'info') {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    setTimeout(() => get().dismiss(id), tone === 'error' ? 7000 : 3500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** When each queued mark was first seen: a new one may not be in the engine's list yet. */
const markedAt = new Map<string, number>();

/**
 * The "Queued" marks that still have a download behind them. Deleting a download (or cancelling it) takes it out of
 * the list, and its search rows offer Download again. Marks younger than a minute stay while the engine catches up.
 */
function stillQueued(keys: Set<string>, users: TransferUser[]): Set<string> {
  const now = Date.now();
  const listed = new Set<string>();
  for (const u of users)
    for (const d of u.directories)
      for (const f of d.files) if (f.state !== 'Completed, Cancelled') listed.add(`${u.username}\u0000${f.filename}`);
  const next = new Set<string>();
  for (const k of keys) {
    if (!markedAt.has(k)) markedAt.set(k, now);
    if (listed.has(k) || now - markedAt.get(k)! < 60_000) next.add(k);
    else markedAt.delete(k);
  }
  return next.size === keys.size ? keys : next;
}
