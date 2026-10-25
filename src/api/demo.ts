import { demoLibrary } from './library';
import { uuid } from '../lib/uuid';
import { ApiError, type Backend, type Direction, type FileAccess, type FolderAccess, type PortCheck, type SearchWatch, type Unsubscribe } from './backend';
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
  RoomMessage,
  RoomUser,
  Search,
  SearchFile,
  SearchResponse,
  ServerState,
  Settings,
  SettingsPatch,
  ShareStatus,
  Transfer,
  TransferUser,
  UserInfo,
  UserStatus,
} from './types';

// A self-contained, fictional slice of the network so the interface can be
// explored without an account. Every artist, album and user here is invented.

interface Album {
  artist: string;
  title: string;
  year: number;
  tracks: string[];
}

const CATALOG: Album[] = [
  { artist: 'Halvard Moss', title: 'Low Country Lights', year: 2009, tracks: ['Ferry at Dawn', 'Salt Roads', 'Low Country Lights', 'Margins', 'A Harbour Mile', 'Weatherglass', 'Second Tide', 'Lantern Hours', 'Nowhere North'] },
  { artist: 'Halvard Moss', title: 'The Long Field', year: 2014, tracks: ['Overture for Stubble', 'The Long Field', 'Crows in August', 'Hay Barn', 'Shortening Days', 'Late Plough', 'Fences'] },
  { artist: 'The Quiet Engines', title: 'Signal Path', year: 2003, tracks: ['Carrier', 'Signal Path', 'Interference', 'Copper Lines', 'Relay', 'Feedback Loop', 'Dead Air', 'Handshake', 'Static Bloom', 'Off Hook'] },
  { artist: 'The Quiet Engines', title: 'Night Bus Diaries', year: 2007, tracks: ['N29', 'Top Deck', 'Sodium', 'Last Stop Before the River', 'Rain on Glass', 'Depot'] },
  { artist: 'Lumen Atlas', title: 'Cartography', year: 2018, tracks: ['Meridian', 'Contour', 'Scale 1:50000', 'Legend', 'Isobar', 'True North', 'Uncharted', 'Compass Rose'] },
  { artist: 'Noor & the Tidewater', title: 'Brackish', year: 2021, tracks: ['Estuary', 'Brackish', 'Mudflats', 'Heron', 'Spring Tide', 'Groyne', 'Saltmarsh Hymn'] },
  { artist: 'Kestrel Park', title: 'Kestrel Park', year: 1998, tracks: ['Hover', 'Thermals', 'Motorway Verge', 'Stoop', 'Kestrel Park', 'Prey', 'Fieldglass', 'Updraught', 'Plumage', 'Home Range', 'Dusk Patrol'] },
  { artist: 'Saudade Collective', title: 'Alfama Tapes', year: 2012, tracks: ['Rua do Vento', 'Eléctrico 28', 'Miradouro', 'Varinas', 'Tasca', 'Fado Menor em Dó', 'Cais', 'Despedida'] },
  { artist: 'Velvet Arcade', title: 'Coin-Op', year: 1986, tracks: ['Insert Coin', 'High Score', 'Neon Lobby', 'Two Player', 'Attract Mode', 'Continue?', 'Game Over'] },
  { artist: 'Orla Finch', title: 'Small Hours', year: 2016, tracks: ['3 AM', 'Kettle', 'Small Hours', 'Radiator Song', 'Insomniac Waltz', 'First Bird', 'Milk Float'] },
];

const USERS = [
  'vinylmole', 'deepcrate', 'tapehiss', 'lossless_larry', 'bandcampfire', 'archivista',
  'needledrop', 'flac_attack', 'riverbedrecords', 'mono_mono', 'loudness_war_vet', 'b-side',
  'cassettefuturism', 'sonata_k', 'dustgroove', 'quietstorm', 'ripper99', 'lp_hoarder',
];

type Profile = { ext: string; bitDepth?: number; sampleRate?: number; bitRate?: number; vbr?: boolean };
const PROFILES: Profile[] = [
  { ext: 'flac', bitDepth: 24, sampleRate: 96000 },
  { ext: 'flac', bitDepth: 24, sampleRate: 48000 },
  { ext: 'flac', bitDepth: 16, sampleRate: 44100 },
  { ext: 'flac', bitDepth: 16, sampleRate: 44100 },
  { ext: 'mp3', bitRate: 320 },
  { ext: 'mp3', bitRate: 320 },
  { ext: 'mp3', bitRate: 245, vbr: true },
  { ext: 'mp3', bitRate: 192 },
  { ext: 'mp3', bitRate: 128 },
  { ext: 'm4a', bitRate: 256 },
];

// Small deterministic PRNG so the same query gives the same network.
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];

function folderFor(r: () => number, user: string, a: Album, p: Profile) {
  const tag = p.ext === 'flac' ? (p.bitDepth === 24 ? '[24-96 FLAC]' : '[FLAC]') : p.bitRate === 320 ? '[320]' : p.vbr ? '[V0]' : '';
  const styles = [
    `@@${user.slice(0, 5)}\\Music\\${a.artist}\\${a.year} - ${a.title}`,
    `@@${user.slice(0, 5)}\\Shared\\${a.artist} - ${a.title} (${a.year}) ${tag}`.trim(),
    `@@${user.slice(0, 5)}\\Albums\\${a.artist}\\${a.title}`,
  ];
  return pick(r, styles);
}

function filesFor(r: () => number, folder: string, a: Album, p: Profile): SearchFile[] {
  const files: SearchFile[] = a.tracks.map((t, i) => {
    // The same release has the same track lengths for everyone, so copies in the same format are identical.
    const length = 150 + Math.floor(rng(`${a.artist}:${a.title}:${i}`)() * 240);
    const kbps = p.bitRate ?? Math.round(((p.sampleRate ?? 44100) * (p.bitDepth ?? 16) * 2) / 1000 * 0.62);
    return {
      filename: `${folder}\\${String(i + 1).padStart(2, '0')} - ${t}.${p.ext}`,
      extension: p.ext,
      size: Math.round((kbps * 1000 * length) / 8),
      length,
      bitRate: p.bitRate ?? null,
      bitDepth: p.bitDepth ?? null,
      sampleRate: p.sampleRate ?? null,
      isVariableBitRate: p.vbr ?? false,
    };
  });
  files.push({ filename: `${folder}\\cover.jpg`, extension: 'jpg', size: 380_000 + Math.floor(r() * 900_000) });
  if (p.ext === 'flac' && r() > 0.4) files.push({ filename: `${folder}\\${a.artist} - ${a.title}.log`, extension: 'log', size: 6_200 });
  return files;
}

function matches(a: Album, q: string) {
  const hay = `${a.artist} ${a.title} ${a.tracks.join(' ')}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

function buildResponses(query: string): SearchResponse[] {
  const r = rng(query.toLowerCase());
  let albums = CATALOG.filter((a) => matches(a, query));
  // Anything typed should show something, so unmatched queries invent a release.
  if (albums.length === 0) {
    const words = query.trim().split(/\s+/);
    const title = words.map((w) => w[0]?.toUpperCase() + w.slice(1)).join(' ') || 'Untitled';
    albums = [{ artist: pick(r, CATALOG).artist, title, year: 1990 + Math.floor(r() * 35), tracks: pick(r, CATALOG).tracks }];
  }

  const byUser = new Map<string, SearchResponse>();
  const sourcesPerAlbum = 6 + Math.floor(r() * 8);
  for (const a of albums) {
    for (let i = 0; i < sourcesPerAlbum; i++) {
      const user = pick(r, USERS);
      // Popular rips spread: half the copies of an album are the same release in the same format.
      const p = r() > 0.5 ? PROFILES[(a.title.length + a.artist.length) % PROFILES.length] : pick(r, PROFILES);
      const folder = folderFor(r, user, a, p);
      const resp =
        byUser.get(user) ??
        ({
          username: user,
          files: [],
          lockedFiles: [],
          fileCount: 0,
          lockedFileCount: 0,
          hasFreeUploadSlot: r() > 0.35,
          queueLength: Math.floor(r() * r() * 40),
          uploadSpeed: Math.floor(80_000 + r() * r() * 9_000_000),
        } satisfies SearchResponse);
      if (resp.files.some((f) => f.filename.startsWith(folder))) continue;
      const files = filesFor(r, folder, a, p);
      if (r() > 0.93) resp.lockedFiles.push(...files.splice(0, 3));
      resp.files.push(...files);
      resp.fileCount = resp.files.length;
      resp.lockedFileCount = resp.lockedFiles.length;
      byUser.set(user, resp);
    }
  }
  // Someone shares a folder named after the first album that holds another one (an auto-tagger's failed import):
  // Nightjar should warn before downloading it.
  const a = albums[0];
  const other = CATALOG.find((x) => x.artist !== a.artist) ?? CATALOG[0];
  const bait = `music\\slskd\\failed_imports\\${a.artist} - ${a.title} (${a.year})`;
  byUser.set('flux_7714', {
    username: 'flux_7714',
    files: filesFor(r, bait, other, PROFILES[2]),
    lockedFiles: [],
    fileCount: other.tracks.length,
    lockedFileCount: 0,
    hasFreeUploadSlot: true,
    queueLength: 0,
    uploadSpeed: 12_000_000,
  });
  return [...byUser.values()];
}

// ---------------------------------------------------------------------------

interface LiveSearch {
  search: Search;
  responses: SearchResponse[];
  watchers: Set<SearchWatch>;
  timers: ReturnType<typeof setTimeout>[];
}

interface LiveTransfer extends Transfer {
  rate: number;
  startsAt: number;
  lastTick?: number;
  /** Simulated refusal: the remote side says no once the request reaches it. */
  refuse?: string;
}

// Sample people who refuse downloads, so automatic source switching can be seen.
const REFUSERS: Record<string, string> = {
  lp_hoarder: 'File not shared.',
  ripper99: 'Too many files',
  'loudness_war_vet': 'Banned',
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class DemoBackend implements Backend {
  readonly kind = 'demo' as const;
  private searches = new Map<string, LiveSearch>();
  private transfersList: LiveTransfer[] = [];
  private shared = new Map<string, SearchFile[]>();

  constructor() {
    // A few people are already downloading from you, so Uploads isn't empty.
    const r = rng('uploads');
    for (const [user, album] of [['needledrop', 0], ['quietstorm', 4], ['sonata_k', 7]] as const) {
      const a = CATALOG[album];
      const files = filesFor(r, `@@demo\\FLAC\\${a.artist}\\${a.year} - ${a.title}`, a, PROFILES[2]);
      this.addTransfers('Upload', user, files.slice(0, 5), user === 'sonata_k' ? 20000 : 300);
    }
    // And one person has already said hello.
    this.push('vinylmole', 'In', 'Hi! Saw you share the Alfama Tapes. Is that the cassette rip or the CD?');
  }

  async needsLogin() {
    return false;
  }
  async login() {}
  logout() {}

  async quit() {}

  async server(): Promise<ServerState> {
    return { isConnected: true, isLoggedIn: true, username: 'demo' };
  }

  async startSearch(text: string): Promise<Search> {
    const id = uuid();
    const search: Search = {
      id,
      searchText: text,
      state: 'InProgress',
      fileCount: 0,
      lockedFileCount: 0,
      responseCount: 0,
      startedAt: new Date().toISOString(),
    };
    const live: LiveSearch = { search, responses: [], watchers: new Set(), timers: [] };
    this.searches.set(id, live);

    const all = buildResponses(text);
    all.forEach((resp, i) => {
      resp.files.forEach((f) => {
        const list = this.shared.get(resp.username) ?? [];
        list.push(f);
        this.shared.set(resp.username, list);
      });
      const delay = 250 + i * (2600 / all.length) + Math.random() * 400;
      live.timers.push(setTimeout(() => this.deliver(live, resp), delay));
    });
    live.timers.push(setTimeout(() => this.finish(live), 3600));
    return search;
  }

  private deliver(live: LiveSearch, resp: SearchResponse) {
    live.responses.push(resp);
    const s = live.search;
    s.responseCount++;
    s.fileCount += resp.fileCount;
    s.lockedFileCount += resp.lockedFileCount;
    live.watchers.forEach((w) => {
      w.onResponses([resp]);
      w.onUpdate({ ...s });
    });
  }

  private finish(live: LiveSearch) {
    if (live.search.state !== 'InProgress') return;
    live.search.state = 'Completed, TimedOut';
    live.search.endedAt = new Date().toISOString();
    live.watchers.forEach((w) => w.onUpdate({ ...live.search }));
  }

  async stopSearch(id: string) {
    const live = this.searches.get(id);
    if (!live) return;
    live.timers.forEach(clearTimeout);
    live.search.state = 'Completed, Cancelled';
    live.search.endedAt = new Date().toISOString();
    live.watchers.forEach((w) => w.onUpdate({ ...live.search }));
  }

  async removeSearch(id: string) {
    await this.stopSearch(id);
    this.searches.delete(id);
  }

  watchSearch(id: string, watch: SearchWatch): Unsubscribe {
    const live = this.searches.get(id);
    if (!live) return () => undefined;
    if (live.responses.length) watch.onResponses([...live.responses]);
    watch.onUpdate({ ...live.search });
    live.watchers.add(watch);
    return () => live.watchers.delete(watch);
  }

  private tick() {
    const now = Date.now();
    for (const t of this.transfersList) {
      if (t.state.startsWith('Completed')) continue;
      if (now < t.startsAt) {
        t.state = t.placeInQueue ? (t.direction === 'Upload' ? 'Queued, Locally' : 'Queued, Remotely') : 'Queued, Locally';
        continue;
      }
      if (t.refuse) {
        t.state = 'Completed, Rejected';
        t.exception = t.refuse;
        t.endedAt = new Date().toISOString();
        continue;
      }
      t.placeInQueue = null;
      t.state = 'InProgress';
      // Speed limits slow every active transfer in that direction.
      const limit = (t.direction === 'Upload' ? this.config.uploadLimit : this.config.downloadLimit) ?? Infinity;
      const active = this.transfersList.filter((x) => x.direction === t.direction && x.state === 'InProgress').length || 1;
      const rate = Math.min(t.rate, (limit * 1024) / active);
      t.averageSpeed = rate;
      t.bytesTransferred = Math.min(t.size, t.bytesTransferred + rate * ((now - (t.lastTick ?? t.startsAt)) / 1000));
      t.lastTick = now;
      t.percentComplete = (t.bytesTransferred / t.size) * 100;
      if (t.bytesTransferred >= t.size) {
        t.state = 'Completed, Succeeded';
        t.endedAt = new Date().toISOString();
        if (t.direction === 'Download') {
          this.local.set(t.id, `${this.config.downloadDir}\\${t.filename.split('\\').slice(-2).join('\\')}`);
        } else {
          this.log(`Upload of ${t.filename.split('\\').pop()} to ${t.username} complete (${t.size} of ${t.size} bytes).`);
        }
      }
    }
  }

  private local: LocalFiles = new Map();
  private logLines: LogLine[] = [];
  private log(message: string) {
    this.logLines.push({ timestamp: new Date().toISOString(), level: 'Information', message });
    this.logLines = this.logLines.slice(-100);
  }

  async activity(): Promise<LogLine[]> {
    // People look around your share now and then.
    if (Math.random() < 0.25) {
      const who = pick(Math.random, USERS);
      const a = pick(Math.random, CATALOG);
      this.log(
        Math.random() < 0.5
          ? `Sent browse response to ${who}`
          : `Folder contents for @@demo\\FLAC\\${a.artist}\\${a.year} - ${a.title} sent to ${who}`,
      );
    }
    return [...this.logLines];
  }

  async localFiles(): Promise<LocalFiles> {
    return new Map(this.local);
  }

  readonly files: FileAccess = {
    available: async () => true,
    reveal: async () => true,
    trash: async (path) => {
      for (const [id, p] of this.local) if (p === path) this.local.delete(id);
      return true;
    },
    pickImage: async () => {
      await wait(500);
      return 'C:\\Users\\demo\\Pictures\\me.png';
    },
    imagePreview: async () => null,
    coverUrl: async () => null,
    pictureUrl: async () => null,
    streamUrl: async () => silence(),
    streamUrlNow: () => silence(),
    shareRoots: async () => {
      // Each top folder of the sample share "lives" in a Music folder, so its albums can be played.
      const tree = await this.browse('demo').catch(() => ({ directories: [] as { name: string }[] }));
      const tops = new Set(tree.directories.map((d) => d.name.split('\\')[0]));
      return [...tops].map((t) => ({ remote: t, local: `C:\\Users\\you\\Music\\${t}` }));
    },
    lease: async () => true,
    trashDownload: async (what) => what.folders.length + what.files.length + what.partials.length,
    peekTags: async () => null,
  };

  async transfers(direction: Direction): Promise<TransferUser[]> {
    this.tick();
    const want = direction === 'upload' ? 'Upload' : 'Download';
    const users = new Map<string, Map<string, Transfer[]>>();
    for (const t of this.transfersList.filter((x) => x.direction === want)) {
      const dir = t.filename.split('\\').slice(0, -1).join('\\');
      const dirs = users.get(t.username) ?? new Map<string, Transfer[]>();
      const { rate: _r, startsAt: _s, lastTick: _l, ...plain } = t;
      dirs.set(dir, [...(dirs.get(dir) ?? []), plain]);
      users.set(t.username, dirs);
    }
    return [...users].map(([username, dirs]) => ({
      username,
      directories: [...dirs].map(([directory, files]) => ({ directory, fileCount: files.length, files })),
    }));
  }

  async enqueue(username: string, files: EnqueueFile[], options?: EnqueueOptions) {
    await wait(250);
    this.addTransfers('Download', username, files, undefined, options?.batchId);
  }

  async pastResponses() {
    return [];
  }

  async measuredSpeeds() {
    // Pretend history: a few people turned out slower than they claim.
    return new Map<string, number>([['lossless_larry', 180_000], ['quietstorm', 2_600_000], ['tapehiss', 4_100_000]]);
  }

  private addTransfers(direction: 'Download' | 'Upload', username: string, files: EnqueueFile[], delayMs?: number, batchId?: string) {
    const r = rng(`${direction}:${username}`);
    const rate = direction === 'Upload' ? 120_000 + r() * 900_000 : 300_000 + r() * 4_000_000;
    const queued = direction === 'Download' ? r() > 0.7 : false;
    // Files from one user transfer one after another, as they would on the network.
    const busy = this.transfersList
      .filter((t) => t.direction === direction && t.username === username && !t.state.startsWith('Completed'))
      .map((t) => t.startsAt + ((t.size - t.bytesTransferred) / t.rate) * 1000);
    let at = Math.max(Date.now(), ...busy) + (delayMs ?? (queued ? 6000 : 600));
    for (const f of files) {
      if (this.transfersList.some((t) => t.direction === direction && t.username === username && t.filename === f.filename && !t.state.startsWith('Completed'))) continue;
      this.transfersList.push({
        id: uuid(),
        username,
        direction,
        filename: f.filename,
        size: f.size,
        state: queued ? 'Queued, Remotely' : 'Requested',
        bytesTransferred: 0,
        averageSpeed: 0,
        percentComplete: 0,
        placeInQueue: queued ? 1 + Math.floor(r() * 12) : null,
        requestedAt: new Date().toISOString(),
        batchId: batchId ?? null,
        rate,
        startsAt: at,
        refuse: direction === 'Download' ? REFUSERS[username] : undefined,
      });
      if (direction === 'Upload') this.log(`Upload of ${f.filename} to ${username} requested`);
      at += (f.size / rate) * 1000;
    }
  }

  async cancel(_direction: Direction, _username: string, id: string, remove: boolean) {
    const t = this.transfersList.find((x) => x.id === id);
    if (!t) return;
    if (remove && t.state.startsWith('Completed')) {
      this.transfersList = this.transfersList.filter((x) => x.id !== id);
    } else if (!t.state.startsWith('Completed')) {
      t.state = 'Completed, Cancelled';
      t.endedAt = new Date().toISOString();
    }
  }

  async clearCompleted(direction: Direction) {
    const want = direction === 'upload' ? 'Upload' : 'Download';
    this.transfersList = this.transfersList.filter((t) => t.direction !== want || !t.state.startsWith('Completed'));
  }

  async folderContents() {
    return null;
  }

  async browse(username: string): Promise<BrowseResult> {
    await wait(700);
    if (username === 'demo') return this.myShareTree();
    const r = rng(`browse:${username}`);
    const files = [...(this.shared.get(username) ?? [])];
    // Pad the share with a few more releases so browsing feels real.
    for (let i = 0; i < 4; i++) {
      const a = pick(r, CATALOG);
      const p = pick(r, PROFILES);
      files.push(...filesFor(r, folderFor(r, username, a, p), a, p));
    }
    return toTree(files);
  }

  async userInfo(username: string): Promise<UserInfo> {
    await wait(300);
    const r = rng(`info:${username}`);
    return {
      description: pick(r, BIOS),
      hasPicture: false,
      uploadSlots: 1 + Math.floor(r() * 8),
      queueLength: Math.floor(r() * r() * 30),
      hasFreeUploadSlot: r() > 0.35,
    };
  }

  async userStatus(username: string): Promise<UserStatus> {
    // People drift online and offline every so often, so alerts have something to report.
    const r = rng(`status:${username}:${Math.floor(Date.now() / 45_000)}`)();
    return { presence: r > 0.85 ? 'Away' : r > 0.08 ? 'Online' : 'Offline', isPrivileged: r > 0.7 };
  }

  // --- sharing and limits -------------------------------------------------

  private config: Omit<Settings, 'editable'> = {
    downloadDir: 'C:\\Users\\demo\\Music\\Soulseek Downloads',
    sharedFolders: ['C:\\Users\\demo\\Music\\FLAC', '[Vinyl rips]D:\\Rips'],
    uploadLimit: null,
    downloadLimit: null,
    uploadSlots: 10,
    blocked: [],
    leech: { mode: 'off', files: 1 },
    friendsFirst: false,
    friends: [],
    description: 'Sample profile. Lossless rips from my own CDs and records.',
    picture: '',
  };
  private scanStarted = 0;

  async settings(): Promise<Settings> {
    return { ...this.config, sharedFolders: [...this.config.sharedFolders], blocked: [...this.config.blocked], friends: [...this.config.friends], editable: true };
  }

  async saveSettings(patch: SettingsPatch) {
    await wait(300);
    const foldersChanged =
      patch.sharedFolders && patch.sharedFolders.join('|') !== this.config.sharedFolders.join('|');
    // slskd only picks up a new download folder after a restart; the demo does the same.
    if (patch.downloadDir !== undefined && patch.downloadDir !== this.config.downloadDir) this.needsRestart = true;
    this.config = { ...this.config, ...patch };
    if (foldersChanged) this.scanStarted = Date.now();
  }

  async shareStatus(): Promise<ShareStatus> {
    const elapsed = Date.now() - this.scanStarted;
    const scanning = elapsed < 4000;
    const folders = this.config.sharedFolders.filter((f) => !f.startsWith('!')).length;
    return {
      scanning,
      progress: scanning ? elapsed / 4000 : 1,
      directories: Math.round(folders * 211 * (scanning ? elapsed / 4000 : 1)),
      files: Math.round(folders * 2380 * (scanning ? elapsed / 4000 : 1)),
      faulted: false,
    };
  }

  async rescan() {
    this.scanStarted = Date.now();
  }

  async myStats() {
    return { averageSpeed: 1_850_000, uploads: 412, files: 4760, folders: 380 };
  }

  async account() {
    return { username: 'you', hasPassword: true };
  }

  async signIn() {
    await wait(1200);
    return 'ok' as const;
  }

  async linkProblem() {
    return null;
  }

  async openPort() {
    await wait(800);
    return { ok: true, ip: '192.168.1.20', port: 50300 };
  }

  async allowFirewall() {
    await wait(800);
    return { ok: true };
  }

  async checkPort(): Promise<PortCheck> {
    await wait(1200);
    return { port: 63176, open: true, ip: '203.0.113.7' };
  }

  private needsRestart = false;
  async restartNeeded() {
    return this.needsRestart;
  }
  async restart() {
    await wait(2500);
    this.needsRestart = false;
    return true;
  }

  // Stands in for the computer's folder dialog: each pick returns the next sample folder.
  private picks = ['C:\\Users\\demo\\Music\\Cassettes', 'E:\\Bootlegs', 'C:\\Users\\demo\\Music\\Live sets'];
  readonly library = demoLibrary();

  readonly folders: FolderAccess = {
    available: async () => true,
    pick: async () => {
      await wait(600);
      return this.picks.shift() ?? null;
    },
    exists: async (path) => !/missing|@@/i.test(path),
    known: async () => ({ music: 'C:\\Users\\you\\Music', musicInOneDrive: false }),
  };

  private myShareTree(): BrowseResult {
    const r = rng('myshare');
    const files: SearchFile[] = [];
    for (const a of CATALOG.slice(0, 6)) {
      const p = pick(r, PROFILES.slice(0, 4));
      files.push(...filesFor(r, `@@demo\\FLAC\\${a.artist}\\${a.year} - ${a.title}`, a, p));
    }
    return toTree(files);
  }

  // --- private chat -------------------------------------------------------

  private chats = new Map<string, ChatMessage[]>();
  private unread = new Map<string, number>();
  private msgId = 1;

  private push(username: string, direction: 'In' | 'Out', message: string) {
    const list = this.chats.get(username) ?? [];
    list.push({ id: this.msgId++, timestamp: new Date().toISOString(), username, direction, message, isAcknowledged: direction === 'Out' });
    this.chats.set(username, list);
    if (direction === 'In') this.unread.set(username, (this.unread.get(username) ?? 0) + 1);
  }

  async conversations(): Promise<Conversation[]> {
    return [...this.chats].map(([username, messages]) => ({
      username,
      isActive: true,
      unAcknowledgedMessageCount: this.unread.get(username) ?? 0,
      messages,
    }));
  }

  async messages(username: string) {
    return [...(this.chats.get(username) ?? [])];
  }

  async sendMessage(username: string, text: string) {
    await wait(150);
    this.push(username, 'Out', text);
    const r = rng(`${username}:${this.msgId}`);
    setTimeout(() => this.push(username, 'In', pick(r, REPLIES)), 1500 + r() * 2500);
  }

  async markRead(username: string) {
    this.unread.set(username, 0);
    this.chats.get(username)?.forEach((m) => (m.isAcknowledged = true));
  }

  async closeConversation(username: string) {
    this.chats.delete(username);
    this.unread.delete(username);
  }

  // --- rooms --------------------------------------------------------------

  private joined = new Map<string, Room>();

  async availableRooms(): Promise<RoomInfo[]> {
    await wait(200);
    return ROOMS.map(([name, userCount]) => ({ name, userCount }));
  }

  async joinedRooms() {
    return [...this.joined.keys()];
  }

  async room(name: string): Promise<Room> {
    const room = this.joined.get(name);
    if (!room) throw new ApiError(`Not in ${name}`, 404);
    return { ...room, messages: [...room.messages], users: [...room.users] };
  }

  async joinRoom(name: string) {
    await wait(300);
    if (this.joined.has(name)) return;
    const r = rng(`room:${name}`);
    const users: RoomUser[] = USERS.filter(() => r() > 0.35).map((u) => ({
      username: u,
      status: r() > 0.85 ? 'Away' : 'Online',
      averageSpeed: Math.floor(80_000 + r() * r() * 6_000_000),
      fileCount: Math.floor(200 + r() * 40_000),
    }));
    const others = [...users];
    users.push({ username: 'demo', status: 'Online', averageSpeed: 1_200_000, fileCount: 4760 });
    const messages: RoomMessage[] = [];
    const t0 = Date.now() - 40 * 60_000;
    for (let i = 0; i < 9; i++) {
      messages.push({ roomName: name, username: pick(r, others).username, message: CHATTER[(i + Math.floor(r() * 3)) % CHATTER.length], timestamp: new Date(t0 + i * 4 * 60_000).toISOString(), direction: 'In' });
    }
    const room: Room = { name, users, messages };
    this.joined.set(name, room);
    const talk = () => {
      if (!this.joined.has(name)) return;
      const rr = Math.random;
      room.messages.push({ roomName: name, username: others[Math.floor(rr() * others.length)].username, message: CHATTER[Math.floor(rr() * CHATTER.length)], timestamp: new Date().toISOString(), direction: 'In' });
      room.messages = room.messages.slice(-200);
      setTimeout(talk, 6000 + rr() * 9000);
    };
    setTimeout(talk, 3000);
  }

  async leaveRoom(name: string) {
    this.joined.delete(name);
  }

  async sendRoomMessage(name: string, text: string) {
    const room = this.joined.get(name);
    if (!room) throw new ApiError(`Not in ${name}`, 404);
    room.messages.push({ roomName: name, username: 'demo', message: text, timestamp: new Date().toISOString(), direction: 'Out' });
  }
}

function toTree(files: SearchFile[]): BrowseResult {
  const dirs = new Map<string, SearchFile[]>();
  for (const f of files) {
    const d = f.filename.split('\\').slice(0, -1).join('\\');
    const list = dirs.get(d) ?? [];
    if (!list.some((x) => x.filename.endsWith(f.filename.split('\\').pop()!))) list.push({ ...f, filename: f.filename.split('\\').pop()! });
    dirs.set(d, list);
  }
  return { directories: [...dirs].map(([name, fs]) => ({ name, fileCount: fs.length, files: fs })) };
}

const BIOS = [
  'Ripping my vinyl one side at a time. Lossless only, logs included. Say hi before queueing a whole discography.',
  'Mostly 90s indie and northern soul. Slots open evenings (Lisbon time).',
  'Archivist of forgotten cassettes. If you have anything from small UK labels, message me.',
  'Share back, please. Leechers get the slow lane.',
  'FLAC, cue and scans. Ask if something is missing from a folder and I will check the shelf.',
];

const REPLIES = [
  'Hey! Sure, go ahead and queue it.',
  'Thanks for sharing back. Your folder of field recordings is great.',
  "I'll bump you up the queue in a bit.",
  'That rip is from the 2009 pressing, the remaster is in a different folder.',
  'No worries. Let me know if any file fails.',
];

const CHATTER = [
  'anyone have the Low Country Lights 24/96? mine has a click on track 4',
  'just finished ripping Coin-Op, sharing now',
  'kestrel park is criminally underrated',
  'is the server slow for anyone else tonight?',
  'new Saudade Collective record next month apparently',
  'which pressing of Signal Path do people prefer?',
  'thanks for the slots, everyone',
  'good morning from Porto',
];

const ROOMS: [string, number][] = [
  ['indie', 412], ['electronic', 388], ['jazz', 251], ['flac', 230], ['vinyl rips', 197],
  ['northern soul', 88], ['fado', 41], ['ambient', 163], ['metal', 305], ['classical', 120],
  ['hip hop', 274], ['portugal', 67], ['field recordings', 29], ['soundtracks', 92],
];

/** Sample data plays 30 seconds of silence (a small WAV made once). */
let silent: string | null = null;
function silence() {
  if (silent) return silent;
  const rate = 8000, n = rate * 30;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const text = (at: number, t: string) => [...t].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, 36 + n, true); text(8, 'WAVE'); text(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); text(36, 'data'); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  silent = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return silent;
}
