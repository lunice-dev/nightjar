/**
 * The music library and the checks on downloaded files, both done by the Nightjar app on this computer
 * (through its helper). On a phone, or without the app, none of this is available.
 */

export interface LibraryInfo {
  root: string | null;
  formats: string[];
  exists: boolean;
}

export interface WaitingAlbum {
  dir: string;
  name: string;
  tracks: number;
  size: number;
  at: number;
}

export interface RecentMove {
  id: string;
  from: string;
  to: string;
  at: number;
}

export interface OrganizePlan {
  dir: string;
  root: string | null;
  tracks: number;
  artist: string;
  artistFromTags: string;
  artistExists: boolean;
  /** Format folders where that artist's folder already is. */
  artistFormats: string[];
  artistGuessed: boolean;
  /** The artist's folder is inside this group folder ("JP City Pop"). */
  group?: string | null;
  similar: string[];
  album: string;
  year: string | null;
  format: string;
  formats: string[];
}

export interface MoveResult {
  ok: boolean;
  to?: string;
  id?: string;
  error?: string;
  duplicate?: boolean;
  newArtist?: boolean;
}

export interface TrackCheck {
  file: string;
  name: string;
  verdict: string;
  note: string;
  rate: number;
  bits: number;
  cutoff: number;
  sharp: boolean;
  kbps: number;
  encoder?: string | null;
  severity: number;
}

export interface AlbumCheck {
  verdict: string;
  note: string;
  severity: number;
  tracks: number;
  flagged: number;
}

export interface CheckProgress {
  done: number;
  total: number;
  finished: boolean;
  error?: string | null;
  album?: AlbumCheck | null;
  tracks: TrackCheck[];
}

/** One album found when looking through the whole library. */
export interface LibAlbum {
  dir: string;
  /** Path inside the library: "FLAC\\Deftones\\2000 - White Pony". */
  rel: string;
  /** album; discs (CD1, CD2… in one folder); box (several albums kept together). */
  kind: 'album' | 'discs' | 'box';
  tracks: number;
  size: number;
  bits: number;
  rate: number;
  currentFormat: string | null;
  format: string;
  artist: string;
  artistFromTags: string;
  /** A folder grouping artists that the person made ("JP City Pop"): kept. */
  group: string | null;
  album: string;
  year: string | null;
  folder: string;
  target: string | null;
  compilation: boolean;
  artistGuessed: boolean;
  /** ok: already in place; move: would be tidied; needsYear: the files don't say; skip: sort by hand. */
  status: 'ok' | 'move' | 'needsYear' | 'skip';
  reasons: string[];
  /** Shared by copies of the same album. */
  dupKey: string | null;
  note: string | null;
}

export interface LibScan {
  id: string;
  root: string | null;
  done: number;
  total: number;
  finished: boolean;
  error?: string | null;
  at: number;
  albums: LibAlbum[] | null;
}

export interface LibMove {
  dir: string;
  format: string;
  artist: string;
  folder: string;
  group?: string | null;
}

export interface LibApply {
  id: string;
  batch: string;
  done: number;
  total: number;
  finished: boolean;
  error?: string | null;
  results: { dir: string; ok: boolean; to?: string; error?: string; unchanged?: boolean }[];
}

export interface LibBatch {
  batch: string;
  at: number;
  count: number;
}

export interface LibraryAccess {
  info(): Promise<LibraryInfo | null>;
  setRoot(root: string): Promise<{ ok: boolean; error?: string }>;
  waiting(): Promise<{ albums: WaitingAlbum[]; recent: RecentMove[] } | null>;
  plan(dir: string): Promise<OrganizePlan | { error: string }>;
  move(dir: string, format: string, artist: string, folder: string, group?: string | null): Promise<MoveResult>;
  undo(id: string): Promise<MoveResult>;
  check(dir: string): Promise<{ id?: string; error?: string }>;
  progress(id: string): Promise<CheckProgress | null>;
  /** Looks through the whole library; "last" returns the latest finished look, if any. */
  scan(): Promise<{ id?: string; error?: string }>;
  scanProgress(id: string): Promise<LibScan | null>;
  apply(moves: LibMove[]): Promise<{ id?: string; batch?: string; error?: string }>;
  applyProgress(id: string): Promise<LibApply | null>;
  undoBatch(batch: string): Promise<{ ok: boolean; undone?: number; error?: string; failed?: { to: string; error: string }[]; moved?: { from: string; to: string }[] }>;
  batches(): Promise<LibBatch[] | null>;
  recycle(dir: string): Promise<{ ok: boolean; error?: string }>;
  /** An album's tracks in play order (disc folders included), or null when it can't be read. */
  tracks(dir: string): Promise<AlbumTracks | null>;
}

export interface Track {
  path: string;
  title: string;
  artist: string | null;
  album: string | null;
  no: number;
  disc: number;
  seconds: number;
  format: string;
  bits: number;
  rate: number;
  kbps: number;
  size: number;
}

export interface AlbumTracks {
  dir: string;
  tracks: Track[];
}

/** Talks to the Nightjar app's helper. */
export function helperLibrary(helper: string): LibraryAccess {
  const get = async <T,>(path: string, ms = 15_000): Promise<T | null> => {
    try {
      const res = await fetch(`${helper}${path}`, { signal: AbortSignal.timeout(ms) });
      return res.ok || res.status === 404 ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const post = async <T,>(path: string, body: unknown, ms = 600_000): Promise<T> => {
    try {
      const res = await fetch(`${helper}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ms),
      });
      return (await res.json()) as T;
    } catch (e) {
      return { ok: false, error: `The Nightjar app didn’t answer (${(e as Error).message}).` } as T;
    }
  };
  const enc = encodeURIComponent;
  return {
    info: () => get<LibraryInfo>('/library', 4000),
    setRoot: (root) => post('/library', { root }, 10_000),
    waiting: () => get('/organize/waiting', 30_000),
    plan: async (dir) => (await get<OrganizePlan | { error: string }>(`/organize/plan?dir=${enc(dir)}`, 60_000)) ?? { error: 'The Nightjar app didn’t answer.' },
    move: (dir, format, artist, folder, group) => post('/organize/move', { dir, format, artist, folder, group: group ?? null }),
    undo: (id) => post('/organize/undo', { id }),
    check: (dir) => post('/validate', { dir }, 15_000),
    progress: (id) => get<CheckProgress>(`/validate?id=${enc(id)}`, 10_000),
    scan: () => post('/library/scan', {}, 10_000),
    scanProgress: (id) => get<LibScan>(`/library/scan?id=${enc(id)}`, 20_000),
    apply: (moves) => post('/library/apply', { moves }, 20_000),
    applyProgress: (id) => get<LibApply>(`/library/apply?id=${enc(id)}`, 10_000),
    undoBatch: (batch) => post('/library/undo', { batch }),
    batches: () => get<LibBatch[]>('/library/batches', 10_000),
    recycle: (dir) => post('/library/recycle', { dir }, 120_000),
    tracks: async (dir) => {
      const r = await get<AlbumTracks | { error: string }>(`/tracks?dir=${enc(dir)}`, 60_000);
      return r && 'tracks' in r ? r : null;
    },
  };
}

/** A pretend library for sample data, with the usual mess: rip labels, hi-res in FLAC, disc folders, copies. */
function demoAlbums(root: string): LibAlbum[] {
  const B = '\\';
  const mk = (rel: string, o: Partial<LibAlbum>): LibAlbum => {
    const a: LibAlbum = {
      dir: root + B + rel,
      rel,
      kind: 'album',
      tracks: 10,
      size: 420_000_000,
      bits: 16,
      rate: 44100,
      currentFormat: rel.split(B)[0],
      format: 'FLAC',
      artist: '',
      artistFromTags: '',
      album: '',
      year: null,
      folder: '',
      target: null,
      compilation: false,
      artistGuessed: false,
      group: null,
      status: 'ok',
      reasons: [],
      dupKey: null,
      note: null,
      ...o,
    };
    a.artistFromTags ||= a.artist;
    a.folder = a.year ? `${a.year} - ${a.album}` : a.album;
    a.target = a.status === 'skip' ? null : [root, a.format, a.artist, a.folder].join(B);
    if (a.status !== 'skip' && a.status !== 'needsYear') a.status = a.target === a.dir ? 'ok' : 'move';
    return a;
  };
  return [
    mk('FLAC\\Halvard Moss\\2019 - Low Country Lights', { artist: 'Halvard Moss', album: 'Low Country Lights', year: '2019' }),
    mk('FLAC\\Halvard Moss\\Halvard Moss - Tidewater (2021) [FLAC]', { artist: 'Halvard Moss', album: 'Tidewater', year: '2021', reasons: ['Renamed: Halvard Moss - Tidewater (2021) [FLAC] → 2021 - Tidewater'] }),
    mk('FLAC\\Halvard Moss\\Halvard Moss - Northern Rooms [24-96]', { artist: 'Halvard Moss', album: 'Northern Rooms', year: '2023', format: 'Hi-Res', bits: 24, rate: 96000, size: 1_400_000_000, reasons: ['FLAC → Hi-Res', 'Renamed: Halvard Moss - Northern Rooms [24-96] → 2023 - Northern Rooms'] }),
    mk('FLAC\\The Paper Lanterns\\1998 - Signal Fires', { artist: 'The Paper Lanterns', album: 'Signal Fires', year: '1998', dupKey: 'paperlanterns|signalfires' }),
    mk('FLAC\\The Paper Lanterns\\Signal Fires (Remaster) [WEB 24-44]', { artist: 'The Paper Lanterns', album: 'Signal Fires', year: '1998', format: 'Hi-Res', bits: 24, size: 760_000_000, dupKey: 'paperlanterns|signalfires', reasons: ['FLAC → Hi-Res', 'Renamed: Signal Fires (Remaster) [WEB 24-44] → 1998 - Signal Fires'] }),
    mk('FLAC\\The Paper Lanterns\\1996 - Small Hours', { artist: 'The Paper Lanterns', album: 'Small Hours', year: '1996' }),
    mk('FLAC\\City Pop\\Mirei Asano\\Mirei Asano - Harbour Lights', { artist: 'Mirei Asano', album: 'Harbour Lights', year: '1984', reasons: ['Out of a group folder (City Pop\\Mirei Asano)', 'Renamed: Mirei Asano - Harbour Lights → 1984 - Harbour Lights'] }),
    mk('FLAC\\City Pop\\Mirei Asano\\Mirei Asano - Night Drive', { artist: 'Mirei Asano', album: 'Night Drive', year: '1986', reasons: ['Out of a group folder (City Pop\\Mirei Asano)', 'Renamed: Mirei Asano - Night Drive → 1986 - Night Drive'] }),
    mk('FLAC\\VA\\Various Artists - Coastline OST', { artist: 'Various Artists', album: 'Coastline (Original Soundtrack)', year: '2014', compilation: true, tracks: 16, reasons: ['Artist folder: VA → Various Artists', 'Renamed: Various Artists - Coastline OST → 2014 - Coastline (Original Soundtrack)'] }),
    mk('FLAC\\Juno Vale\\Juno Vale - Glasshouse (1995) [2CD]', { kind: 'discs', artist: 'Juno Vale', album: 'Glasshouse', year: '1995', tracks: 28, size: 1_100_000_000, reasons: ['Renamed: Juno Vale - Glasshouse (1995) [2CD] → 1995 - Glasshouse'] }),
    mk('FLAC\\Juno Vale\\Gold', { artist: 'Juno Vale', album: 'Gold', status: 'needsYear' }),
    mk('FLAC\\Ostrava Nights\\2013 - Live 2010-11', { kind: 'box', artist: 'Ostrava Nights', album: 'Live 2010-11', year: '2013', tracks: 41 }),
    mk('FLAC\\Ostrava Nights\\Ostrava Nights - Weather Report', { artist: 'Ostrava Nights', album: 'Weather Report', year: '2008', format: 'MP3', bits: 0, size: 98_000_000, reasons: ['FLAC → MP3', 'Renamed: Ostrava Nights - Weather Report → 2008 - Weather Report'] }),
    mk('FLAC\\Ostrava Nights', { status: 'skip', tracks: 2, note: 'This folder has tracks of its own next to other album folders: sort it by hand.' }),
    mk('Hi-Res\\Halvard Moss\\2025 - Quiet Engines', { artist: 'Halvard Moss', album: 'Quiet Engines', year: '2025', format: 'Hi-Res', bits: 24, rate: 96000, size: 1_900_000_000 }),
  ];
}

/** For sample data: a pretend library. */
export function demoLibrary(): LibraryAccess {
  let root: string | null = 'C:\\Users\\you\\Music\\Library';
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let albums: LibAlbum[] | null = null;
  let applied: LibApply | null = null;
  const batches: { batch: string; at: number; moves: { from: string; to: string }[] }[] = [];
  let scanAt = 0;
  const lib = () => (albums ??= demoAlbums(root ?? 'C:\\Users\\you\\Music\\Library'));
  return {
    info: async () => ({ root, formats: ['FLAC', 'Hi-Res', 'MP3', 'Other'], exists: !!root }),
    setRoot: async (r) => {
      root = r;
      return { ok: true };
    },
    waiting: async () => ({
      albums: [{ dir: 'C:\\Users\\you\\Music\\Nightjar\\Halvard Moss - Low Country Lights [FLAC]', name: 'Halvard Moss - Low Country Lights [FLAC]', tracks: 9, size: 806_000_000, at: Date.now() }],
      recent: [],
    }),
    plan: async (dir) => ({
      dir,
      root,
      tracks: 9,
      artist: 'Halvard Moss',
      artistFromTags: 'Halvard Moss',
      artistExists: false,
      artistFormats: [],
      artistGuessed: false,
      similar: [],
      album: dir.split('\\').pop() ?? 'Album',
      year: null,
      format: 'FLAC',
      formats: ['FLAC', 'Hi-Res', 'MP3', 'Other'],
    }),
    move: async (_dir, format, artist, folder) => {
      await wait(500);
      return { ok: true, to: `${root ?? 'C:\\Music'}\\${format}\\${artist}\\${folder}`, id: 'demo', newArtist: true };
    },
    undo: async () => ({ ok: true }),
    scan: async () => {
      scanAt = Date.now();
      return { id: 'scan' };
    },
    scanProgress: async (id) => {
      if (id === 'last' && !scanAt) return null;
      await wait(300);
      const t = Math.min(1, (Date.now() - scanAt) / 1500);
      const list = lib();
      return { id: 'scan', root: root ?? 'C:\\Users\\you\\Music\\Library', done: Math.round(t * list.length), total: list.length, finished: t >= 1, at: scanAt, albums: t >= 1 ? list : null };
    },
    apply: async (moves) => {
      const batch = `b${Date.now()}`;
      const done: { from: string; to: string }[] = [];
      const results = moves.map((m) => {
        const a = lib().find((x) => x.dir === m.dir);
        if (!a) return { dir: m.dir, ok: false, error: 'That album isn’t in your library folder any more.' };
        const r = root ?? 'C:\\Users\\you\\Music\\Library';
        const to = [r, m.format, m.artist, m.folder].join('\\');
        done.push({ from: a.dir, to });
        Object.assign(a, { dir: to, rel: to.slice(r.length + 1), currentFormat: m.format, format: m.format, artist: m.artist, folder: m.folder, target: to, status: 'ok', reasons: [] });
        return { dir: m.dir, ok: true, to };
      });
      batches.unshift({ batch, at: Date.now(), moves: done });
      applied = { id: 'apply', batch, done: moves.length, total: moves.length, finished: true, results };
      return { id: 'apply', batch };
    },
    applyProgress: async () => {
      await wait(700);
      return applied;
    },
    undoBatch: async (batch) => {
      const b = batches.find((x) => x.batch === batch);
      if (!b) return { ok: false, error: 'Nothing to undo.' };
      batches.splice(batches.indexOf(b), 1);
      albums = null; // back to how it was
      return { ok: true, undone: b.moves.length, moved: b.moves.map((m) => ({ from: m.to, to: m.from })) };
    },
    batches: async () => batches.map((b) => ({ batch: b.batch, at: b.at, count: b.moves.length })),
    recycle: async (dir) => {
      albums = lib().filter((a) => a.dir !== dir);
      for (const a of albums) if (a.dupKey && albums.filter((x) => x.dupKey === a.dupKey).length < 2) a.dupKey = null;
      return { ok: true };
    },
    tracks: async (dir) => {
      // Sample data: a made-up album, so the player can be tried (it plays silence).
      const name = dir.split(/[\\/]/).pop() ?? 'Sample album';
      const titles = ['Harbour Lights', 'Slow Tide', 'The Long Road In', 'Paper Moons', 'Northern Rooms', 'Low Country', 'Ember', 'Glass Houses'];
      return {
        dir,
        tracks: titles.map((title, i) => ({ path: `${dir}\\${String(i + 1).padStart(2, '0')} ${title}.flac`, title, artist: 'Halvard Moss', album: name.replace(/^\d{4} - /, ''), no: i + 1, disc: 0, seconds: 30, format: 'flac', bits: 16, rate: 44100, kbps: 900, size: 30_000_000 })),
      };
    },
    check: async () => ({ id: 'demo' }),
    progress: async () => {
      await wait(900);
      return {
        done: 9,
        total: 9,
        finished: true,
        album: { verdict: 'Lossy source', note: '9 of 9 tracks look wrong: 7 lossy source, 2 suspicious.', severity: 8, tracks: 9, flagged: 9 },
        tracks: [
          { file: '', name: '01 Low Country Lights.flac', verdict: 'Lossy source', note: 'A sharp cut at 16.8 kHz: converted from a 128 kbps MP3/AAC. Not true lossless.', rate: 44100, bits: 16, cutoff: 16800, sharp: true, kbps: 820, severity: 8 },
          { file: '', name: '02 Tidewater.flac', verdict: 'Suspicious', note: 'A sharp cut at 20.2 kHz, typical of a 320 kbps MP3/AAC source.', rate: 44100, bits: 16, cutoff: 20200, sharp: true, kbps: 870, severity: 6 },
        ],
      };
    },
  };
}
