import { useEffect, useMemo, useRef } from 'react';
import { activeLine, type LyricsState } from '../lib/lyrics';
import { audioCtl, usePlayer } from '../lib/player';
import { Icon } from './Icon';

/**
 * The lyrics, over the player's body. Synced lyrics scroll by themselves with the current line large and bright; the rest are
 * dimmed, and tapping a line jumps there. Scrolling by hand pauses the following for a few seconds.
 */
export function LyricsView({ state, time, art, title, artist, playing }: { state: LyricsState; time: number; art: string; title: string; artist: string | null; playing: boolean }) {
  const p = usePlayer.getState();
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
    const top = row.offsetTop - el.clientHeight * 0.32;
    el.scrollTo({ top: Math.max(0, top), behavior: first.current || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    first.current = false;
  }, [active, state.status]);

  const hold = () => (holdUntil.current = Date.now() + 4000);

  return (
    <div className="fp-lyrics np" role="region" aria-label="Lyrics">
      <div className="fp-ly-head">
        <img src={art} alt="" />
        <span>
          <strong>{title}</strong>
          <span>{artist ?? 'Unknown artist'}</span>
        </span>
      </div>
      <div className="fp-ly-scroll" ref={box} onTouchStart={hold} onWheel={hold} onTouchMove={hold}>
        {state.status === 'loading' && <p className="fp-ly-note">Looking for lyrics…</p>}
        {state.status === 'none' && <p className="fp-ly-note">No lyrics found for this track.</p>}
        {state.status === 'ready' && (
          <ol className={synced ? 'synced' : undefined}>
            {lines.map((l, i) => (
              <li
                key={i}
                data-now={synced && i === active}
                className={`${synced ? (i === active ? 'now' : i < active ? 'past' : '') : ''} ${l.text ? '' : 'gap'}`}
                onClick={synced && l.at != null ? () => { holdUntil.current = 0; if (audioCtl.el) audioCtl.el.currentTime = l.at as number; } : undefined}
              >
                {l.text || '♪'}
              </li>
            ))}
          </ol>
        )}
        {state.status === 'ready' && <p className="fp-ly-credit">Lyrics from LRCLIB</p>}
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
