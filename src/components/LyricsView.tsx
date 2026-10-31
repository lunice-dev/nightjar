import { useEffect, useMemo, useRef } from 'react';
import { activeLine, type LyricsState } from '../lib/lyrics';
import { audioCtl, fmtTime, usePlayer } from '../lib/player';
import { Icon } from './Icon';

/**
 * The scrolling lyrics. Synced lyrics follow the song: the current line is large and bright, the others dimmed, three dots
 * wait through the intro, and tapping a line jumps there. Scrolling by hand pauses the following for a few seconds.
 */
export function LyricsScroll({ state, time, onRetry, className }: { state: LyricsState; time: number; onRetry: () => void; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const lines = state.status === 'ready' ? state.lyrics.lines : [];
  const synced = state.status === 'ready' && state.lyrics.synced;
  const active = useMemo(() => (synced ? activeLine(lines, time) : -1), [synced, lines, time]);
  const holdUntil = useRef(0);
  const first = useRef(true);

  // Keep the current line about a third of the way down.
  useEffect(() => {
    const el = box.current;
    const row = el?.querySelector<HTMLElement>('[data-now="true"]');
    if (!el || !row || Date.now() < holdUntil.current) return;
    const top = row.offsetTop - el.clientHeight * 0.3;
    el.scrollTo({ top: Math.max(0, top), behavior: first.current || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    first.current = false;
  }, [active, state.status]);

  const hold = () => (holdUntil.current = Date.now() + 4000);

  return (
    <div className={`fp-ly-scroll ${className ?? ''}`} ref={box} role="region" aria-label="Lyrics" onTouchStart={hold} onWheel={hold} onTouchMove={hold}>
      {state.status === 'loading' && <p className="fp-ly-note">Looking for lyrics…</p>}
      {state.status === 'none' && <p className="fp-ly-note">No lyrics found for this track.</p>}
      {state.status === 'error' && (
        <p className="fp-ly-note">
          Couldn’t reach the lyrics service (it may be busy). <button className="fp-edit" onClick={onRetry}>Try again</button>
        </p>
      )}
      {state.status === 'ready' && (
        <ol className={synced ? 'synced' : undefined}>
          {synced && (
            <li className={`dots ${active < 0 ? 'now' : ''}`} data-now={active < 0} aria-hidden>
              <i /><i /><i />
            </li>
          )}
          {lines.map((l, i) => {
            const d = Math.abs(i - active);
            return (
              <li
                key={i}
                data-now={synced && i === active}
                data-far={synced && d > 2 ? 'true' : undefined}
                className={`${synced ? (i === active ? 'now' : i < active ? 'past' : '') : ''} ${l.text ? '' : 'gap'}`}
                onClick={synced && l.at != null ? () => { holdUntil.current = 0; if (audioCtl.el) audioCtl.el.currentTime = l.at as number; } : undefined}
              >
                {l.text || '♪'}
              </li>
            );
          })}
        </ol>
      )}
      {state.status === 'ready' && <p className="fp-ly-credit">Lyrics from LRCLIB</p>}
    </div>
  );
}

/** Upright screens: the lyrics take the place of the player's body, under a small header, with a bar and the main buttons below. */
export function LyricsView({ state, onRetry, time, duration, art, title, artist, playing }: { state: LyricsState; onRetry: () => void; time: number; duration: number; art: string; title: string; artist: string | null; playing: boolean }) {
  const p = usePlayer.getState();
  return (
    <div className="fp-lyrics np">
      <div className="fp-ly-head">
        <img src={art} alt="" />
        <span>
          <strong>{title}</strong>
          <span>{artist ?? 'Unknown artist'}</span>
        </span>
      </div>
      <LyricsScroll state={state} time={time} onRetry={onRetry} />
      <div className="fp-ly-bar">
        <input
          className="fp-seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.5}
          value={Math.min(time, duration || 0)}
          aria-label="Position"
          style={{ ['--p' as string]: `${duration > 0 ? Math.min(100, (time / duration) * 100) : 0}%` }}
          onChange={(e) => { if (audioCtl.el) audioCtl.el.currentTime = parseFloat(e.target.value); }}
        />
        <span>{fmtTime(time)}</span>
        <span>−{fmtTime(Math.max(0, duration - time))}</span>
      </div>
      <div className="fp-ly-foot">
        <button className="fp-icon big" onClick={() => p.prev()} aria-label="Previous track">
          <Icon name="prev" size={26} />
        </button>
        <button className="fp-play small" onClick={() => p.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} size={26} />
        </button>
        <button className="fp-icon big" onClick={() => p.next()} aria-label="Next track">
          <Icon name="next" size={26} />
        </button>
      </div>
    </div>
  );
}
