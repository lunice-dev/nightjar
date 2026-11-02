import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePcShell } from '../lib/pcShell';
import { NowPanel } from '../components/NowPanel';
import type { LibAlbum } from '../api/library';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { tone } from '../components/LibraryAlbums';
import { PlaylistCover, addToPlaylist, fmtLength, playlistsChanged, usePlaylists } from '../components/Playlists';
import { useBlocked } from '../lib/blocking';
import { verdictText } from '../lib/check';
import { useSuspects } from '../lib/guard';
import { useLibraryReview } from '../lib/libraryReview';
import { toQueue, usePlayer } from '../lib/player';
import { bytes, normalise, speed } from '../lib/quality';
import { groupDownloads } from '../lib/transfers';
import { uploadStats } from '../lib/uploadStats';
import { groupCoverDir, relocatedDir, useLocalFiles } from '../lib/useLocal';
import { usePrefs } from '../prefs';
import { useStore } from '../store';
import { openSettings } from '../lib/settingsNav';

const GAP = 18;
const MIN_TILE = 158;

const tierClass = (format: string) => (format === 'Hi-Res' ? 't-hires' : format === 'FLAC' ? 't-lossless' : 't-unknown');
const shuffled = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

/**
 * The home page on the computer: what's playing, a search box with the shape of your library, rows of albums
 * (arriving, recently added, to rediscover, to look at) and the day's activity. The window's glow (see the shell)
 * takes its colour from the cover of whatever is playing.
 */
export function Home() {
  // The page's search box in the top bar steps aside while Home is open (Home has its own).
  // (Every screen stays mounted behind the one you see, so this goes by the route, not by Home being mounted.)
  const route = useStore((s) => s.route);
  const pc = usePcShell();
  useEffect(() => {
    if (route !== 'search' || !pc) return;
    const root = document.documentElement.classList;
    root.add('on-home');
    return () => root.remove('on-home');
  }, [route, pc]);

  // On a computer, what's playing is the Now panel docked at the right of the window (every screen has it); the
  // day's activity takes the left. On a phone or tablet it's the card at the top of the page.
  return (
    <div className="hx">
      <div className="hx-scroll">
        <div className="hx-page">
          {pc ? (
            <>
              <Activity />
              <Middle />
            </>
          ) : (
            <>
              <NowPanel variant="card" />
              <Middle />
              <Activity />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
// ------------------------------------------------------------------ middle

function Middle() {
  const backend = useStore((s) => s.backend);
  const go = useStore((s) => s.go);
  const search = useStore((s) => s.search);
  const { scan } = useLibraryReview();
  const checks = usePrefs((s) => s.checks);
  const history = usePrefs((s) => s.finished);
  const downloads = useStore((s) => s.downloads);
  const plans = usePrefs((s) => s.plans);
  const moves = usePrefs((s) => s.moves);
  const where = useStore((s) => s.local);
  const files = useLocalFiles();
  const [q, setQ] = useState('');
  const [again, setAgain] = useState(0);

  const albums = useMemo(() => (scan?.albums ?? []).filter((a) => a.status !== 'skip'), [scan]);
  const byDir = useMemo(() => new Map(albums.map((a) => [a.dir.toLowerCase(), a])), [albums]);

  const shape = useMemo(() => {
    const n = new Map<string, number>();
    for (const a of albums) n.set(a.format, (n.get(a.format) ?? 0) + 1);
    const order = ['Hi-Res', 'FLAC', 'MP3'];
    return [...n.entries()].sort((x, y) => (order.indexOf(x[0]) + 1 || 9) - (order.indexOf(y[0]) + 1 || 9));
  }, [albums]);
  const size = useMemo(() => albums.reduce((t, a) => t + a.size, 0), [albums]);
  // The library line from last time stays on screen until this look at the library is done, so it doesn't start empty.
  const [cached] = useState<{ n: number; size: number; shape: [string, number][] } | null>(() => {
    try {
      return JSON.parse(localStorage.getItem('nightjar-home-shape') ?? 'null');
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!albums.length) return;
    try {
      localStorage.setItem('nightjar-home-shape', JSON.stringify({ n: albums.length, size, shape }));
    } catch {
      /* fine */
    }
  }, [albums.length, size, shape]);
  const line = albums.length ? { n: albums.length, size, shape } : cached;

  // On the way: downloading or waiting.
  const coming = useMemo(
    () =>
      groupDownloads(downloads, plans)
        .filter((g) => g.phase === 'active' || g.phase === 'queued')
        .map((g) => ({
          key: g.key,
          title: g.title,
          artist: g.parent,
          dir: groupCoverDir(g, files, where.downloadDir),
          pct: g.size ? Math.round((g.transferred / g.size) * 100) : 0,
          active: g.phase === 'active',
          speed: g.speed,
        })),
    [downloads, plans, files, where.downloadDir],
  );

  // Arrived lately: the home page's history, matched with the library for its quality.
  const recent = useMemo(() => {
    const live = new Set(coming.map((c) => c.key));
    const seen = new Set<string>();
    const rows: { h: (typeof history)[number]; a: LibAlbum | undefined }[] = [];
    for (const h of history) {
      if (live.has(h.key)) continue;
      // The same album downloaded twice (or from two people) is one tile.
      const id = `${(h.artist ?? '').toLowerCase()}|${h.title.toLowerCase()}`;
      if (seen.has(id)) continue;
      seen.add(id);
      // Where it is now: albums Nightjar moved into the library (Put in library, Tidy) went along with their folder.
      const dir = h.dir ? relocatedDir(h.dir, moves) : h.dir;
      rows.push({ h: dir === h.dir ? h : { ...h, dir }, a: dir ? byDir.get(dir.toLowerCase()) : undefined });
    }
    // Newest first, as downloaded. (Not the ones the library already lists first: the library review doesn't look in the
    // downloads folder, so the newest albums aren't in it yet, and they'd drop behind older ones once it was read.)
    return rows.slice(0, 16);
  }, [history, coming, byDir, moves]);

  const rediscover = useMemo(() => shuffled(albums).slice(0, 14), [albums, again]); // eslint-disable-line react-hooks/exhaustive-deps

  const looks = useMemo(
    () =>
      albums
        .map((a) => ({ a, c: checks[a.dir.toLowerCase()] }))
        .filter((x) => x.c && x.c.severity >= 3)
        .sort((x, y) => y.c!.severity - x.c!.severity)
        .slice(0, 14),
    [albums, checks],
  );
  const looksTotal = useMemo(() => albums.filter((a) => (checks[a.dir.toLowerCase()]?.severity ?? 0) >= 3).length, [albums, checks]);

  // A cover sends the album to the player beside it; the cover there opens the large player.
  const open = (dir: string) => void usePlayer.getState().playAlbum(dir);
  // An album from the history: if its folder isn't where it was saved (moved or renamed in a way Nightjar didn't hear
  // about), find it in the library by name, play that, and remember where it is now.
  const playRecent = async (dir: string, title: string, artist?: string) => {
    const p = usePlayer.getState();
    const here = await backend?.library.tracks(dir).catch(() => null);
    if (here?.tracks.length) return void p.playAlbum(dir);
    const name = normalise(title);
    const found =
      albums.find((a) => normalise(a.album) === name && normalise(a.artist) === normalise(artist ?? '')) ??
      (name.length >= 6 ? albums.find((a) => normalise(a.album) === name) : undefined);
    if (!found) return void p.playAlbum(dir); // says by itself that it couldn't find the music
    usePrefs.getState().albumMoved(dir, found.dir);
    void p.playAlbum(found.dir);
  };
  const albumMenu = (dir: string, again?: () => void): MenuItem[] => {
    const p = usePlayer.getState();
    return [
      { label: 'Play', run: again ?? (() => void p.playAlbum(dir)) },
      { label: 'Play next', run: () => void p.addAlbum(dir, 'next') },
      { label: 'Add to queue', run: () => void p.addAlbum(dir, 'end') },
      {
        label: 'Add to playlist',
        run: async () => {
          const album = await backend?.library.tracks(dir);
          if (album?.tracks.length) addToPlaylist(album.tracks.map((t) => ({ ...t, dir: album.dir })));
        },
      },
      { label: 'Open album', run: () => p.openAlbum(dir) },
    ];
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) search(q.trim());
  };

  const playlists = usePlaylists();
  const openPlaylist = usePlayer((s) => s.openPlaylist);
  const toast = useStore((s) => s.toast);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const createPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backend || !name.trim()) return;
    const r = await backend.library.changePlaylist({ action: 'create', name: name.trim() });
    if (!r.ok || !r.playlist) return toast(r.error ?? 'Couldn’t make the playlist.', 'error');
    setNaming(false);
    setName('');
    playlistsChanged();
    toast(`Made “${r.playlist.name}”.`);
  };
  // A playlist plays in the player beside the page, skipping tracks whose files are gone.
  const playPlaylist = async (id: string, shuffle = false) => {
    const pl = await backend?.library.playlist(id).catch(() => null);
    const playable = (pl?.tracks ?? []).filter((t) => !t.missing);
    if (!playable.length) return toast('There’s nothing to play in that playlist yet.', 'error');
    const p = usePlayer.getState();
    if (shuffle) p.playShuffled(toQueue(playable));
    else p.playQueue(toQueue(playable), 0);
  };

  return (
    <main className="hx-main">
      <div className="hx-find">
        <form className="hx-search" onSubmit={submit} role="search">
          <Icon name="search" size={20} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Soulseek for an artist, album or track" aria-label="Search Soulseek" />
          <kbd aria-hidden>/</kbd>
        </form>
        {line ? (
          <div className="hx-shape">
            <p className="hx-line">
              <span>
                <b>{line.n.toLocaleString()}</b> albums
              </span>
              <span>
                <b>{bytes(line.size)}</b>
              </span>
              {line.shape.map(([f, n]) => (
                <span key={f} className={`hx-key ${tierClass(f)}`}>
                  <b>{n.toLocaleString()}</b> {f}
                </span>
              ))}
            </p>
            <button className="hx-ribbon" onClick={() => go('library')} aria-label="Open the library" title="Open the library">
              {line.shape.map(([f, n]) => (
                <i key={f} className={tierClass(f)} style={{ flexGrow: n }} />
              ))}
            </button>
          </div>
        ) : (
          <p className="hx-line">
            <span className="spinner" aria-hidden /> Reading your library…
          </p>
        )}
      </div>

      <Rail title="Arriving now" count={coming.length} link={{ label: 'Downloads', go: () => go('downloads') }} items={coming}>
        {(c) => (
          <Tile
            key={c.key}
            dir={c.dir}
            artist={c.artist}
            album={c.title}
            seed={c.key}
            name={c.title}
            sub={`${c.artist ? `${c.artist} · ` : ''}${c.active ? `${c.pct}%${c.speed ? `, ${speed(c.speed)}` : ''}` : 'Waiting for a slot'}`}
            progress={c.active ? c.pct : 0}
            tier="t-lossless"
            online
            onClick={() => go('downloads')}
          />
        )}
      </Rail>

      <Rail title="Recently added" link={{ label: 'Library', go: () => go('library') }} items={recent}>
        {({ h, a }) => (
          <Tile
            key={h.key}
            dir={h.dir}
            artist={h.artist}
            album={h.title}
            seed={h.key}
            name={h.title}
            sub={[h.artist, a?.year].filter(Boolean).join(' · ')}
            tier={a ? tierClass(a.format) : ''}
            online={!a}
            onClick={() => h.dir && void playRecent(h.dir, h.title, h.artist)}
            menu={h.dir ? albumMenu(h.dir, () => void playRecent(h.dir!, h.title, h.artist)) : undefined}
          />
        )}
      </Rail>

      <Rail title="Rediscover" link={{ label: 'Shuffle', go: () => setAgain((n) => n + 1) }} items={rediscover}>
        {(a: LibAlbum) => <Tile key={a.dir} dir={a.dir} artist={a.artist} album={a.album} seed={a.dir} name={a.album} sub={[a.artist, a.year].filter(Boolean).join(' · ')} tier={tierClass(a.format)} onClick={() => open(a.dir)} menu={albumMenu(a.dir)} />}
      </Rail>

      <Rail title="Needs a look" count={looksTotal} link={{ label: 'Open the Library', go: () => go('library') }} items={looks}>
        {({ a, c }) => (
          <Tile
            key={a.dir}
            dir={a.dir}
            artist={a.artist}
            album={a.album}
            seed={a.dir}
            name={a.album}
            sub={`${a.artist} · ${verdictText(c!.verdict)}`}
            subTone={tone(c!.severity)}
            tier={tierClass(a.format)}
            onClick={() => open(a.dir)}
            menu={albumMenu(a.dir)}
          />
        )}
      </Rail>

      {playlists !== null && (
        <section className="hx-rail">
          <h2 className="hx-h">
            Playlists {playlists.length > 0 && <span className="n">{playlists.length}</span>}
            {!naming && (
              <button className="hx-link" onClick={() => setNaming(true)}>
                New playlist
              </button>
            )}
          </h2>
          {naming && (
            <form className="hx-newrow" onSubmit={createPlaylist}>
              <input className="input" autoFocus placeholder="Name the playlist" aria-label="Playlist name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} onKeyDown={(e) => e.key === 'Escape' && setNaming(false)} />
              <button className="btn small" disabled={!name.trim()}>
                Create
              </button>
              <button type="button" className="hx-link" onClick={() => setNaming(false)}>
                Cancel
              </button>
            </form>
          )}
          {playlists.length === 0 ? (
            !naming && <p className="hx-empty">Add an album to a playlist from the “…” beside its name, or right-click a cover.</p>
          ) : (
            <Fit items={playlists}>
              {(p) => (
                <Tile
                  key={p.id}
                  album={p.name}
                  seed={p.id}
                  name={p.name}
                  sub={`${p.count} ${p.count === 1 ? 'track' : 'tracks'}${p.seconds ? ` · ${fmtLength(p.seconds)}` : ''}`}
                  tier=""
                  art={<PlaylistCover p={p} className="hx-cover" />}
                  onClick={() => void playPlaylist(p.id)}
                  menu={[
                    { label: 'Play', run: () => void playPlaylist(p.id) },
                    { label: 'Shuffle', run: () => void playPlaylist(p.id, true) },
                    { label: 'Open or edit', run: () => openPlaylist(p.id) },
                  ]}
                />
              )}
            </Fit>
          )}
        </section>
      )}
    </main>
  );
}

/** A heading with its row of covers: the row shows as many as fit across, no scrolling. */
function Rail<T>({ title, count, link, items, children }: { title: string; count?: number; link?: { label: string; go: () => void }; items: T[]; children: (item: T) => ReactNode }) {
  if (!items.length) return null;
  return (
    <section className="hx-rail">
      <h2 className="hx-h">
        {title} {count !== undefined && <span className="n">{count}</span>}
        {link && (
          <button className="hx-link" onClick={link.go}>
            {link.label}
          </button>
        )}
      </h2>
      <Fit items={items}>{children}</Fit>
    </section>
  );
}

function Fit<T>({ items, children }: { items: T[]; children: (item: T) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(6);
  // A phone: the row is a strip to swipe through, not a fixed few.
  const [strip, setStrip] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      setStrip(matchMedia('(max-width: 900px)').matches);
      setCols(Math.max(2, Math.floor((el.clientWidth + GAP) / (MIN_TILE + GAP))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={strip ? 'hx-row hx-strip' : 'hx-row'} style={strip ? undefined : { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {items.slice(0, strip ? 24 : cols).map((it) => children(it))}
    </div>
  );
}

function Tile({
  dir,
  artist,
  album,
  seed,
  name,
  sub,
  subTone,
  tier,
  progress,
  online = false,
  onClick,
  menu,
  art,
}: {
  dir?: string;
  artist?: string;
  album: string;
  seed: string;
  name: string;
  sub: string;
  subTone?: string;
  tier: string;
  progress?: number;
  online?: boolean;
  onClick: () => void;
  /** More things to do with it: a "…" beside the name, and a right-click. Nothing is ever drawn on the cover. */
  menu?: MenuItem[];
  /** Something other than an album's cover (a playlist's). */
  art?: ReactNode;
}) {
  const [at, setAt] = useState<{ x: number; y: number; end: boolean } | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!at) return;
    const away = (e: Event) => {
      if (!(e.target as Element | null)?.closest?.('.hx-menu')) setAt(null);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAt(null);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    };
  }, [at]);
  const title = `${name}${artist ? `, ${artist}` : ''}`;
  return (
    <div
      className={`hx-tile ${tier}`}
      onContextMenu={
        menu
          ? (e) => {
              e.preventDefault();
              setAt({ x: e.clientX, y: e.clientY, end: false });
            }
          : undefined
      }
    >
      <button className="hx-art-btn" onClick={onClick} title={title} aria-label={title}>
        <span className="hx-art">{art ?? <Cover className="hx-cover" dir={dir} artist={artist} album={album} seed={seed} online={online} />}</span>
        {progress !== undefined && (
          <span className="hx-prog" aria-hidden>
            <i style={{ width: `${progress}%` }} />
          </span>
        )}
      </button>
      <div className="hx-cap">
        <button className="hx-cap-main" onClick={onClick} tabIndex={-1} aria-hidden>
          <span className="hx-name">{name}</span>
          <span className={`hx-sub ${subTone ?? ''}`}>{sub}</span>
        </button>
        {menu && (
          <button
            ref={more}
            className="hx-more"
            aria-label={`More for ${name}`}
            aria-haspopup="menu"
            aria-expanded={!!at}
            onClick={() => {
              const r = more.current?.getBoundingClientRect();
              if (r) setAt(at ? null : { x: r.right, y: r.bottom + 4, end: true });
            }}
          >
            <Icon name="more" size={16} />
          </button>
        )}
      </div>
      {at &&
        menu &&
        createPortal(
          <div
            className={`ap-menu hx-menu ${at.end ? 'end' : ''}`}
            role="menu"
            style={at.y > innerHeight - 240 ? { bottom: innerHeight - at.y + (at.end ? 36 : 0), left: at.x } : { top: at.y, left: at.x }}
          >
            {menu.map((m) => (
              <button
                key={m.label}
                role="menuitem"
                onClick={() => {
                  setAt(null);
                  m.run();
                }}
              >
                {m.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

interface MenuItem {
  label: string;
  run: () => void;
}

// ------------------------------------------------------------------ right: activity

const samples: number[] = [];

function Activity() {
  const go = useStore((s) => s.go);
  const downloads = useStore((s) => s.downloads);
  const uploads = useStore((s) => s.uploads);
  const conversations = useStore((s) => s.conversations);
  const link = useStore((s) => s.link);
  const demo = useStore((s) => s.backend?.kind === 'demo');
  const plans = usePrefs((s) => s.plans);
  const sent = usePrefs((s) => s.sent);
  const wishlist = usePrefs((s) => s.wishlist);

  const groups = useMemo(() => groupDownloads(downloads, plans), [downloads, plans]);
  const active = groups.filter((g) => g.phase === 'active');
  const waiting = groups.filter((g) => g.phase === 'queued').length;
  const now = active.reduce((n, g) => n + g.speed, 0);
  const share = useMemo(() => uploadStats(uploads, sent), [uploads, sent]);
  const unread = conversations.reduce((n, c) => n + (c.unAcknowledgedMessageCount || 0), 0);
  const news = wishlist.reduce((n, w) => n + (w.unseen || 0), 0);
  // People using your share faster than a person can, who aren't blocked yet.
  const suspects = useSuspects();
  const { list: blockedList } = useBlocked();
  const programs = suspects.filter((s) => !blockedList?.includes(s.user));

  // The last few minutes of incoming speed, drawn as a line.
  const latest = useRef(now);
  latest.current = now;
  const [, redraw] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      samples.push(latest.current);
      if (samples.length > 60) samples.shift();
      redraw((n) => n + 1);
    }, 5000);
    return () => clearInterval(id);
  }, []);
  const spark = useMemo(() => {
    if (samples.length < 6 || !samples.some((s) => s > 0)) return null;
    const max = Math.max(...samples, 1);
    const pts = samples.map((v, i) => `${((i / (samples.length - 1)) * 200).toFixed(1)} ${(40 - (v / max) * 36).toFixed(1)}`);
    return `M${pts.join(' L')}`;
  }, [samples.length, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const connection = demo ? 'Sample data' : link.state === 'online' ? 'Online' : link.state === 'connecting' ? 'Signing in' : 'Offline';

  return (
    <aside className="hx-act" aria-label="Activity">
      <div className="hx-stat">
        <h2 className="hx-h small">Coming in</h2>
        <p className="hx-big">{now > 0 ? speed(now) : 'Quiet'}</p>
        <p className="hx-statsub">
          {active.length + waiting === 0 ? 'Nothing downloading' : `${active.length} downloading${waiting ? `, ${waiting} waiting` : ''}`}
        </p>
        {spark && (
          <svg className="hx-spark" viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden>
            <path d={`${spark} V44 H0Z`} fill="currentColor" opacity=".08" />
            <path d={spark} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
      <div className="hx-stat">
        <h2 className="hx-h small">Going out</h2>
        <p className="hx-big">{share.now.people > 0 ? speed(share.now.speed) : 'Idle'}</p>
        <p className="hx-statsub">
          {share.now.people > 0 ? `To ${share.now.people} ${share.now.people === 1 ? 'person' : 'people'} · ` : ''}
          {bytes(share.week.bytes)} sent this week
        </p>
      </div>
      {(unread > 0 || news > 0 || programs.length > 0) && (
        <div>
          <h2 className="hx-h small">For you</h2>
          <ul className="hx-list">
            {programs.length > 0 && (
              <li>
                <button onClick={() => go('uploads')}>
                  <b>
                    {programs.length === 1 ? `${programs[0].user} looks like a program` : `${programs.length} people look like programs`}
                  </b>
                  <span>{programs.length === 1 ? programs[0].summary : 'They use your share faster than a person can'}</span>
                </button>
              </li>
            )}
            {news > 0 && (
              <li>
                <button onClick={() => go('wishlist')}>
                  <b>
                    {news} new {news === 1 ? 'copy' : 'copies'} on your wishlist
                  </b>
                  <span>Something you were waiting for showed up</span>
                </button>
              </li>
            )}
            {unread > 0 && (
              <li>
                <button onClick={() => go('messages')}>
                  <b>
                    {unread} unread {unread === 1 ? 'message' : 'messages'}
                  </b>
                  <span>Private messages</span>
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
      <div>
        <h2 className="hx-h small">Connection</h2>
        <ul className="hx-list">
          <li>
            <button onClick={() => openSettings('connection')}>
              <b>
                <i className={`hx-dot ${link.state === 'online' || demo ? 'ok' : link.state === 'connecting' ? 'wait' : 'bad'}`} aria-hidden />
                {connection}
              </b>
              <span>{link.state === 'online' ? 'Soulseek is connected' : link.state === 'connecting' ? 'Connecting to Soulseek' : 'Not connected to Soulseek'}</span>
            </button>
          </li>
        </ul>
      </div>
    </aside>
  );
}
