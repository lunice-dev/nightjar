import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LibAlbum } from '../api/library';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { tone } from '../components/LibraryAlbums';
import { PlaylistCover, fmtLength, playlistsChanged, usePlaylists } from '../components/Playlists';
import { useBlocked } from '../lib/blocking';
import { verdictText } from '../lib/check';
import { useSuspects } from '../lib/guard';
import { useLibraryReview } from '../lib/libraryReview';
import { audioCtl, fmtTime, sourceQuality, trackTier, usePlayer } from '../lib/player';
import { bytes, speed } from '../lib/quality';
import { groupDownloads } from '../lib/transfers';
import { uploadStats } from '../lib/uploadStats';
import { groupCoverDir, useLocalFiles } from '../lib/useLocal';
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
  // The Now column has the controls, so the player bar at the bottom steps aside while Home is open.
  useEffect(() => {
    document.documentElement.classList.add('on-home');
    return () => document.documentElement.classList.remove('on-home');
  }, []);

  return (
    <div className="hx">
      <div className="hx-scroll">
        <div className="hx-page">
          <Now />
          <Middle />
          <Activity />
        </div>
      </div>
    </div>
  );
}
// ------------------------------------------------------------------ left: now playing

function useProgress(fallback: number) {
  const [p, setP] = useState({ t: 0, d: 0 });
  useEffect(() => {
    const tick = () => {
      const el = audioCtl.el;
      if (!el) return;
      const t = Math.floor(el.currentTime || 0);
      const d = Math.floor(Number.isFinite(el.duration) ? el.duration : 0);
      setP((o) => (o.t === t && o.d === d ? o : { t, d }));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, []);
  return { t: p.t, d: p.d || Math.round(fallback) };
}

function Now() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const t = queue[index];
  const { t: pos, d } = useProgress(t?.seconds ?? 0);
  const repeat = usePlayer((s) => s.repeat);
  // While the position handle is being dragged it shows where it is; the music jumps when it's let go.
  const [drag, setDrag] = useState<number | null>(null);
  const seekTo = () => {
    if (drag !== null && audioCtl.el) audioCtl.el.currentTime = drag;
    setDrag(null);
  };
  if (!t) {
    return (
      <aside className="hx-now idle" aria-label="Now playing">
        <div className="hx-now-art empty">
          <span>Nothing playing</span>
        </div>
        <div className="hx-now-text">
          <h1 className="hx-now-title">Pick an album</h1>
          <p className="hx-now-by">It plays here, and the page takes its colours from the cover.</p>
        </div>
      </aside>
    );
  }
  const q = sourceQuality(t);
  const next = queue.slice(index + 1, index + 4);
  return (
    <aside className="hx-now" aria-label="Now playing">
      <button className="hx-now-art" onClick={() => usePlayer.getState().setExpanded(true)} aria-label="Open the player">
        <Cover className="hx-now-cover" dir={t.dir} artist={t.artist ?? undefined} album={t.album ?? undefined} seed={t.dir} />
      </button>
      <div className="hx-now-text">
        <h1 className="hx-now-title" title={t.title}>
          {t.title}
        </h1>
        <p className="hx-now-by">{[t.artist, t.album].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="hx-now-meta">
        <span className={`hx-q t-${trackTier(t)}`}>{q.short}</span>
        <span className="dim">
          Track {index + 1} of {queue.length}
        </span>
        {!playing && <span className="dim">Paused</span>}
        <button className="hx-stop" onClick={() => usePlayer.getState().stop()} title="Stop and clear the queue">
          Stop
        </button>
      </div>
      <div className="hx-seekbox">
        <input
          className="hx-seek"
          type="range"
          min={0}
          max={d || 0}
          step={1}
          value={Math.min(drag ?? pos, d || 0)}
          aria-label="Position"
          style={{ ['--p' as string]: `${d ? Math.min(100, ((drag ?? pos) / d) * 100) : 0}%` }}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={seekTo}
          onKeyUp={seekTo}
          onBlur={seekTo}
        />
        <div className="hx-times">
          <span>{fmtTime(drag ?? pos)}</span>
          <span>{d ? fmtTime(d) : ''}</span>
        </div>
      </div>
      <div className="hx-ctl">
        <button onClick={() => usePlayer.getState().prev()} aria-label="Previous track" title="Previous track">
          <Icon name="prev" size={20} />
        </button>
        <button className="go" onClick={() => usePlayer.getState().toggle()} aria-label={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} size={22} />
        </button>
        <button onClick={() => usePlayer.getState().next()} disabled={index + 1 >= queue.length && repeat !== 'all'} aria-label="Next track" title="Next track">
          <Icon name="next" size={20} />
        </button>
      </div>
      {next.length > 0 && (
        <div className="hx-nextbox">
          <h2 className="hx-h small">Up next</h2>
          <ul className="hx-next">
            {next.map((n, i) => (
              <li key={n.qid}>
                <button onClick={() => usePlayer.getState().jump(index + 1 + i)} title="Play this one now">
                  <span>{n.no || ''}</span>
                  <b>{n.title}</b>
                  <span>{n.seconds ? fmtTime(n.seconds) : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
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
      rows.push({ h, a: h.dir ? byDir.get(h.dir.toLowerCase()) : undefined });
    }
    // Albums that are in the library come first: the others may have been moved or deleted since.
    return [...rows.filter((r) => r.a), ...rows.filter((r) => !r.a)].slice(0, 16);
  }, [history, coming, byDir]);

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

  const open = (dir: string) => void usePlayer.getState().openOrPlayAlbum(dir);
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
    openPlaylist(r.playlist.id);
  };

  return (
    <main className="hx-main">
      <div className="hx-find">
        <form className="hx-search" onSubmit={submit} role="search">
          <Icon name="search" size={20} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Soulseek for an artist, album or track" aria-label="Search Soulseek" />
          <kbd aria-hidden>/</kbd>
        </form>
        {albums.length > 0 ? (
          <div className="hx-shape">
            <p className="hx-line">
              <span>
                <b>{albums.length.toLocaleString()}</b> albums
              </span>
              <span>
                <b>{bytes(size)}</b>
              </span>
              {shape.map(([f, n]) => (
                <span key={f} className={`hx-key ${tierClass(f)}`}>
                  <b>{n.toLocaleString()}</b> {f}
                </span>
              ))}
            </p>
            <button className="hx-ribbon" onClick={() => go('library')} aria-label="Open the library" title="Open the library">
              {shape.map(([f, n]) => (
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
            onClick={() => h.dir && open(h.dir)}
          />
        )}
      </Rail>

      <Rail title="Rediscover" link={{ label: 'Shuffle', go: () => setAgain((n) => n + 1) }} items={rediscover}>
        {(a: LibAlbum) => <Tile key={a.dir} dir={a.dir} artist={a.artist} album={a.album} seed={a.dir} name={a.album} sub={[a.artist, a.year].filter(Boolean).join(' · ')} tier={tierClass(a.format)} onClick={() => open(a.dir)} />}
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
          />
        )}
      </Rail>

      {playlists !== null && (
        <section className="hx-rail">
          <h2 className="hx-h">
            Playlists {playlists.length > 0 && <span className="n">{playlists.length}</span>}
            {naming ? (
              <form className="hx-new" onSubmit={createPlaylist}>
                <input className="input" autoFocus placeholder="Name" aria-label="Playlist name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} onKeyDown={(e) => e.key === 'Escape' && setNaming(false)} />
                <button className="btn small" disabled={!name.trim()}>
                  Create
                </button>
              </form>
            ) : (
              <button className="hx-link" onClick={() => setNaming(true)}>
                New playlist
              </button>
            )}
          </h2>
          {playlists.length === 0 ? (
            <p className="hint-text">Open an album and use … → Add to playlist on any track or on the whole album.</p>
          ) : (
            <Fit items={playlists}>
              {(p) => (
                <button key={p.id} className="hx-tile" onClick={() => openPlaylist(p.id)}>
                  <span className="hx-art">
                    <PlaylistCover p={p} className="hx-cover" />
                  </span>
                  <span className="hx-name">{p.name}</span>
                  <span className="hx-sub">
                    {p.count} {p.count === 1 ? 'track' : 'tracks'}
                    {p.seconds ? ` · ${fmtLength(p.seconds)}` : ''}
                  </span>
                </button>
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
}) {
  return (
    <button className={`hx-tile ${tier}`} onClick={onClick} title={`${name}${artist ? `, ${artist}` : ''}`}>
      <span className="hx-art">
        <Cover className="hx-cover" dir={dir} artist={artist} album={album} seed={seed} online={online} />
      </span>
      {progress !== undefined && (
        <span className="hx-prog" aria-hidden>
          <i style={{ width: `${progress}%` }} />
        </span>
      )}
      <span className="hx-name">{name}</span>
      <span className={`hx-sub ${subTone ?? ''}`}>{sub}</span>
    </button>
  );
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
