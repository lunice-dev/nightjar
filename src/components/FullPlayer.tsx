import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { audioCtl, fmtTime, usePlayer, type QueueItem } from '../lib/player';
import { generatedCover } from '../lib/covers';
import { Icon } from './Icon';
import { Mark } from './Mark';
import { WindowControls } from './WindowControls';
import { inApp } from '../lib/host';
import { AlbumView, Bars, PlaylistView } from './DrawerViews';
import { useScrub } from '../lib/scrub';

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
  const { queue, index, playing, shuffle, repeat, dataSaver, view } = usePlayer();
  const p = usePlayer.getState();
  const track = queue[index];
  const art = cover ?? (track ? generatedCover(track.dir) : '');
  // An album or playlist in the drawer reports its own picture, for the background colour.
  const [viewArt, setViewArt] = useState<string | null>(null);
  const onArt = useCallback((u: string | null) => setViewArt(u), []);
  useEffect(() => setViewArt(null), [view]);
  const tint = useArtColour(view.kind === 'now' ? art || null : viewArt);
  const [details, setDetails] = useState(false);
  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState(0);
  const [closing, setClosing] = useState(false);
  const startY = useRef<number | null>(null);
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

  const scrub = useScrub(time, (t) => {
    if (audioCtl.el) audioCtl.el.currentTime = t;
  });
  const shown = scrub.shown;
  const remaining = Math.max(0, duration - shown);
  const progress = duration > 0 ? Math.min(100, (shown / duration) * 100) : 0;
  const upNext = queue.map((q, i) => ({ q, i })).filter(({ i }) => i > index);
  const played = queue.map((q, i) => ({ q, i })).filter(({ i }) => i < index);

  // Swipe down on the art or the top bar closes it, like Apple Music.
  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current == null) return;
    setDrag(Math.max(0, e.touches[0].clientY - startY.current));
  };
  const onTouchEnd = () => {
    if (drag > 110) close();
    else setDrag(0);
    startY.current = null;
  };

  const style = {
    ...(tint ? { '--fp-tint': tint } : {}),
    transform: closing ? undefined : drag ? `translateY(${drag}px)` : undefined,
    transition: drag && !closing ? 'none' : undefined,
  } as CSSProperties;

  return (
    <>
      <div className={`fp-backdrop ${closing ? 'out' : ''}`} onClick={close} aria-hidden />
      <div ref={sheet} className={`full-player ${tint ? 'tinted' : ''} ${closing ? 'closing' : ''}`} role="dialog" aria-label={view.kind === "album" ? "Album" : view.kind === "playlist" ? "Playlist" : "Now playing"} style={style}>
      <div className="fp-top" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <span className="fp-grab" aria-hidden />
        <button className="fp-icon" onClick={close} aria-label="Close the player">
          <Icon name="chevron" size={22} />
        </button>
        <span className="fp-brand-name">
          <Mark size={18} /> Nightjar
        </span>
        <span className="fp-top-end">
          {view.kind !== 'now' && track && (
            <button className="fp-nowbtn" onClick={() => p.showNow()} aria-label={`Now playing: ${track.title}`}>
              <Bars on={playing} /> Now playing
            </button>
          )}
          {inApp ? <WindowControls /> : view.kind === 'now' || !track ? <span className="fp-icon" aria-hidden /> : null}
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
      ) : (
      <div className="fp-body">
        <div className="fp-art-col" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <img className={`fp-art ${playing ? '' : 'paused'}`} src={art} alt="" />
        </div>

        <div className="fp-side">
          <div className="fp-now">
            <h2>{track.title}</h2>
            <p className="fp-artist">{track.artist ?? 'Unknown artist'}</p>
            <p className="fp-album">
              {track.album && <span>{track.album}</span>}
              <span className="fp-chip">{chip}</span>
            </p>
          </div>

          <div className="fp-time">
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
            <div className="fp-times">
              <span>{fmtTime(shown)}</span>
              <span>{waiting && playing ? 'loading…' : ''}</span>
              <span>−{fmtTime(remaining)}</span>
            </div>
          </div>

          <div className="fp-controls">
            <button className={`fp-icon small ${shuffle ? 'on' : ''}`} onClick={() => p.setShuffle(!shuffle)} aria-label="Shuffle" aria-pressed={shuffle} title="Shuffle">
              <ShuffleGlyph />
            </button>
            <button className="fp-icon big" onClick={() => p.prev()} aria-label="Previous track">
              <Icon name="prev" size={30} />
            </button>
            <button className="fp-play" onClick={() => p.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
              <Icon name={playing ? 'pause' : 'play'} size={34} />
            </button>
            <button className="fp-icon big" onClick={() => p.next()} disabled={index + 1 >= queue.length && repeat !== 'all'} aria-label="Next track">
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
            <button className={`fp-pill ${details ? 'on' : ''}`} onClick={() => setDetails((d) => !d)} aria-pressed={details}>
              {details ? 'Show the queue' : 'Sound quality'}
            </button>
          </div>

          {details ? (
            <div className="fp-details">{quality}</div>
          ) : (
            <div className="fp-queue" ref={queueRef}>
              <div className="fp-queue-head">
                <strong>Up next</strong>
                {shuffle && <span className="dim">Shuffled</span>}
                {repeat !== 'off' && <span className="dim">{repeat === 'one' ? 'Repeating this track' : 'Repeating the queue'}</span>}
                <span className="fp-gap" />
                {queue.length > 1 && (
                  <button className={`fp-edit ${editing ? 'on' : ''}`} onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
                    {editing ? 'Done' : 'Edit'}
                  </button>
                )}
              </div>
              <ol className={editing ? 'editing' : undefined}>
                {played.map(({ q, i }) => (
                  <QueueRow key={q.qid} q={q} state="played" editing={editing} album={track.album} onPlay={() => p.jump(i)} onRemove={() => p.remove(q.qid)} />
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
                </li>
                {upNext.map(({ q, i }) => (
                  <QueueRow key={q.qid} q={q} state="next" editing={editing} album={track.album} onPlay={() => p.jump(i)} onRemove={() => p.remove(q.qid)} />
                ))}
                {upNext.length === 0 && <li className="fp-row empty">Nothing after this{repeat === 'all' ? ': the queue starts again' : ''}.</li>}
              </ol>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
    </>
  );
}

function QueueRow({ q, state, editing, album, onPlay, onRemove }: { q: QueueItem; state: 'played' | 'next'; editing: boolean; album?: string | null; onPlay: () => void; onRemove: () => void }) {
  return (
    <li className={`fp-row ${state}`}>
      <button className="fp-row-main" onClick={editing ? undefined : onPlay} tabIndex={editing ? -1 : 0}>
        <span className="fp-row-n">{q.no || ''}</span>
        <span className="fp-row-t">
          <strong>{q.title}</strong>
          <span>{[q.artist, q.album !== album ? q.album : null].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="fp-row-d">{fmtTime(q.seconds)}</span>
      </button>
      {editing && (
        <button className="fp-row-x" onClick={onRemove} aria-label={`Remove ${q.title} from the queue`} title="Remove from the queue">
          <span aria-hidden>−</span>
        </button>
      )}
    </li>
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
function useArtColour(src: string | null) {
  const [colour, setColour] = useState<string | null>(null);
  useEffect(() => {
    if (!src) {
      setColour(null);
      return;
    }
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const g = c.getContext('2d', { willReadFrequently: true });
        if (!g) return;
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
        if (!w) return;
        r /= w;
        gr /= w;
        b /= w;
        // Keep it deep: scale so the brightest channel is at most ~92, so white text always reads well.
        const k = Math.min(1, 92 / Math.max(r, gr, b, 1));
        if (alive) setColour(`rgb(${Math.round(r * k)} ${Math.round(gr * k)} ${Math.round(b * k)})`);
      } catch {
        if (alive) setColour(null); // a picture from a server that doesn't allow reading it
      }
    };
    img.onerror = () => alive && setColour(null);
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return colour;
}
