import { uuid } from '../lib/uuid';
import { helperLibrary } from './library';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { isScalar, isSeq, parseDocument, type Document } from 'yaml';
import { ApiError, type Backend, type Direction, type FileAccess, type FolderAccess, type LinkProblem, type PortCheck, type SignInResult, type SearchWatch, type Unsubscribe } from './backend';
import type {
  BrowseResult,
  ChatMessage,
  Conversation,
  EnqueueFile,
  EnqueueOptions,
  LocalFiles,
  LogLine,
  Room,
  RoomInfo,
  Search,
  SearchResponse,
  ServerState,
  Settings,
  SettingsPatch,
  ShareStatus,
  TransferUser,
  UserInfo,
  UserStatus,
} from './types';

const INT_MAX = 2147483647;
const limitOf = (v: unknown) => (typeof v === 'number' && v > 0 && v < INT_MAX ? v : null);
const enc = encodeURIComponent;
/**
 * Where the page finds slskd and the local helper. The standalone launcher
 * serves the page from slskd itself with a helper on port 5031; luniceOS
 * serves it under its own origin and sets window.__SSK_LITE__ before loading.
 */
const host = (globalThis as { __SSK_LITE__?: { base?: string; helper?: string } }).__SSK_LITE__ ?? {};
export const API_BASE = host.base ?? '';
export const HELPER = host.helper ?? 'http://127.0.0.1:5031';

/**
 * Replace a YAML list while keeping the existing entries' nodes, so comments
 * written next to folders that are still shared survive the edit.
 */
function setList(doc: Document, path: string[], values: string[]) {
  const seq = doc.getIn(path, true);
  if (!isSeq(seq)) {
    doc.setIn(path, values);
    return;
  }
  const kept = new Map<unknown, unknown>();
  for (const item of seq.items) if (isScalar(item)) kept.set(item.value, item);
  seq.items = values.map((v) => kept.get(v) ?? doc.createNode(v)) as typeof seq.items;
}

const LEECHERS = ['transfers', 'groups', 'leechers'];
const DEFAULT_GROUP = ['transfers', 'groups', 'default'];
/** The engine's user-defined group for the People list. */
const FRIENDS = ['transfers', 'groups', 'user_defined', 'friends'];

/** Removes group sections left empty, so the config file stays tidy. */
function pruneGroups(doc: Document) {
  for (const path of [['transfers', 'groups', 'default', 'upload'], DEFAULT_GROUP, ['transfers', 'groups', 'user_defined'], ['transfers', 'groups']]) {
    const node = doc.getIn(path, true) as { items?: unknown[] } | undefined;
    if (node && Array.isArray(node.items) && node.items.length === 0) doc.deleteIn(path);
  }
}

interface SlskdOptions {
  remoteConfiguration?: boolean;
  soulseek?: { username?: string; description?: string; picture?: string | null };
  directories?: { downloads?: string };
  shares?: { directories?: string[] };
  transfers?: {
    upload?: { slots?: number; speedLimit?: number };
    download?: { speedLimit?: number };
    groups?: { blacklisted?: { members?: string[] } };
  };
}

const TOKEN_KEY = 'ssk-lite.token';

const getToken = () =>
  sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY);

const clearToken = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
};

/**
 * Talks to a running slskd instance over its HTTP API and SignalR hubs.
 * `baseUrl` is empty when the UI is served from the same origin (or through
 * the dev proxy).
 */
export class SlskdBackend implements Backend {
  readonly kind = 'slskd' as const;
  private searchHub?: Promise<HubConnection>;

  constructor(private readonly baseUrl = '') {}

  /**
   * Every call gives up after a while (30 s, or what the caller says), so a busy or
   * restarting engine shows an error instead of a page that waits forever.
   */
  private async request<T>(method: string, path: string, body?: unknown, timeout = 30_000): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${this.baseUrl}/api/v0${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    }).catch((e: Error) => {
      throw new ApiError(e.name === 'TimeoutError' ? 'The engine took too long to answer.' : 'The engine isn’t answering.', 0);
    });

    if (res.status === 401 && path !== '/session') clearToken();
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(text || `${method} ${path} failed with ${res.status}`, res.status);
    }

    const type = res.headers.get('content-type') ?? '';
    if (type.includes('json')) {
      // Some endpoints answer 201/204 with a JSON content type and no body.
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    }
    if (type.startsWith('text/')) return res.text() as Promise<T>;
    return undefined as T;
  }

  async needsLogin() {
    const enabled = await this.request<boolean>('GET', '/session/enabled');
    if (!enabled) return false;
    if (!getToken()) return true;
    try {
      await this.request('GET', '/session');
      return false;
    } catch {
      return true;
    }
  }

  async login(username: string, password: string, remember: boolean) {
    const { token } = await this.request<{ token: string }>('POST', '/session', {
      username,
      password,
    });
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  }

  /**
   * On the computer running slskd, the local helper signs in for you with the
   * web login from slskd's config, so only other devices (a phone) see the
   * login screen.
   */
  async helperLogin() {
    try {
      const res = await fetch(`${HELPER}/token`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return false;
      const { token } = (await res.json()) as { token?: string | null };
      if (!token) return false;
      localStorage.setItem(TOKEN_KEY, token);
      return true;
    } catch {
      return false;
    }
  }

  async quit() {
    await this.request('DELETE', '/application');
  }

  logout() {
    clearToken();
  }

  /** /server doesn't say who you are; /application does. */
  /** Your own name, once known, so your own share is read locally. */
  private me?: string;

  async server() {
    const app = await this.request<{ server: ServerState; user?: { username?: string } }>('GET', '/application', undefined, 8000);
    this.me = app.user?.username || app.server.username || this.me;
    // Right after the engine starts it hasn't begun signing in yet, so it doesn't know your name: the config does.
    if (!this.me) {
      const o = await this.request<SlskdOptions>('GET', '/options', undefined, 8000).catch(() => undefined);
      this.me = o?.soulseek?.username || undefined;
    }
    return { ...app.server, username: this.me };
  }

  async startSearch(text: string) {
    const id = uuid();
    // slskd stops at 15 s and 100 answers by default; popular names get far more than that.
    return this.request<Search>('POST', '/searches', { id, searchText: text, searchTimeout: 30_000, responseLimit: 1000, fileLimit: 100_000 });
  }

  async stopSearch(id: string) {
    await this.request('PUT', `/searches/${encodeURIComponent(id)}`);
  }

  async removeSearch(id: string) {
    await this.request('DELETE', `/searches/${encodeURIComponent(id)}`);
  }

  private hub() {
    this.searchHub ??= (async () => {
      const conn = new HubConnectionBuilder()
        .withUrl(`${this.baseUrl}/hub/search`, {
          accessTokenFactory: () => getToken() ?? '',
        })
        .withAutomaticReconnect()
        .configureLogging(LogLevel.Warning)
        .build();
      await conn.start();
      return conn;
    })();
    return this.searchHub;
  }

  watchSearch(id: string, watch: SearchWatch): Unsubscribe {
    let stopped = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    // A user answers a search once; keying by username drops replays.
    const fresh = (list: SearchResponse[]) =>
      list.filter((r) => {
        if (seen.has(r.username)) return false;
        seen.add(r.username);
        return true;
      });
    const deliver = (list: SearchResponse[]) => {
      const add = fresh(list);
      if (add.length && !stopped) watch.onResponses(add);
    };

    const onResponse = (msg: { searchId: string; response: SearchResponse }) => {
      if (msg.searchId === id) deliver([msg.response]);
    };

    // slskd's hub reports progress but doesn't reliably push each response, so
    // responses are fetched over HTTP. The list of answers can be many
    // megabytes, so it's only fetched when the search says it has answers we
    // haven't seen yet; several searches at once stay light.
    let fetching: Promise<Search | undefined> | undefined;
    let finished = false;
    // A finished search is only passed on once its responses are all in: slskd
    // marks a search complete a moment before it has saved the responses.
    const catchUp = (holdCompleted = false) =>
      (fetching ??= (async () => {
        try {
          const search = await this.request<Search>('GET', `/searches/${enc(id)}`);
          if (stopped) return search;
          if ((search.responseCount ?? 0) > seen.size) {
            const responses = await this.request<SearchResponse[]>('GET', `/searches/${enc(id)}/responses`, undefined, 60_000);
            if (stopped) return search;
            deliver(responses);
          }
          const done = search.state.startsWith('Completed');
          const complete = !done || seen.size >= (search.responseCount ?? 0);
          if (!(done && holdCompleted && !complete)) watch.onUpdate(search);
          return done && !complete ? { ...search, state: 'InProgress' } : search;
        } catch {
          return undefined;
        } finally {
          fetching = undefined;
        }
      })());

    const finish = async () => {
      if (finished) return;
      finished = true;
      if (poll) clearTimeout(poll);
      await fetching;
      // Retry briefly until every response the search counted has arrived.
      for (let i = 0; i < 12 && !stopped; i++) {
        const search = await catchUp(i < 11);
        if (search?.state.startsWith('Completed')) return;
        await new Promise((r) => setTimeout(r, 500));
      }
    };

    const onUpdate = (search: Search) => {
      if (search.id !== id || stopped) return;
      // A finished search is reported only after its last responses are in.
      if (search.state.startsWith('Completed')) {
        finish();
        return;
      }
      watch.onUpdate(search);
    };

    // Answers arrive fastest in the first seconds; after that, looking every few seconds is plenty.
    const started = Date.now();
    const pollLoop = async () => {
      if (stopped || finished) return;
      const search = await catchUp(true);
      if (search?.state.startsWith('Completed')) {
        finish();
        return;
      }
      poll = setTimeout(pollLoop, Date.now() - started < 8000 ? 1000 : 2500);
    };
    pollLoop();

    this.hub()
      .then((conn) => {
        if (stopped) return;
        conn.on('RESPONSE', onResponse);
        conn.on('UPDATE', onUpdate);
      })
      .catch(() => undefined);

    return () => {
      stopped = true;
      if (poll) clearTimeout(poll);
      this.searchHub?.then((conn) => {
        conn.off('RESPONSE', onResponse);
        conn.off('UPDATE', onUpdate);
      }).catch(() => undefined);
    };
  }

  transfers(direction: Direction) {
    return this.request<TransferUser[]>('GET', `/transfers/${direction}s`);
  }

  async enqueue(username: string, files: EnqueueFile[], options?: EnqueueOptions) {
    if (options?.batchId || options?.destination) {
      // A batch lets every source of one album write into the same folder.
      await this.request('POST', '/transfers/downloads/batches', {
        id: options.batchId,
        username,
        files,
        options: { destination: options.destination },
      }, 120_000);
      return;
    }
    await this.request('POST', `/transfers/downloads/${encodeURIComponent(username)}`, files, 120_000);
  }

  async pastResponses(text: string, exceptId: string) {
    const all = await this.request<Search[]>('GET', '/searches');
    const q = text.trim().toLowerCase();
    const past = all
      .filter((x) => x.id !== exceptId && x.searchText.trim().toLowerCase() === q && x.state.startsWith('Completed'))
      .sort((a, b) => Date.parse((b as { startedAt?: string }).startedAt ?? '') - Date.parse((a as { startedAt?: string }).startedAt ?? ''))
      .slice(0, 2);
    const byUser = new Map<string, SearchResponse>();
    for (const x of past.reverse()) {
      const responses = await this.request<SearchResponse[]>('GET', `/searches/${encodeURIComponent(x.id)}/responses`).catch(() => []);
      responses.forEach((r) => byUser.set(r.username, r));
    }
    return [...byUser.values()];
  }

  async measuredSpeeds() {
    const out = new Map<string, number>();
    try {
      const start = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const rows = await this.request<{ username: string; averageSpeed: number; count: number }[] | { items?: unknown[] }>(
        'GET',
        `/telemetry/reports/transfers/leaderboard?direction=Download&start=${encodeURIComponent(start)}&limit=1000`,
      );
      const list = (Array.isArray(rows) ? rows : ((rows as { items?: unknown[] }).items ?? [])) as { username: string; averageSpeed: number }[];
      list.forEach((r) => r.username && r.averageSpeed > 0 && out.set(r.username, r.averageSpeed));
    } catch {
      /* older slskd without telemetry: rank by what people advertise */
    }
    return out;
  }

  async cancel(direction: Direction, username: string, id: string, remove: boolean) {
    await this.request('DELETE', `/transfers/${direction}s/${enc(username)}/${enc(id)}?remove=${remove}`);
  }

  async clearCompleted(direction: Direction) {
    await this.request('DELETE', `/transfers/${direction}s/all/completed`);
  }

  browse(username: string) {
    // Browsing yourself over the network means connecting to your own public
    // address, which most home routers refuse. slskd has the list locally.
    if (this.me && username === this.me) return this.myShare();
    return this.request<BrowseResult>('GET', `/users/${enc(username)}/browse`, undefined, 180_000);
  }

  /** Your share exactly as others receive it, straight from slskd's share database. */
  async myShare(): Promise<BrowseResult> {
    const directories = await this.request<BrowseResult['directories']>('GET', '/shares/contents');
    return { directories: directories.filter((d) => d.files.length > 0) };
  }

  async userInfo(username: string): Promise<UserInfo> {
    if (this.me && username === this.me) {
      // Your own profile, from your settings rather than a round trip through the network.
      const s = await this.settings();
      const url = s.picture ? await this.files.imagePreview(s.picture).catch(() => null) : null;
      return { description: s.description, hasPicture: !!url, picture: url ? url.replace(/^data:[^,]*,/, '') : null, uploadSlots: s.uploadSlots };
    }
    return this.request<UserInfo>('GET', `/users/${enc(username)}/info`, undefined, 90_000);
  }

  async userStatus(username: string): Promise<UserStatus> {
    if (this.me && username === this.me) return { presence: (await this.server()).isLoggedIn ? 'Online' : 'Offline' };
    return this.request<UserStatus>('GET', `/users/${enc(username)}/status`, undefined, 60_000);
  }

  // --- sharing and limits -------------------------------------------------

  async settings(): Promise<Settings> {
    const o = await this.request<SlskdOptions>('GET', '/options');
    // A new download folder only takes effect after a restart, so show the one
    // written in the config file rather than the one slskd is still using.
    // The same goes for the profile.
    let downloadDir = o.directories?.downloads ?? '';
    const profile: { description?: string; picture?: string } = {};
    const groups: Pick<Settings, 'leech' | 'friendsFirst' | 'friends'> = { leech: { mode: 'off', files: 1 }, friendsFirst: false, friends: [] };
    if (o.remoteConfiguration) {
      try {
        const raw = await this.request<string>('GET', '/options/yaml');
        const doc = parseDocument(typeof raw === 'string' ? raw : '');
        const saved = doc.getIn(['directories', 'downloads']);
        if (typeof saved === 'string' && saved) downloadDir = saved;
        const desc = doc.getIn(['soulseek', 'description']);
        if (typeof desc === 'string') profile.description = desc;
        const pic = doc.getIn(['soulseek', 'picture']);
        if (typeof pic === 'string') profile.picture = pic;
        // The rules Nightjar writes (see saveSettings): leechers with a speed cap are "strict".
        if (doc.hasIn(LEECHERS)) {
          const files = Number(doc.getIn([...LEECHERS, 'thresholds', 'files']));
          groups.leech = { mode: doc.hasIn([...LEECHERS, 'upload', 'speed_limit']) ? 'strict' : 'gentle', files: files > 0 ? files : 1 };
        }
        if (doc.hasIn(FRIENDS)) {
          groups.friendsFirst = true;
          const m = doc.getIn([...FRIENDS, 'members']);
          groups.friends = isSeq(m) ? m.items.map((i) => String(isScalar(i) ? i.value : i)) : [];
        }
      } catch {
        /* fall back to the running values */
      }
    }
    return {
      downloadDir,
      sharedFolders: o.shares?.directories ?? [],
      uploadLimit: limitOf(o.transfers?.upload?.speedLimit),
      downloadLimit: limitOf(o.transfers?.download?.speedLimit),
      uploadSlots: o.transfers?.upload?.slots ?? 20,
      blocked: o.transfers?.groups?.blacklisted?.members ?? [],
      leech: groups.leech,
      friendsFirst: groups.friendsFirst,
      friends: groups.friends,
      description: profile.description ?? o.soulseek?.description ?? '',
      picture: profile.picture ?? o.soulseek?.picture ?? '',
      editable: !!o.remoteConfiguration,
    };
  }

  /**
   * slskd only takes these settings through its YAML config file. Editing the
   * parsed document (rather than rebuilding it) keeps the person's comments
   * and every key we don't touch.
   */
  async saveSettings(patch: SettingsPatch) {
    const raw = await this.request<string>('GET', '/options/yaml');
    const text = typeof raw === 'string' && raw.trim() ? raw : '{}';
    const doc = parseDocument(text);
    const set = (path: string[], value: unknown) =>
      value === null ? doc.deleteIn(path) : doc.setIn(path, value);

    if (patch.downloadDir !== undefined) set(['directories', 'downloads'], patch.downloadDir || null);
    if (patch.sharedFolders !== undefined) setList(doc, ['shares', 'directories'], patch.sharedFolders);
    if (patch.uploadLimit !== undefined) set(['transfers', 'upload', 'speed_limit'], patch.uploadLimit);
    if (patch.downloadLimit !== undefined) set(['transfers', 'download', 'speed_limit'], patch.downloadLimit);
    if (patch.uploadSlots !== undefined) set(['transfers', 'upload', 'slots'], patch.uploadSlots);
    if (patch.blocked !== undefined) setList(doc, ['transfers', 'groups', 'blacklisted', 'members'], patch.blocked);
    if (patch.leech !== undefined) {
      if (patch.leech.mode === 'off') doc.deleteIn(LEECHERS);
      else {
        const strict = patch.leech.mode === 'strict';
        // Lower priority numbers go first; everyone else is priority 1 (or 2 with friends first).
        doc.setIn(LEECHERS, {
          thresholds: { files: Math.max(1, Math.round(patch.leech.files)), directories: 1 },
          upload: {
            priority: 999,
            strategy: 'roundrobin',
            slots: 1,
            ...(strict && { speed_limit: 100 }),
            limits: strict
              ? { queued: { files: 20, megabytes: 500 }, daily: { files: 50, megabytes: 1500 } }
              : { queued: { files: 60, megabytes: 3000 } },
          },
        });
      }
      pruneGroups(doc);
    }
    if (patch.friendsFirst !== undefined || patch.friends !== undefined) {
      const on = patch.friendsFirst ?? doc.hasIn(FRIENDS);
      if (!on) {
        doc.deleteIn(FRIENDS);
        if (doc.getIn([...DEFAULT_GROUP, 'upload', 'priority']) === 2) doc.deleteIn([...DEFAULT_GROUP, 'upload', 'priority']);
      } else {
        // Friends are priority 1, everyone else 2: the engine serves the lowest number first.
        if (!doc.hasIn(FRIENDS)) doc.setIn(FRIENDS, { upload: { priority: 1, strategy: 'firstinfirstout' }, members: [] });
        doc.setIn([...DEFAULT_GROUP, 'upload', 'priority'], 2);
        if (patch.friends !== undefined) setList(doc, [...FRIENDS, 'members'], patch.friends);
      }
      pruneGroups(doc);
    }
    if (patch.description !== undefined) {
      // A block scalar keeps line breaks the way the person typed them.
      const node = doc.createNode(patch.description.replace(/\r\n/g, '\n'));
      if (patch.description.includes('\n')) (node as { type?: string }).type = 'BLOCK_LITERAL';
      doc.setIn(['soulseek', 'description'], node);
    }
    if (patch.picture !== undefined) set(['soulseek', 'picture'], patch.picture || null);

    const yaml = doc.toString();
    const errors = await this.request<string | null>('POST', '/options/yaml/validate', yaml).catch(() => null);
    if (errors) throw new ApiError(String(errors), 400);
    await this.request('PUT', '/options/yaml', yaml);
    if (patch.sharedFolders !== undefined) await this.waitForShares(patch.sharedFolders);
  }

  async shareStatus(): Promise<ShareStatus> {
    const app = await this.request<{ shares?: Partial<ShareStatus> & { scanProgress?: number } }>('GET', '/application');
    const sh = app.shares ?? {};
    return {
      scanning: !!sh.scanning,
      progress: sh.scanProgress ?? 0,
      directories: sh.directories ?? 0,
      files: sh.files ?? 0,
      faulted: !!sh.faulted,
    };
  }

  async rescan() {
    await this.request('PUT', '/shares');
  }

  /** Asks the launcher's helper to run Soulseek's port test from this computer. */
  async checkPort(): Promise<PortCheck | null> {
    try {
      const res = await fetch(`${HELPER}/port-check`, { signal: AbortSignal.timeout(25_000) });
      return res.ok ? ((await res.json()) as PortCheck) : null;
    } catch {
      return null;
    }
  }

  async openPort() {
    try {
      const res = await fetch(`${HELPER}/upnp`, { signal: AbortSignal.timeout(70_000) });
      return res.ok ? ((await res.json()) as { ok: boolean; ip?: string; port?: number; error?: string }) : null;
    } catch {
      return null;
    }
  }

  async allowFirewall() {
    try {
      const res = await fetch(`${HELPER}/firewall`, { signal: AbortSignal.timeout(130_000) });
      return res.ok ? ((await res.json()) as { ok: boolean; error?: string }) : null;
    } catch {
      return null;
    }
  }

  async myStats() {
    const app = await this.request<{ user?: { statistics?: { averageSpeed?: number; uploadCount?: number; fileCount?: number; directoryCount?: number } } }>(
      'GET',
      '/application',
      undefined,
      8000,
    ).catch(() => undefined);
    const st = app?.user?.statistics;
    if (!st) return null;
    return { averageSpeed: st.averageSpeed ?? 0, uploads: st.uploadCount ?? 0, files: st.fileCount ?? 0, folders: st.directoryCount ?? 0 };
  }

  /** Your Soulseek account as written in the config: the name, and whether a password is set. */
  async account() {
    const raw = await this.request<string>('GET', '/options/yaml');
    const doc = parseDocument(typeof raw === 'string' ? raw : '');
    const username = doc.getIn(['soulseek', 'username']);
    const password = doc.getIn(['soulseek', 'password']);
    return { username: typeof username === 'string' ? username : '', hasPassword: typeof password === 'string' && password.length > 0 };
  }

  /**
   * Saves the Soulseek account and signs in with it. Soulseek creates the account
   * the first time a free name signs in, so "rejected" means the name belongs to
   * someone else, or the password is wrong.
   */
  async signIn(username: string, password: string): Promise<SignInResult> {
    const raw = await this.request<string>('GET', '/options/yaml');
    const doc = parseDocument(typeof raw === 'string' && raw.trim() ? raw : '{}');
    doc.setIn(['soulseek', 'username'], username);
    doc.setIn(['soulseek', 'password'], password);
    const yaml = doc.toString();
    const errors = await this.request<string | null>('POST', '/options/yaml/validate', yaml).catch(() => null);
    if (errors) throw new ApiError(String(errors), 400);
    await this.request('PUT', '/options/yaml', yaml);
    // slskd reloads the file a moment later; then connect again with the new account.
    await new Promise((r) => setTimeout(r, 1500));
    const started = Date.now();
    await this.request('DELETE', '/server', 'Changing account').catch(() => undefined);
    await this.request('PUT', '/server').catch(() => undefined);
    while (Date.now() - started < 45_000) {
      await new Promise((r) => setTimeout(r, 1000));
      const app = await this.request<{ server: ServerState; user?: { username?: string } }>('GET', '/application').catch(() => undefined);
      if (app?.server.isLoggedIn && app.user?.username === username) {
        this.me = username;
        return 'ok';
      }
      const problem = await this.linkProblem(started);
      if (problem === 'rejected' || problem === 'kicked') return problem;
    }
    return 'timeout';
  }

  /** Why the engine isn't signed in, from its log: since the last sign-in, or since a moment you give. */
  async linkProblem(since = 0): Promise<LinkProblem> {
    const lines = await this.request<LogLine[]>('GET', '/logs/live', undefined, 8000).catch(() => [] as LogLine[]);
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (since && Date.parse(l.timestamp) < since - 1000) break;
      if (/Logged in to the Soulseek server/.test(l.message)) return null;
      if (/invalid username or password/i.test(l.message)) return 'rejected';
      if (/another client logged in using the same username/i.test(l.message)) return 'kicked';
      if (/username and\/or password invalid/i.test(l.message)) return 'no-account';
    }
    return null;
  }

  async activity(): Promise<LogLine[]> {
    return this.request<LogLine[]>('GET', '/logs/live');
  }

  /** slskd records where each finished download was saved in its event log. */
  async localFiles(): Promise<LocalFiles> {
    const map: LocalFiles = new Map();
    const events = await this.request<{ type: string; data: string }[]>('GET', '/events?limit=1000');
    for (const e of events) {
      if (e.type !== 'DownloadFileComplete') continue;
      try {
        const d = JSON.parse(e.data) as { localFilename?: string; transfer?: { id?: string } };
        if (d.transfer?.id && d.localFilename) map.set(d.transfer.id, d.localFilename);
      } catch {
        /* skip malformed */
      }
    }
    return map;
  }

  readonly files: FileAccess = {
    available: () => this.folders.available(),
    reveal: async (path) => {
      try {
        return (await fetch(`${HELPER}/reveal?path=${enc(path)}`)).ok;
      } catch {
        return false;
      }
    },
    trash: async (path) => {
      try {
        return (await fetch(`${HELPER}/trash?path=${enc(path)}`)).ok;
      } catch {
        return false;
      }
    },
    trashDownload: async (what) => {
      try {
        const res = await fetch(`${HELPER}/trash-download`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(what),
          signal: AbortSignal.timeout(60_000),
        });
        return res.ok ? ((await res.json()) as { removed: number }).removed : null;
      } catch {
        return null;
      }
    },
    pickImage: async () => {
      const res = await fetch(`${HELPER}/pick-image`);
      if (!res.ok) throw new ApiError('The file dialog is not available', res.status);
      const r = (await res.json()) as { path: string | null; error?: string };
      if (r.error) throw new ApiError(r.error, 400);
      return r.path;
    },
    imagePreview: async (path) => {
      try {
        const res = await fetch(`${HELPER}/image?path=${enc(path)}`);
        return res.ok ? ((await res.json()) as { dataUrl: string | null }).dataUrl : null;
      } catch {
        return null;
      }
    },
    coverUrl: async (dir) => {
      const key = await this.imageKey();
      return key ? `${HELPER}/cover?k=${key}&dir=${enc(dir)}` : null;
    },
    lease: async (id) => {
      try {
        const res = await fetch(`${HELPER}/lease?id=${enc(id)}`, { method: 'POST', signal: AbortSignal.timeout(3000) });
        return res.ok && ((await res.json()) as { mine?: boolean }).mine === true;
      } catch {
        return false; // a phone, or no Nightjar app: the computer's window does the managing
      }
    },
    shareRoots: async () => {
      const res = await this.request<{ local?: { remotePath: string; localPath: string; isExcluded?: boolean }[] }>('GET', '/shares');
      return (res.local ?? []).filter((x) => !x.isExcluded).map((x) => ({ remote: x.remotePath, local: x.localPath }));
    },
  };

  /** The helper hands out a secret so only this page can show your local pictures. */
  private keyPromise?: Promise<string | null>;
  private imageKey() {
    this.keyPromise ??= fetch(`${HELPER}/img-key`, { signal: AbortSignal.timeout(2500) })
      .then((r) => (r.ok ? (r.json() as Promise<{ key?: string }>) : {}))
      .then((j) => (j as { key?: string }).key ?? null)
      .catch(() => null);
    return this.keyPromise;
  }

  async restartNeeded() {
    const app = await this.request<{ pendingRestart?: boolean }>('GET', '/application');
    return !!app.pendingRestart;
  }

  /**
   * slskd restarts itself in place on PUT /application, keeping the launcher's
   * window and helper running. Older launchers can also do it through the helper.
   */
  async restart() {
    let asked = false;
    // The Nightjar app restarts the engine itself and keeps watching it; slskd's own restart is the fallback.
    try {
      const res = await fetch(`${HELPER}/restart`, { method: 'POST', signal: AbortSignal.timeout(4000) });
      asked = res.ok;
    } catch {
      /* no app on this computer */
    }
    if (!asked) {
      try {
        await this.request('PUT', '/application');
        asked = true;
      } catch {
        /* nothing can restart it from here */
      }
    }
    if (!asked) return false;
    // Wait for slskd to go away and come back.
    const until = Date.now() + 90_000;
    await new Promise((r) => setTimeout(r, 2500));
    while (Date.now() < until) {
      try {
        const app = await this.request<{ server?: { isLoggedIn?: boolean } }>('GET', '/application');
        if (app.server?.isLoggedIn) return true;
      } catch {
        /* still starting */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  /**
   * slskd reloads its config file a moment after it's written. Waiting for the
   * new value avoids starting a scan that still sees the old folder list.
   */
  async waitForShares(expected: string[], timeoutMs = 10_000) {
    const want = expected.join('\n');
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const o = await this.request<SlskdOptions>('GET', '/options').catch(() => undefined);
      if ((o?.shares?.directories ?? []).join('\n') === want) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  readonly library = helperLibrary(HELPER);

  /** Talks to the Nightjar app's helper on this computer. */
  readonly folders: FolderAccess = {
    available: async () => {
      try {
        const res = await fetch(`${HELPER}/ping`, { signal: AbortSignal.timeout(1500) });
        return res.ok;
      } catch {
        return false;
      }
    },
    pick: async (start) => {
      const res = await fetch(`${HELPER}/pick-folder${start ? `?start=${enc(start)}` : ''}`);
      if (!res.ok) throw new ApiError('The folder dialog is not available', res.status);
      return ((await res.json()) as { path: string | null }).path;
    },
    exists: async (path) => {
      try {
        const res = await fetch(`${HELPER}/exists?path=${enc(path)}`, { signal: AbortSignal.timeout(2000) });
        return res.ok ? ((await res.json()) as { exists: boolean }).exists : null;
      } catch {
        return null;
      }
    },
    known: async () => {
      try {
        const res = await fetch(`${HELPER}/known-folders`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return (await res.json()) as { music: string | null; musicInOneDrive: boolean };
      } catch {
        /* no app on this computer */
      }
      return { music: null, musicInOneDrive: false };
    },
  };

  // --- private chat -------------------------------------------------------

  conversations() {
    return this.request<Conversation[]>('GET', '/conversations');
  }

  messages(username: string) {
    return this.request<ChatMessage[]>('GET', `/conversations/${enc(username)}/messages`);
  }

  async sendMessage(username: string, text: string) {
    await this.request('POST', `/conversations/${enc(username)}`, text);
  }

  async markRead(username: string) {
    await this.request('PUT', `/conversations/${enc(username)}`);
  }

  async closeConversation(username: string) {
    await this.request('DELETE', `/conversations/${enc(username)}`);
  }

  // --- rooms --------------------------------------------------------------

  availableRooms() {
    return this.request<RoomInfo[]>('GET', '/rooms/available');
  }

  async joinedRooms() {
    const joined = await this.request<Record<string, unknown> | string[]>('GET', '/rooms/joined');
    return Array.isArray(joined) ? joined : Object.keys(joined);
  }

  async room(name: string): Promise<Room> {
    const r = await this.request<Room>('GET', `/rooms/joined/${enc(name)}`);
    return { name: r.name ?? name, users: r.users ?? [], messages: r.messages ?? [] };
  }

  async joinRoom(name: string) {
    await this.request('POST', '/rooms/joined', name);
  }

  async leaveRoom(name: string) {
    await this.request('DELETE', `/rooms/joined/${enc(name)}`);
  }

  async sendRoomMessage(name: string, text: string) {
    await this.request('POST', `/rooms/joined/${enc(name)}/messages`, text);
  }
}
