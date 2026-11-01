import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { audioCtl, canSetVolume, fmtTime, trackTier, usePlayer, type QueueItem } from '../lib/player';
import { generatedCover } from '../lib/covers';
import { Icon } from './Icon';
import { WindowControls } from './WindowControls';
import { inApp } from '../lib/host';
import { AlbumView, Bars, PlaylistView } from './DrawerViews';
import { useScrub } from '../lib/scrub';
import { useLyrics } from '../lib/lyrics';
import { shareStoryCard } from '../lib/storyCard';
import { softBackdrop, softBackdropNow } from '../lib/softBackdrop';
import { useStore } from '../store';
import { LyricsScroll, LyricsView } from './LyricsView';
import { LONG_TRACK, seekBy, useDoubleTapSeek, useHoldToScan } from '../lib/seek';

/** Where the small player's cover was when the large player was opened: the big art grows out of it. */
export const morph: { rect: DOMRect | null } = { rect: null };

/**
 * The large player, over the whole app: big album art, the time bar, the buttons and what plays
 * next. Upright (phones, an iPad held upright) the art sits on top; on wide screens (the PC, an
 * iPad held sideways) the art is on the left and the rest on the right. The background takes its
 * colour from the album art.
 */
export function FullPlayer({
  cover,
  time,
  duration,
  waiting,
  quality,
  chip,
}: {
  cover: string | null;
  time: number;
  duration: number;
  waiting: boolean;
  /** The file → what's sent → device chain. */
  quality: React.ReactNode;
  /** The short tag: "FLAC 16/44.1", "AAC 128". */
  chip: React.ReactNode;
}) {
  const { queue, index, playing, shuffle, repeat, dataSaver, converted, view, volume, sleep } = usePlayer();
  const p = usePlayer.getState();
  // Swipe up anywhere on the player (except the seek bar and the volume, which are dragged sideways): the queue rises as the
  // finger moves, and is fully up once the finger has travelled most of the way from where it started to the top of the panel.
  // It opens when let go past about a quarter of the way, or after a quick flick; otherwise it slides back down.
  const [qPeek, setQPeek] = useState(0);
  const peekNow = useRef(0); // the same number, readable the instant the finger lifts
  const pull = useRef<{ x: number; y: number; t: number; reach: number } | null>(null);
  const setPeek = (v: number) => {
    peekNow.current = v;
    setQPeek(v);
  };
  const queueSwipe = {
    onTouchStart: (e: React.TouchEvent) => {
      peekNow.current = 0;
      if ((e.target as Element).closest('.fp-seek-wrap, .fp-volume, .fp-queue, .fp-details, .fp-sheet')) {
        pull.current = null;
        return;
      }
      const p = e.touches[0];
      pull.current = { x: p.clientX, y: p.clientY, t: Date.now(), reach: Math.min(520, Math.max(220, p.clientY - 70)) };
    },
    onTouchMove: (e: React.TouchEvent) => {
      const s = pull.current;
      if (!s || !queueIsPanel()) return;
      const p = e.touches[0];
      const dy = s.y - p.clientY;
      if (dy > 8 && Math.abs(p.clientX - s.x) < dy * 0.8) setPeek(Math.min(1, dy / s.reach) * (queueRef.current?.offsetHeight ?? 600));
      else if (dy <= 0 && peekNow.current) setPeek(0);
    },
    onTouchEnd: () => {
      const s = pull.current;
      pull.current = null;
      const peek = peekNow.current;
      setPeek(0);
      if (!s || !peek || !queueIsPanel()) return;
      const progress = peek / (queueRef.current?.offsetHeight ?? 600);
      const dy = progress * s.reach;
      const flick = dy > 35 && dy / Math.max(1, Date.now() - s.t) > 0.25;
      if (progress > 0.28 || flick) setPanel('queue');
    },
  };
  // Dragging the queue's header down pulls the whole panel with the finger; letting go past a short distance closes it.
  const [qDrag, setQDrag] = useState(0);
  const qStart = useRef<number | null>(null);
  const qTime = useRef(0);
  const qHead = {
    onTouchStart: (e: React.TouchEvent) => {
      qStart.current = e.touches[0].clientY;
      qTime.current = Date.now();
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (qStart.current != null) setQDrag(Math.max(0, e.touches[0].clientY - qStart.current));
    },
    onTouchEnd: () => {
      const far = qDrag > 90 || (qDrag > 32 && qDrag / Math.max(1, Date.now() - qTime.current) > 0.3);
      qStart.current = null;
      setQDrag(0);
      if (far) setPanel('none');
    },
  };
  const [sleepMenu, setSleepMenu] = useState(false);
  // On touch screens the extra buttons live in this sheet, behind the "…" next to the title.
  const [moreOpen, setMoreOpen] = useState(false);
  // The "…" sheet follows a finger dragged down on it, and closes on a long pull or a quick flick.
  const [sheetDrag, setSheetDrag] = useState(0);
  const sheetStart = useRef<{ y: number; t: number } | null>(null);
  const sheetTouch = {
    onTouchStart: (e: React.TouchEvent<HTMLElement>) => {
      sheetStart.current = e.currentTarget.scrollTop <= 0 ? { y: e.touches[0].clientY, t: Date.now() } : null;
    },
    onTouchMove: (e: React.TouchEvent<HTMLElement>) => {
      const s = sheetStart.current;
      if (s) setSheetDrag(Math.max(0, e.touches[0].clientY - s.y - 8));
    },
    onTouchEnd: () => {
      const s = sheetStart.current;
      sheetStart.current = null;
      const d = sheetDrag;
      const flick = !!s && d > 32 && (d + 8) / Math.max(1, Date.now() - s.t) > 0.3;
      setSheetDrag(0);
      if (d > 90 || flick) setMoreOpen(false);
    },
  };
  const [, tick] = useState(0);
  // The minutes left on the sleep timer count down on screen.
  useEffect(() => {
    if (!sleep || !('at' in sleep)) return;
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, [sleep]);
  const sleepLabel = !sleep ? 'Sleep' : 'track' in sleep ? 'Sleep · end of track' : `Sleep · ${Math.max(1, Math.ceil((sleep.at - Date.now()) / 60000))} min`;
  const track = queue[index];
  const art = cover ?? (track ? generatedCover(track.dir) : '');
  // An album or playlist in the drawer reports its own picture, for the background colour.
  const [viewArt, setViewArt] = useState<string | null>(null);
  const onArt = useCallback((u: string | null) => setViewArt(u), []);
  useEffect(() => setViewArt(null), [view]);
  const backdropArt = (view.kind === 'now' ? art || null : viewArt) || null;
  const tint = useArtColour(backdropArt);
  // Upright, the queue and the sound quality open over the art (like Apple Music); on wide screens the queue is always beside it.
  const [panel, setPanel] = useState<'none' | 'queue' | 'quality'>('none');
  const [lyricsOpen, setLyricsOpen] = useState(false);
  // Wide screens keep the art and the controls on the left with the lyrics beside them; upright ones give the lyrics the whole body.
  const [wide, setWide] = useState(() => !queueIsPanel());
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 699px)').matches);
  useEffect(() => {
    const on = () => {
      setWide(!queueIsPanel());
      setNarrow(matchMedia('(max-width: 699px)').matches);
    };
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  // The layout: Console on wide screens, Hush on phones, the classic one elsewhere (or when switched back in About).
  const classic = (() => {
    try {
      return localStorage.getItem('nightjar.classicPlayer') === '1';
    } catch {
      return false;
    }
  })();
  const mode = classic || view.kind !== 'now' ? 'classic' : wide ? 'rail' : narrow ? 'hush' : 'classic';
  const hush = mode === 'hush';
  // Hush: the controls fade after a few seconds of playing and come back at any touch.
  const [awake, setAwake] = useState(true);
  const dozeTimer = useRef<ReturnType<typeof setTimeout>>();
  const wake = useCallback(() => {
    setAwake(true);
    clearTimeout(dozeTimer.current);
    dozeTimer.current = setTimeout(() => setAwake(false), 3000);
  }, []);
  useEffect(() => {
    if (hush) wake();
    return () => clearTimeout(dozeTimer.current);
  }, [hush, playing, wake]);
  const dozing = hush && !awake;
  const { state: lyrics, retry: retryLyrics } = useLyrics(track, lyricsOpen && view.kind === 'now');
  const details = panel === 'quality';
  const [editing, setEditing] = useState(false);
  const [grown] = useState(() => {
    const from = morph.rect;
    morph.rect = null;
    return from;
  });
  const [drag, setDrag] = useState(0);
  const [closing, setClosing] = useState(false);
  const startY = useRef<number | null>(null);
  const startT = useRef(0);
  const sheet = useRef<HTMLDivElement>(null);

  // Closing slides the drawer back down first, then takes it away.
  const close = () => {
    if (closing) return;
    setClosing(true);
    const done = () => p.setExpanded(false);
    const el = sheet.current;
    if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    el.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 450); // in case the transition doesn't report back
  };
  // The back button or a swipe asks for the drawer to close: same slide down as the arrow.
  const closeRequested = usePlayer((s) => s.closeRequested);
  useEffect(() => {
    if (closeRequested) close();
  }, [closeRequested]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = useRef<HTMLLIElement>(null);
  const queueRef = useRef<HTMLDivElement>(null);

  // Escape closes; the current track scrolls into view when the player opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    // On wide screens the list scrolls by itself: show the current track. Upright, the art stays on top.
    const list = queueRef.current, row = current.current;
    if (list && row && list.scrollHeight > list.clientHeight + 4) list.scrollTop = Math.max(0, row.offsetTop - list.offsetTop - 60);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Opened from the small player: the art grows out of the small cover into its place.
  const artImg = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    const img = artImg.current;
    if (!grown || !img || !grown.width || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    img.style.transition = 'none';
    img.style.transform = 'none';
    const to = img.getBoundingClientRect();
    img.style.transform = '';
    if (!to.width) {
      img.style.transition = '';
      return;
    }
    const end = getComputedStyle(img).transform;
    const dx = grown.left + grown.width / 2 - (to.left + to.width / 2);
    const dy = grown.top + grown.height / 2 - (to.top + to.height / 2);
    const s = grown.width / to.width;
    const run = img.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transform: end }], {
      duration: 460,
      easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
    });
    const done = () => (img.style.transition = '');
    run.onfinish = done;
    run.oncancel = done;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Opening the queue shows the track that is playing.
  useEffect(() => {
    if (panel !== 'queue') return;
    const list = queueRef.current, row = current.current;
    if (list && row) list.scrollTop = Math.max(0, row.offsetTop - list.offsetTop - 60);
  }, [panel]);

  const scrub = useScrub(time, duration, (t) => {
    if (audioCtl.el) audioCtl.el.currentTime = t;
  });
  const back = useHoldToScan(-1, () => p.prev());
  const ahead = useHoldToScan(1, () => {
    const s = usePlayer.getState();
    if (s.index + 1 < s.queue.length || s.repeat === 'all') s.next();
  });
  const tap = useDoubleTapSeek();
  const shown = scrub.shown;
  const remaining = Math.max(0, duration - shown);
  const progress = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;
  const upNext = queue.map((q, i) => ({ q, i })).filter(({ i }) => i > index);
  const played = queue.map((q, i) => ({ q, i })).filter(({ i }) => i < index);

  // Swipe down on the art or the top bar closes it, like Apple Music.
  // The first 8px are a dead zone (a tap on the art is not a drag), and a quick flick closes it even if short.
  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    startT.current = Date.now();
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current == null) return;
    setDrag(Math.max(0, e.touches[0].clientY - startY.current - 8));
  };
  const onTouchEnd = () => {
    const flick = drag > 32 && (drag + 8) / Math.max(1, Date.now() - startT.current) > 0.3;
    if (drag > 110 || flick) close();
    else setDrag(0);
    startY.current = null;
  };

  // Hush: on the cover, a sideways swipe skips (the cover follows the finger; a quick flick is enough) and a tap plays or pauses.
  const [hx, setHx] = useState(0);
  const [hLive, setHLive] = useState(false);
  const [flash, setFlash] = useState<'' | 'play' | 'pause'>('');
  const hs = useRef<{ x: number; y: number; t: number; mode: '' | 'h' | 'v' } | null>(null);
  const artTouch = hush
    ? {
        onTouchStart: (e: React.TouchEvent) => {
          const t = e.touches[0];
          hs.current = { x: t.clientX, y: t.clientY, t: Date.now(), mode: '' };
          onTouchStart(e);
        },
        onTouchMove: (e: React.TouchEvent) => {
          const s = hs.current;
          if (!s) return;
          const t = e.touches[0];
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (!s.mode) {
            if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) s.mode = 'h';
            else if (Math.abs(dy) > 8) s.mode = 'v';
          }
          if (s.mode === 'h') {
            setHLive(true);
            setHx(dx);
          } else if (s.mode === 'v') onTouchMove(e);
        },
        onTouchEnd: () => {
          const s = hs.current;
          hs.current = null;
          if (s?.mode === 'h') {
            const v = hx / Math.max(1, Date.now() - s.t);
            const w = window.innerWidth;
            setHLive(false);
            if (Math.abs(hx) > w * 0.25 || Math.abs(v) > 0.4) {
              const dir = hx < 0 ? -1 : 1;
              setHx(dir * w);
              setTimeout(() => {
                setHLive(true);
                const st = usePlayer.getState();
                if (dir < 0) {
                  if (st.index + 1 < st.queue.length || st.repeat === 'all') st.next();
                } else st.prev();
                setHx(-dir * 60);
                requestAnimationFrame(() => requestAnimationFrame(() => { setHLive(false); setHx(0); }));
              }, 150);
            } else setHx(0);
          } else if (s?.mode === 'v') onTouchEnd();
          else startY.current = null;
        },
      }
    : { onTouchStart, onTouchMove, onTouchEnd };
  const tapArt = (e: React.MouseEvent<HTMLElement>) => {
    if (!hush) return tap.onClick(e);
    p.toggle();
    setFlash(playing ? 'pause' : 'play');
    setTimeout(() => setFlash(''), 500);
  };
  const tier = track ? trackTier(track) : 'unknown';

  const style = {
    ...(tint ? { '--fp-tint': tint } : {}),
    transform: closing ? undefined : drag ? `translateY(${drag}px)` : undefined,
    transition: drag && !closing ? 'none' : undefined,
  } as CSSProperties;

  return (
    <>
      <div className={`fp-backdrop ${closing ? 'out' : ''}`} onClick={close} aria-hidden />
      <div ref={sheet} className={`full-player ${mode} ${dozing ? 'dozing' : ''} ${tint ? 'tinted' : ''} ${closing ? 'closing' : ''} ${grown ? 'morph' : ''}`} onPointerDownCapture={hush ? wake : undefined} role="dialog" aria-label={view.kind === "album" ? "Album" : view.kind === "playlist" ? "Playlist" : "Now playing"} style={style}>
      <Backdrop src={backdropArt} />
      {hush && (
        <div className="fp-hairline" aria-hidden>
          <i style={{ width: `${progress}%` }} />
        </div>
      )}
      <div className="fp-top" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <span className="fp-grab" aria-hidden />
        <button className="fp-icon" onClick={close} aria-label="Close the player">
          <Icon name="chevron" size={22} />
        </button>
        <span className="fp-brand-name">
          Nightjar
        </span>
        <span className="fp-top-end">
          {view.kind !== 'now' && track && (
            <button className="fp-nowbtn" onClick={() => p.showNow()} aria-label={`Back to now playing: ${track.title}`} title="Now playing">
              <Bars on={playing} />
            </button>
          )}
          {view.kind === 'now' && track && (
            <button className={`fp-icon fp-lyrics-btn ${lyricsOpen ? 'on' : ''}`} onClick={() => setLyricsOpen((o) => !o)} aria-label="Lyrics" aria-pressed={lyricsOpen}>
              <LyricsGlyph size={21} />
            </button>
          )}
          {view.kind === 'now' && track && (
            <button className="fp-icon fp-queue-btn" onClick={() => { setLyricsOpen(false); setPanel('queue'); }} aria-label="Up next" aria-haspopup="dialog">
              <QueueGlyph size={21} />
            </button>
          )}
          {inApp ? <WindowControls /> : view.kind === 'now' && track ? null : view.kind === 'now' || !track ? <span className="fp-icon" aria-hidden /> : null}
        </span>
      </div>

      {view.kind === 'album' ? (
        <AlbumView key={view.dir} dir={view.dir} onArt={onArt} />
      ) : view.kind === 'playlist' ? (
        <PlaylistView key={view.id} id={view.id} onArt={onArt} />
      ) : !track ? (
        <div className="fp-body dv-loading">
          <p>Nothing is playing. Tap an album’s cover, then a track.</p>
        </div>
      ) : lyricsOpen && !wide ? (
        <LyricsView state={lyrics} onRetry={retryLyrics} time={time} duration={duration} art={art} title={track.title} artist={track.artist} playing={playing} />
      ) : (
      <div className={`fp-body np ${lyricsOpen && wide ? 'lyrics-on' : ''}`} {...queueSwipe}>
        <div className="fp-art-col" {...artTouch}>
          <div
            className="fp-art-tap"
            onClick={tapArt}
            title={hush ? 'Tap to play or pause, swipe to skip' : 'Double-tap the left or right to go back or forward 10 seconds'}
            style={hush ? { transform: `translateX(${hx}px)`, transition: hLive ? 'none' : 'transform 260ms cubic-bezier(0.23, 1, 0.32, 1)' } : undefined}
          >
            <img ref={artImg} className={`fp-art ${playing ? '' : 'paused'}`} src={art} alt="" />
            {flash && (
              <span className="fp-flash" aria-hidden>
                <Icon name={flash} size={34} />
              </span>
            )}
            {tap.shown && (
              <span className={`fp-jump-flash ${tap.shown.side > 0 ? 'right' : 'left'}`} aria-live="polite">
                {tap.shown.side > 0 ? '+' : '−'}
                {tap.shown.total} s
              </span>
            )}
          </div>
        </div>

        <div className="fp-side">
          <div className="fp-titlerow">
            <div className="fp-now">
              <p className="fp-pos">
                Track {index + 1} of {queue.length}
              </p>
              <h2>{track.title}</h2>
              <p className="fp-artist">
                {track.artist ?? 'Unknown artist'}
                {(tier === 'hires' || tier === 'lossless') && (
                  <LosslessMark hires={tier === 'hires'} detail={`${track.format.toUpperCase()}${track.bits ? ` ${track.bits}/${+(track.rate / 1000).toFixed(1)}` : ''}`} />
                )}
              </p>
              <p className="fp-album">
                {track.album && (
                  <button className="fp-albumlink" onClick={() => p.openAlbum(track.dir)} title="Open the album">
                    {track.album}
                  </button>
                )}
                <span className="fp-chip">{chip}</span>
              </p>
              <dl className="fp-facts">
                <div><dt>Format</dt><dd>{[track.format.toUpperCase(), track.bits ? `${track.bits}-bit` : '', track.rate ? `${+(track.rate / 1000).toFixed(1)} kHz` : '', track.kbps ? `${track.kbps} kbps` : ''].filter(Boolean).join(' · ')}</dd></div>
                <div><dt>Source</dt><dd>From your library</dd></div>
                <div><dt>Output</dt><dd>{dataSaver && (tier === 'hires' || tier === 'lossless') ? 'A smaller copy, to save data' : converted ? 'Converted for this device' : 'Original file, no conversion'}</dd></div>
              </dl>
              {hush && <p className="fp-hint">Tap the cover to play or pause · swipe it to skip</p>}
            </div>
            <button className={`fp-icon fp-more ${sleep || dataSaver ? 'on' : ''}`} onClick={() => setMoreOpen(true)} aria-label="More: sleep timer, sound quality, less data" aria-haspopup="dialog">
              <Icon name="more" size={20} />
            </button>
          </div>

          <div className="fp-time">
            <div className="fp-seek-wrap" {...scrub.wrap}>
              {scrub.drag?.label && <span className="seek-bubble fp">{scrub.drag.label}</span>}
              <input
                className="fp-seek"
                type="range"
                min={0}
                max={duration || 0}
                step={0.5}
                value={Math.min(shown, duration || 0)}
                aria-label="Position"
                style={{ ['--p' as string]: `${progress}%` }}
                {...scrub.props}
              />
            </div>
            <div className="fp-times">
              <span>{fmtTime(shown)}</span>
              <span>{waiting && playing ? 'loading…' : ''}</span>
              <span>−{fmtTime(remaining)}</span>
            </div>
            {duration >= LONG_TRACK && (
              <div className="fp-jumps">
                <button className="fp-pill" onClick={() => seekBy(-15)} aria-label="Back 15 seconds">
                  −15 s
                </button>
                <button className="fp-pill" onClick={() => seekBy(30)} aria-label="Forward 30 seconds">
                  +30 s
                </button>
              </div>
            )}
          </div>

          <div className="fp-controls">
            <button className={`fp-icon small ${shuffle ? 'on' : ''}`} onClick={() => p.setShuffle(!shuffle)} aria-label="Shuffle" aria-pressed={shuffle} title="Shuffle">
              <ShuffleGlyph />
            </button>
            <button className={`fp-icon big scan ${back.scanning ? 'on' : ''}`} {...back.props} aria-label="Previous track" title="Previous track (hold to rewind)">
              <Icon name="prev" size={30} />
            </button>
            <button className="fp-play" onClick={() => p.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
              <Icon name={playing ? 'pause' : 'play'} size={34} />
            </button>
            <button
              className={`fp-icon big scan ${ahead.scanning ? 'on' : ''}`}
              {...ahead.props}
              disabled={index + 1 >= queue.length && repeat !== 'all' && duration <= 0}
              aria-label="Next track"
              title="Next track (hold to fast-forward)"
            >
              <Icon name="next" size={30} />
            </button>
            <button
              className={`fp-icon small ${repeat !== 'off' ? 'on' : ''}`}
              onClick={() => p.cycleRepeat()}
              aria-label={repeat === 'off' ? 'Repeat: off' : repeat === 'all' ? 'Repeat: the whole queue' : 'Repeat: this track'}
              title={repeat === 'off' ? 'Repeat' : repeat === 'all' ? 'Repeating the queue' : 'Repeating this track'}
            >
              <RepeatGlyph one={repeat === 'one'} />
            </button>
          </div>

          {canSetVolume && (
            <div className="fp-volume">
              <VolumeGlyph level={0} />
              <input
                className="fp-seek fp-vol"
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={volume}
                aria-label="Volume"
                style={{ ['--p' as string]: `${volume * 100}%` }}
                onChange={(e) => p.setVolume(parseFloat(e.target.value))}
              />
              <VolumeGlyph level={2} />
            </div>
          )}

          <div className="fp-options">
            <button
              className={`fp-pill ${dataSaver ? 'on' : ''}`}
              role="switch"
              aria-checked={dataSaver}
              onClick={() => p.setDataSaver(!dataSaver)}
              title="Lossless files come as smaller AAC copies made by your computer (about 1 MB a minute)"
            >
              <span className="fp-switch" aria-hidden />
              Use less data
            </button>
            <button className={`fp-pill ${details ? 'on' : ''}`} onClick={() => setPanel(details ? 'none' : 'quality')} aria-pressed={details}>
              {details ? 'Show the queue' : 'Sound quality'}
            </button>
            <button className={`fp-pill fp-upright-only ${panel === 'queue' ? 'on' : ''}`} onClick={() => setPanel('queue')} aria-haspopup="dialog">
              <QueueGlyph />
              Up next
            </button>
            <button className={`fp-pill ${sleep ? 'on' : ''}`} onClick={() => setSleepMenu((o) => !o)} aria-expanded={sleepMenu} aria-haspopup="true">
              <MoonGlyph />
              {sleepLabel}
            </button>
          </div>
          {sleepMenu && (
            <div className="fp-options fp-sleep" role="group" aria-label="Sleep timer">
              {[15, 30, 45, 60].map((m) => (
                <button key={m} className="fp-pill" onClick={() => { p.setSleep(m); setSleepMenu(false); }}>
                  {m === 60 ? '1 hour' : `${m} min`}
                </button>
              ))}
              <button className="fp-pill" onClick={() => { p.setSleep('track'); setSleepMenu(false); }}>
                End of track
              </button>
              {sleep && (
                <button className="fp-pill" onClick={() => { p.setSleep(null); setSleepMenu(false); }}>
                  Turn off
                </button>
              )}
            </div>
          )}

          {lyricsOpen && wide && <LyricsScroll className="fp-ly-side" state={lyrics} onRetry={retryLyrics} />}
          {details ? (
            <div className="fp-details">
              <div className="fp-panel-head">
                <strong>Sound quality</strong>
                <span className="fp-gap" />
                <button className="fp-edit" onClick={() => setPanel('none')}>
                  Done
                </button>
              </div>
              {quality}
            </div>
          ) : (
            <div
              className={`fp-queue np ${panel === 'queue' ? 'open' : ''}`}
              ref={queueRef}
              style={
                qDrag
                  ? { transform: `translateY(${qDrag}px)`, transition: 'none' }
                  : qPeek
                    ? { transform: `translateY(${(queueRef.current?.offsetHeight ?? 600) - qPeek}px)`, visibility: 'visible', transition: 'none' }
                    : undefined
              }
            >
              <div className="fp-queue-head" {...qHead}>
                <strong>Up next</strong>
                <small className="fp-queue-count">· {upNext.length} {upNext.length === 1 ? 'track' : 'tracks'}</small>
                {shuffle && <span className="dim">Shuffled</span>}
                {repeat !== 'off' && <span className="dim">{repeat === 'one' ? 'Repeating this track' : 'Repeating the queue'}</span>}
                <span className="fp-gap" />
                {queue.length > 1 && (
                  <button className={`fp-edit ${editing ? 'on' : ''}`} onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
                    {editing ? 'Done' : 'Edit'}
                  </button>
                )}
                <button className="fp-edit fp-upright-only" onClick={() => setPanel('none')} aria-label="Close the queue">
                  Close
                </button>
              </div>
              <ol className={editing ? 'editing' : undefined}>
                {played.map(({ q, i }) => (
                  <QueueRow key={q.qid} q={q} state="played" editing={editing} album={track.album} onPlay={() => p.jump(i)} onRemove={() => p.remove(q.qid)} onMove={() => undefined} />
                ))}
                <li ref={current} className="fp-row now" aria-current="true">
                  <span className="fp-row-n">
                    <span className={`fp-bars ${playing ? 'on' : ''}`} aria-hidden>
                      <i />
                      <i />
                      <i />
                    </span>
                  </span>
                  <span className="fp-row-t">
                    <strong>{track.title}</strong>
                    <span>{track.artist}</span>
                  </span>
                  <span className="fp-row-d">{fmtTime(track.seconds)}</span>
                  {editing && <span className="fp-row-x-space" aria-hidden />}
                  {editing && <span className="fp-row-grip-space" aria-hidden />}
                </li>
                {upNext.map(({ q, i }) => (
                  <QueueRow key={q.qid} q={q} state="next" editing={editing} album={track.album} thumb={mode === 'rail' ? (q.dir === track.dir ? art : generatedCover(q.dir)) : undefined} rail={mode === 'rail'} onPlay={() => p.jump(i)} onRemove={() => p.remove(q.qid)} onMove={(by) => p.move(q.qid, i + by)} />
                ))}
                {upNext.length === 0 && <li className="fp-row empty">Nothing after this{repeat === 'all' ? ': the queue starts again' : ''}.</li>}
              </ol>
            </div>
          )}
        </div>
      </div>
      )}
      {moreOpen && track && view.kind === 'now' && (
        <>
          <div className="fp-sheet-backdrop" onClick={() => setMoreOpen(false)} aria-hidden />
          <div
            className="fp-sheet"
            role="dialog"
            aria-label="More"
            onKeyDown={(e) => e.key === 'Escape' && setMoreOpen(false)}
            style={sheetDrag ? { transform: `translateY(${sheetDrag}px)`, transition: 'none' } : undefined}
            {...sheetTouch}
          >
            <span className="fp-sheet-grab" aria-hidden />
            {hush && (
              <>
                <button className="fp-sheet-row" role="switch" aria-checked={shuffle} onClick={() => p.setShuffle(!shuffle)}>
                  <span>Shuffle</span>
                  <span className={`fp-tog ${shuffle ? 'on' : ''}`} aria-hidden />
                </button>
                <button className="fp-sheet-row" onClick={() => p.cycleRepeat()}>
                  <span>
                    Repeat
                    <small>{repeat === 'off' ? 'Off' : repeat === 'all' ? 'The whole queue' : 'This track'}</small>
                  </span>
                  <RepeatGlyph one={repeat === 'one'} />
                </button>
                {track.album && (
                  <button className="fp-sheet-row" onClick={() => { setMoreOpen(false); p.openAlbum(track.dir); }}>
                    <span>
                      Open the album
                      <small>{track.album}</small>
                    </span>
                    <Icon name="chevron" size={18} />
                  </button>
                )}
              </>
            )}
            <button className="fp-sheet-row" role="switch" aria-checked={dataSaver} onClick={() => p.setDataSaver(!dataSaver)}>
              <span>
                Use less data
                <small>Lossless files come as smaller AAC copies</small>
              </span>
              <span className={`fp-tog ${dataSaver ? 'on' : ''}`} aria-hidden />
            </button>
            <button
              className="fp-sheet-row"
              onClick={() => {
                setMoreOpen(false);
                setPanel('quality');
              }}
            >
              <span>
                Sound quality
                <small>From the file to this device</small>
              </span>
              <Icon name="chevron" size={18} />
            </button>
            <button
              className="fp-sheet-row"
              onClick={() => {
                setMoreOpen(false);
                const toast = useStore.getState().toast;
                shareStoryCard({ art, tint, title: track.title, artist: track.artist })
                  .then((r) => r === 'saved' && toast('Picture saved. Post it as a story from your photos.'))
                  .catch(() => toast('Couldn’t make the picture.', 'error'));
              }}
            >
              <span>
                Share what I’m playing
                <small>A picture of the cover to post as a story</small>
              </span>
              <Icon name="chevron" size={18} />
            </button>
            <div className="fp-sheet-row static">
              <span>
                Sleep timer
                <small>{!sleep ? 'Off' : 'track' in sleep ? 'At the end of this track' : `${Math.max(1, Math.ceil((sleep.at - Date.now()) / 60000))} min left`}</small>
              </span>
            </div>
            <div className="fp-sleep-chips" role="group" aria-label="Sleep timer">
              {[15, 30, 45, 60].map((m) => (
                <button key={m} className="fp-pill" onClick={() => { p.setSleep(m); setMoreOpen(false); }}>
                  {m === 60 ? '1 hour' : `${m} min`}
                </button>
              ))}
              <button className={`fp-pill ${sleep && 'track' in sleep ? 'on' : ''}`} onClick={() => { p.setSleep('track'); setMoreOpen(false); }}>
                End of track
              </button>
              {sleep && (
                <button className="fp-pill" onClick={() => { p.setSleep(null); setMoreOpen(false); }}>
                  Turn off
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
    </>
  );
}

/**
 * The blurred cover behind the player. A new cover is decoded off screen first and then fades in over the old one, and only then
 * is the old one dropped, so the background never blinks when the cover changes (the placeholder gives way to the real cover a
 * moment after the player opens).
 */
function Backdrop({ src }: { src: string | null }) {
  // A cover that is already prepared is there on the first frame, with no fade; a new one fades in over the old.
  // `raw` is the fallback for a cover that can't be blurred by hand: the picture itself, blurred by CSS.
  type Layer = { src: string; id: number; instant?: boolean; raw?: boolean; of: string };
  const [layers, setLayers] = useState<Layer[]>(() => {
    const ready = src ? softBackdropNow(src) : null;
    if (src && ready) return [{ src: ready, of: src, id: 0, instant: true }];
    return src && warmBackdrop.has(src) && softBackdropNow(src) === null && warmRaw.has(src) ? [{ src, of: src, id: 0, instant: true, raw: true }] : [];
  });
  useEffect(() => {
    if (!src) return;
    let alive = true;
    const show = (url: string, raw: boolean) => {
      if (!alive) return;
      if (raw) warmRaw.add(src);
      setLayers((l) => (l[l.length - 1]?.of === src ? l : [...l.slice(-1), { src: url, of: src, raw, id: Date.now() + Math.random() }]));
      // the older layer is only needed while the new one fades in
      setTimeout(() => alive && setLayers((l) => l.slice(-1)), 900);
    };
    void softBackdrop(src).then((url) => {
      if (url) return show(url, false);
      const img = new Image();
      img.src = src;
      const go = () => show(src, true);
      (img.decode ? img.decode() : Promise.resolve()).then(go, go);
    });
    return () => {
      alive = false;
    };
  }, [src]);
  return (
    <div className="fp-bgbox" aria-hidden>
      <div className="fp-bgimgs">
        {layers.map((l, i) => (
          <img key={l.id} className={`fp-bg ${i === layers.length - 1 ? 'in' : ''} ${l.instant ? 'instant' : ''} ${l.raw ? 'raw' : ''}`} src={l.src} alt="" />
        ))}
      </div>
    </div>
  );
}

/** Whether the queue is a panel over the player (upright, or a phone held sideways) rather than a list beside the cover. */
const queueIsPanel = () => !matchMedia('(min-aspect-ratio: 1/1) and (min-width: 560px)').matches || matchMedia('(max-height: 520px)').matches;

/** The format as a short tag: "FLAC 16/44.1", "MP3 320". */
const shortFormat = (q: QueueItem) => `${q.format.toUpperCase()}${q.bits ? ` ${q.bits}/${+(q.rate / 1000).toFixed(1)}` : q.kbps ? ` ${q.kbps}` : ''}`;

/** How far a swipe pulls a row open: the width of its Remove button. */
const SWIPE_OPEN = 88;

/**
 * One row of the queue. Swiping it left shows Remove (like Apple Music); while editing, the grip on the right
 * drags a track that is still to come to another place in the queue.
 */
function QueueRow({
  q,
  state,
  editing,
  album,
  thumb,
  rail,
  onPlay,
  onRemove,
  onMove,
}: {
  q: QueueItem;
  state: 'played' | 'next';
  editing: boolean;
  album?: string | null;
  /** Console: a small cover at the start of the row, and the file's format under the title. */
  thumb?: string;
  rail?: boolean;
  onPlay: () => void;
  onRemove: () => void;
  /** Called with how many places the track moved (negative: up). */
  onMove: (by: number) => void;
}) {
  const row = useRef<HTMLLIElement>(null);
  const [slide, setSlide] = useState(0); // how far the row is pulled left
  const [live, setLive] = useState(false); // a finger is moving it
  const [lift, setLift] = useState<number | null>(null); // dragging by the grip: how far from where it started
  const touch = useRef<{ x: number; y: number; base: number; mode: '' | 'h' | 'v'; at: number; dx: number } | null>(null);

  const swipeStart = (e: React.TouchEvent) => {
    if (editing) return;
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, base: slide, mode: '', at: Date.now(), dx: 0 };
  };
  const swipeMove = (e: React.TouchEvent) => {
    const t = touch.current;
    if (!t) return;
    const dx = e.touches[0].clientX - t.x;
    const dy = e.touches[0].clientY - t.y;
    if (!t.mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) t.mode = 'h';
      else if (Math.abs(dy) > 8) t.mode = 'v';
    }
    if (t.mode === 'h') {
      t.dx = dx;
      setLive(true);
      // Past the open position the row gives a little, with growing resistance, instead of stopping dead.
      const raw = t.base + dx;
      const over = Math.max(0, -SWIPE_OPEN - raw);
      setSlide(Math.min(0, raw) + (raw < -SWIPE_OPEN ? over - Math.min(16, over * 0.35) : 0));
    }
  };
  const swipeEnd = () => {
    const t = touch.current;
    touch.current = null;
    if (t?.mode !== 'h') return;
    setLive(false);
    // A quick flick decides by its direction; a slow drag by how far the row got.
    const v = t.dx / Math.max(1, Date.now() - t.at);
    setSlide((s) => (v < -0.3 ? -SWIPE_OPEN : v > 0.3 ? 0 : s < -SWIPE_OPEN / 2 ? -SWIPE_OPEN : 0));
  };

  const grip = (e: React.PointerEvent<HTMLButtonElement>) => {
    const li = row.current;
    const list = li?.parentElement;
    if (!li || !list) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const rows = Array.from(list.children).filter((c) => c.classList.contains('next'));
    const centres = rows.map((r) => {
      const b = r.getBoundingClientRect();
      return b.top + b.height / 2;
    });
    const mine = rows.indexOf(li);
    const startY = e.clientY;
    setLift(0);
    const onMoveEv = (ev: PointerEvent) => setLift(ev.clientY - startY);
    const finish = (ev: PointerEvent) => {
      handle.removeEventListener('pointermove', onMoveEv);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      const y = centres[mine] + (ev.clientY - startY);
      let best = mine;
      centres.forEach((c, k) => {
        if (Math.abs(c - y) < Math.abs(centres[best] - y)) best = k;
      });
      setLift(null);
      if (ev.type === 'pointerup' && best !== mine) onMove(best - mine);
    };
    handle.addEventListener('pointermove', onMoveEv);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  };

  return (
    <li
      ref={row}
      className={`fp-row ${state} ${lift !== null ? 'lifted' : ''}`}
      style={lift !== null ? { transform: `translateY(${lift}px)` } : undefined}
      onTouchStart={swipeStart}
      onTouchMove={swipeMove}
      onTouchEnd={swipeEnd}
      onTouchCancel={swipeEnd}
    >
      <button className="fp-row-del" onClick={onRemove} style={{ opacity: slide ? 1 : 0, pointerEvents: slide ? 'auto' : 'none' }} tabIndex={slide ? 0 : -1} aria-hidden={!slide} aria-label={`Remove ${q.title} from the queue`}>
        Remove
      </button>
      <div className="fp-row-slide" style={{ transform: slide ? `translateX(${slide}px)` : undefined, transition: live ? 'none' : undefined }}>
        <button className="fp-row-main" onClick={editing ? undefined : slide ? () => setSlide(0) : onPlay} tabIndex={editing ? -1 : 0}>
          {thumb && <img className="fp-row-art" src={thumb} alt="" />}
          <span className="fp-row-n">{q.no || ''}</span>
          <span className="fp-row-t">
            <strong>{q.title}</strong>
            <span>{(rail ? [q.artist, shortFormat(q)] : [q.artist, q.album !== album ? q.album : null]).filter(Boolean).join(' · ')}</span>
          </span>
          <span className="fp-row-d">{fmtTime(q.seconds)}</span>
        </button>
        {editing && (
          <button className="fp-row-x" onClick={onRemove} aria-label={`Remove ${q.title} from the queue`} title="Remove from the queue">
            <span aria-hidden>−</span>
          </button>
        )}
        {editing && state === 'next' && (
          <button className="fp-row-grip" onPointerDown={grip} aria-label={`Drag ${q.title} to move it in the queue`} title="Drag to move">
            <GripGlyph />
          </button>
        )}
      </div>
    </li>
  );
}

function GripGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 8h16M4 12h16M4 16h16" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </svg>
  );
}

/** A small speaker: level 0 is the quiet one, 2 the loud one. */
function VolumeGlyph({ level }: { level: 0 | 2 }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" />
      {level === 2 && <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
    </svg>
  );
}

/** A small mark beside the artist while a lossless or Hi-Res file plays: five sound bars in the tier's colour. */
function LosslessMark({ hires, detail }: { hires: boolean; detail: string }) {
  const label = `${hires ? 'Hi-Res lossless' : 'Lossless'} · ${detail}`;
  return (
    <span className={`fp-lossless ${hires ? 't-hires' : 't-lossless'}`} role="img" aria-label={label} title={label}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
      </svg>
    </span>
  );
}

function LyricsGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M7.5 9h9M7.5 12.5h5.5" />
    </svg>
  );
}

function QueueGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h12M4 12h12M4 17h8M19 14v6M16 17h6" />
    </svg>
  );
}

function ShuffleGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h3.5c2 0 3.3 1 4.4 2.6l2.2 3.3c1.1 1.6 2.4 2.6 4.4 2.6H21M3 17h3.5c1.4 0 2.4-.5 3.3-1.3M14.2 8.3c.9-.8 1.9-1.3 3.3-1.3H21M18 4l3 3-3 3M18 13l3 3-3 3" />
    </svg>
  );
}

function RepeatGlyph({ one }: { one: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11V9.5A3.5 3.5 0 0 1 7.5 6H19M16 3l3 3-3 3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H5M8 21l-3-3 3-3" />
      {one && <text x="12" y="14.6" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none" fontFamily="system-ui">1</text>}
    </svg>
  );
}

/**
 * A deep colour from the album art for the background: the average of its colourful pixels, darkened
 * so white text stays readable. Null while it isn't known (or the picture can't be read).
 */
export function useArtColour(src: string | null) {
  // A cover that was prepared while the small player was showing gives its colour on the very first frame.
  const [colour, setColour] = useState<string | null>(() => (src ? warmColour.get(src) ?? null : null));
  useEffect(() => {
    if (!src) {
      setColour(null);
      return;
    }
    let alive = true;
    if (warmColour.has(src)) setColour(warmColour.get(src) ?? null);
    else void warmArt(src).then((c) => alive && setColour(c));
    return () => {
      alive = false;
    };
  }, [src]);
  return colour;
}

/** The deep colour of a picture: the average of its colourful pixels, darkened so white text always reads. Null if it can't be read. */
function colourOf(img: HTMLImageElement): string | null {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 24;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(img, 0, 0, 24, 24);
    const d = g.getImageData(0, 0, 24, 24).data;
    let r = 0, gr = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const max = Math.max(R, G, B), min = Math.min(R, G, B);
      const sat = max === 0 ? 0 : (max - min) / max;
      const weight = 0.15 + sat * 2; // colourful pixels count more than greys
      r += R * weight;
      gr += G * weight;
      b += B * weight;
      w += weight;
    }
    if (!w) return null;
    r /= w;
    gr /= w;
    b /= w;
    // Keep it deep: scale so the brightest channel is at most ~92, so white text always reads well.
    const k = Math.min(1, 92 / Math.max(r, gr, b, 1));
    return `rgb(${Math.round(r * k)} ${Math.round(gr * k)} ${Math.round(b * k)})`;
  } catch {
    return null; // a picture from a server that doesn't allow reading it
  }
}

/** Covers whose colour is known (null: unreadable), and covers already decoded for the blurred background. */
const warmColour = new Map<string, string | null>();
const warmBackdrop = new Set<string>();
/** Covers that can't be blurred by hand and are shown through the CSS blur instead. */
const warmRaw = new Set<string>();
const warming = new Map<string, Promise<string | null>>();

/**
 * Gets a cover ready ahead of time (decoded for the blurred background, its colour worked out), so the large player
 * opens with both already in place instead of finishing them after it is on screen.
 */
export function warmArt(src: string): Promise<string | null> {
  if (warmColour.has(src)) return Promise.resolve(warmColour.get(src) ?? null);
  const running = warming.get(src);
  if (running) return running;
  const plain = new Image();
  plain.src = src;
  void (plain.decode ? plain.decode() : Promise.resolve()).then(() => warmBackdrop.add(src), () => undefined);
  void softBackdrop(src);
  const job = new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      try {
        await img.decode?.();
      } catch {
        /* the colour can still be read */
      }
      const colour = colourOf(img);
      warmColour.set(src, colour);
      resolve(colour);
    };
    img.onerror = () => {
      warmColour.set(src, null);
      resolve(null);
    };
    img.src = src;
  }).finally(() => warming.delete(src));
  warming.set(src, job);
  return job;
}
