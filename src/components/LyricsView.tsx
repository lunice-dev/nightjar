import { audioCtl, fmtTime, usePlayer } from '../lib/player';
import type { LyricsState } from '../lib/lyrics';
import { Icon } from './Icon';

/** The lyrics as plain, readable text in a scrolling area. */
export function LyricsScroll({ state, onRetry, className }: { state: LyricsState; onRetry: () => void; className?: string }) {
  const lines = state.status === 'ready' ? state.lyrics.lines : [];
  return (
    <div className={`fp-ly-scroll ${className ?? ''}`} role="region" aria-label="Lyrics">
      {state.status === 'loading' && <p className="fp-ly-note">Looking for lyrics…</p>}
      {state.status === 'none' && <p className="fp-ly-note">No lyrics found for this track.</p>}
      {state.status === 'error' && (
        <p className="fp-ly-note">
          Couldn’t reach the lyrics service{state.why ? ` (${state.why})` : ''}. <button className="fp-edit" onClick={onRetry}>Try again</button>
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <ol>
            {lines.map((l, i) => (
              <li key={i} className={l.text ? undefined : 'gap'}>
                {l.text}
              </li>
            ))}
          </ol>
          <p className="fp-ly-credit">Lyrics from LRCLIB</p>
        </>
      )}
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
      <LyricsScroll state={state} onRetry={onRetry} />
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
