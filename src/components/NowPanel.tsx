import { useEffect, useRef, useState } from 'react';
import { audioCtl, fmtTime, sourceQuality, trackTier, usePlayer } from '../lib/player';
import { Cover } from './Cover';
import { Icon } from './Icon';

/** What's playing as the page's clock sees it: whole seconds, from the <audio> element. */
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

/** Three thin bars beside the playing track; they only move while the music does. */
export function EqBars({ on }: { on: boolean }) {
  return (
    <i className={`eq${on ? ' on' : ''}`} aria-hidden>
      <u />
      <u />
      <u />
    </i>
  );
}

/** The whole queue: tracks played, the one playing, and what comes next. A click plays that track. */
function Tracklist() {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    list.current?.querySelector('li.cur')?.scrollIntoView({ block: 'nearest' });
  }, [index, queue.length]);
  if (queue.length === 0) return null;
  return (
    <div className="np-list">
      <h3>
        Tracklist · {queue.length} {queue.length === 1 ? 'track' : 'tracks'}
      </h3>
      <ol ref={list}>
        {queue.map((q, i) => (
          <li key={q.qid} className={i === index ? 'cur' : i < index ? 'played' : ''}>
            <button onClick={() => usePlayer.getState().jump(i)} title="Play this one now">
              <span>{i === index ? <EqBars on={playing} /> : i + 1}</span>
              <b>{q.title}</b>
              <span>{q.seconds ? fmtTime(q.seconds) : ''}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Repeat, Shuffle, Use less data and the sleep timer: the things that aren't needed every minute, behind one "…". */
function MoreMenu() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const dataSaver = usePlayer((s) => s.dataSaver);
  const sleep = usePlayer((s) => s.sleep);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const p = usePlayer.getState();
  const sleepNow = !sleep ? 'Off' : 'track' in sleep ? 'End of track' : `${Math.max(1, Math.ceil((sleep.at - Date.now()) / 60000))} min`;
  const nextSleep = () => {
    const steps: (number | 'track' | null)[] = [null, 15, 30, 45, 60, 'track'];
    const now = !sleep ? null : 'track' in sleep ? 'track' : steps.find((s) => typeof s === 'number' && s >= Math.ceil((sleep.at - Date.now()) / 60000)) ?? 60;
    p.setSleep(steps[(steps.indexOf(now) + 1) % steps.length] as never);
  };
  return (
    <div className="np-more" ref={wrap}>
      <button className={`np-icon${repeat !== 'off' || shuffle || dataSaver || sleep ? ' on' : ''}`} onClick={() => setOpen((o) => !o)} aria-label="More: repeat, shuffle, less data, sleep timer" aria-haspopup="menu" aria-expanded={open}>
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div className="np-menu" role="menu">
          <button role="menuitem" onClick={() => p.cycleRepeat()}>
            Repeat <span>{repeat === 'off' ? 'Off' : repeat === 'all' ? 'The queue' : 'This track'}</span>
          </button>
          <button role="menuitem" onClick={() => p.setShuffle(!shuffle)}>
            Shuffle <span>{shuffle ? 'On' : 'Off'}</span>
          </button>
          <button role="menuitem" onClick={() => p.setDataSaver(!dataSaver)} title="Lossless files come as smaller AAC copies made by your computer">
            Use less data <span>{dataSaver ? 'On' : 'Off'}</span>
          </button>
          <button role="menuitem" onClick={nextSleep}>
            Sleep timer <span>{sleepNow}</span>
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * What's playing, in one place for the whole app. As the docked panel on a computer (variant "dock"): cover, names,
 * quality, position, controls and the whole tracklist. As the card at the top of Home on a phone or tablet
 * (variant "card"): a compact version of the same thing.
 */
export function NowPanel({ variant }: { variant: 'dock' | 'card' }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const playing = usePlayer((s) => s.playing);
  const repeat = usePlayer((s) => s.repeat);
  const t = queue[index];
  const { t: pos, d } = useProgress(t?.seconds ?? 0);
  // While the position handle is being dragged it shows where it is; the music jumps when it's let go.
  const [drag, setDrag] = useState<number | null>(null);
  const seekTo = () => {
    if (drag !== null && audioCtl.el) audioCtl.el.currentTime = drag;
    setDrag(null);
  };
  const openFull = () => usePlayer.getState().setExpanded(true);

  if (!t) {
    return variant === 'dock' ? (
      <div className="nowp np-idle">
        <h2 className="np-title">Nothing playing</h2>
        <p className="np-by">Pick an album. It plays here, and the page takes its colours from the cover.</p>
      </div>
    ) : (
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
  const shown = drag ?? pos;
  const seek = (
    <input
      className="hx-seek"
      type="range"
      min={0}
      max={d || 0}
      step={1}
      value={Math.min(shown, d || 0)}
      aria-label="Position"
      style={{ ['--p' as string]: `${d ? Math.min(100, (shown / d) * 100) : 0}%` }}
      onChange={(e) => setDrag(Number(e.target.value))}
      onPointerUp={seekTo}
      onKeyUp={seekTo}
      onBlur={seekTo}
    />
  );
  const controls = (
    <>
      <button onClick={() => usePlayer.getState().prev()} aria-label="Previous track" title="Previous track">
        <Icon name="prev" size={20} />
      </button>
      <button className="go" onClick={() => usePlayer.getState().toggle()} aria-label={playing ? 'Pause' : 'Play'}>
        <Icon name={playing ? 'pause' : 'play'} size={22} />
      </button>
      <button onClick={() => usePlayer.getState().next()} disabled={index + 1 >= queue.length && repeat !== 'all'} aria-label="Next track" title="Next track">
        <Icon name="next" size={20} />
      </button>
    </>
  );

  if (variant === 'dock') {
    return (
      <div className="nowp">
        <div className="np-head">
          <button className="np-cover" onClick={openFull} aria-label="Open the large player" title="Open the large player">
            <Cover className="np-cover-img" dir={t.dir} artist={t.artist ?? undefined} album={t.album ?? undefined} seed={t.dir} />
          </button>
          <h2 className="np-title" title={t.title}>
            {t.title}
          </h2>
          <p className="np-by">{[t.artist, t.album].filter(Boolean).join(' · ')}</p>
          <p className="np-q">
            <span className={`np-tier t-${trackTier(t)}`}>{q.short}</span>
            <span>
              Track {index + 1} of {queue.length}
            </span>
          </p>
          <div className="np-seek">
            <span>{fmtTime(shown)}</span>
            {seek}
            <span>{d ? fmtTime(d) : ''}</span>
          </div>
          <div className="np-ctl">
            <div className="hx-ctl">{controls}</div>
            <MoreMenu />
          </div>
        </div>
        <Tracklist />
      </div>
    );
  }

  return (
    <aside className="hx-now" aria-label="Now playing">
      <button className="hx-now-art" onClick={openFull} aria-label="Open the player">
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
        {seek}
        <div className="hx-times">
          <span>{fmtTime(shown)}</span>
          <span>{d ? fmtTime(d) : ''}</span>
        </div>
      </div>
      <div className="hx-ctl">{controls}</div>
      <div className="hx-nextbox">
        <Tracklist />
      </div>
    </aside>
  );
}
