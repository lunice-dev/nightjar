import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { audioCtl, canSetVolume, fmtTime, sourceQuality, streamChoice, usePlayer, type QueueItem } from '../lib/player';
import { isIos } from '../api/remote';
import { Icon } from './Icon';
import { FullPlayer, morph } from './FullPlayer';
import { useScrub } from '../lib/scrub';
import { useHoldToScan, useSeekKeys } from '../lib/seek';
import { generatedCover, onlineCover } from '../lib/covers';

/**
 * Tells the lock screen exactly where the song is, at the moments its own guess would drift: a new track,
 * play, pause and every seek. Between those it moves the bar on by itself.
 */
function reportPosition(el: HTMLAudioElement) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  const duration = el.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration, playbackRate: el.playbackRate || 1, position: Math.min(Math.max(0, el.currentTime), duration) });
  } catch {
    /* an odd moment while a track changes: the next report fixes it */
  }
}

/** Whether a picture really loads (a missing cover answers 404). */
const loads = (src: string) =>
  new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = src;
    setTimeout(() => resolve(false), 8000);
  });

/**
 * The "now playing" bar: one <audio> element for the whole app, its controls, the queue,
 * and the lock-screen controls (Media Session) on phones.
 */
export function Player() {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const { queue, index, playing, dataSaver, converted, expanded } = usePlayer();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [cover, setCover] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const track = queue[index];

  // The element is always there (also with nothing playing), so every control can reach it.
  useEffect(() => {
    audioCtl.el = audio.current;
    if (audio.current && canSetVolume) audio.current.volume = usePlayer.getState().volume;
    return () => {
      audioCtl.el = null;
    };
  }, []);

  // A new track starts at 0 (its file may already be in the element: buttons load it at once).
  useEffect(() => {
    setTime(audio.current?.currentTime ?? 0);
    setDuration(track?.seconds || 0);
  }, [track?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadedPath = useRef('');
  // Load the current track: the original file, or the computer's AAC copy when asked for (or needed).
  useEffect(() => {
    const el = audio.current;
    if (!el || !track || !backend) return;
    let alive = true;
    const as = streamChoice(track, dataSaver, converted);
    setWaiting(true);
    backend.files.streamUrl(track.path, as).then((url) => {
      if (!alive) return;
      if (!url) {
        toast('Playing needs the Nightjar app on your computer.', 'error');
        usePlayer.getState().stop();
        return;
      }
      if (el.src !== url) {
        // The same track as another kind of copy ("Use less data" switched): carry on from the same moment.
        const resumeAt = loadedPath.current === track.path && el.currentTime > 1 ? el.currentTime : 0;
        el.src = url;
        if (resumeAt) el.addEventListener('loadedmetadata', () => (el.currentTime = resumeAt), { once: true });
      }
      loadedPath.current = track.path;
      if (audioCtl.wantPlay) el.play().catch(() => setWaiting(false));
    });
    return () => {
      alive = false;
    };
  }, [track?.path, dataSaver, converted, backend, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // The album's cover, for the bar and the lock screen: the picture on the computer (a file in the
  // folder, or the art inside the music files), else the Cover Art Archive. Nothing found: a generated one in the bar only.
  useEffect(() => {
    if (!track || !backend) return;
    let alive = true;
    setCover(null);
    (async () => {
      const local = await backend.files.coverUrl(track.dir, 1000).catch(() => null);
      if (local && (await loads(local))) return alive && setCover(local);
      const web = await onlineCover(track.artist ?? undefined, track.album ?? undefined).catch(() => null);
      if (web && (await loads(web))) return alive && setCover(web);
    })();
    return () => {
      alive = false;
    };
  }, [track?.dir, backend]); // eslint-disable-line react-hooks/exhaustive-deps

  // What the lock screen shows, and its buttons. The info changes only when the track or its cover really
  // changes, so it doesn't blink; the buttons are handed over again with it, as iOS expects (without them it
  // falls back to ±10 s). Each button acts on the element through the same actions as the page.
  const shown = useRef('');
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    if (!track) {
      ms.metadata = null;
      shown.current = '';
      return;
    }
    const art = cover ? new URL(cover, location.href).href : '';
    const key = `${track.path}|${art}`;
    if (shown.current === key) return;
    shown.current = key;
    ms.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist ?? '',
      album: track.album ?? '',
      artwork: art ? [{ src: art, sizes: '512x512' }] : [],
    });
    const p = usePlayer.getState;
    const set = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* not supported here */
      }
    };
    set('play', () => p().play());
    set('pause', () => p().pause());
    set('nexttrack', () => p().next());
    set('previoustrack', () => p().prev());
    set('seekto', (d) => {
      const el = audio.current;
      if (!el || d.seekTime == null) return;
      if (d.fastSeek && 'fastSeek' in el) el.fastSeek(d.seekTime);
      else el.currentTime = d.seekTime;
      reportPosition(el);
    });
  }, [track, cover]);

  // A few seconds in, ask the computer to get the next AAC copy ready (it takes a few seconds to make), so
  // skipping ahead or reaching the end never waits on it.
  const warmed = useRef('');
  useEffect(() => {
    const nextTrack = queue[index + 1];
    if (!nextTrack || !backend || time < 3 || warmed.current === nextTrack.path) return;
    warmed.current = nextTrack.path;
    const as = streamChoice(nextTrack, dataSaver, false);
    if (!as.aac) return;
    backend.files.streamUrl(nextTrack.path, as).then((url) => {
      if (url) fetch(url, { headers: { Range: 'bytes=0-1' } }).catch(() => undefined);
    });
  }, [time, queue, index, backend, dataSaver]);

  const onError = () => {
    if (!track || !audio.current?.getAttribute('src')) return;
    // An original this device can't play (some hi-res files on iPhones): ask for an AAC copy instead.
    if (!converted && !dataSaver && ['flac', 'wav', 'aif', 'aiff'].includes(track.format)) {
      audioCtl.wantPlay = true;
      usePlayer.setState({ converted: true });
      return;
    }
    toast(`Couldn’t play ${track.title}.`, 'error');
    usePlayer.getState().next();
  };

  const element = (
    <audio
      ref={(el) => {
        audio.current = el;
        if (el) audioCtl.el = el;
      }}
      preload="auto"
      onTimeUpdate={(e) => {
        setTime(e.currentTarget.currentTime);
        usePlayer.getState().checkSleep();
      }}
      onDurationChange={(e) => {
        if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
        reportPosition(e.currentTarget);
      }}
      onEnded={() => usePlayer.getState().ended()}
      onError={onError}
      onWaiting={() => setWaiting(true)}
      onPlaying={() => setWaiting(false)}
      onCanPlay={() => setWaiting(false)}
      onPlay={(e) => {
        usePlayer.setState({ playing: true });
        reportPosition(e.currentTarget);
      }}
      onPause={(e) => {
        usePlayer.setState({ playing: false });
        reportPosition(e.currentTarget);
      }}
      onLoadedMetadata={(e) => reportPosition(e.currentTarget)}
      onSeeked={(e) => reportPosition(e.currentTarget)}
      onRateChange={(e) => reportPosition(e.currentTarget)}
    />
  );

  const scrub = useScrub(time, duration, (t) => {
    if (audio.current) audio.current.currentTime = t;
  });
  useSeekKeys(!!track);
  const back = useHoldToScan(-1, () => usePlayer.getState().prev());
  // On the last track, next stays usable for fast-forwarding; a tap there does nothing (unless the queue repeats).
  const ahead = useHoldToScan(1, () => {
    const s = usePlayer.getState();
    if (s.index + 1 < s.queue.length || s.repeat === 'all') s.next();
  });

  // The same tree with or without a track, so the <audio> element is never replaced.
  if (!track)
    return (
      <>
        <div hidden>{element}</div>
        {expanded && <FullPlayer cover={null} time={0} duration={0} waiting={false} quality={null} chip={null} />}
      </>
    );

  const p = usePlayer.getState();
  const progress = duration > 0 ? Math.min(100, (scrub.shown / duration) * 100) : 0;
  // The large player's art grows out of this cover, so say where the cover is.
  const openLarge = () => {
    morph.rect = document.querySelector('.player-art')?.getBoundingClientRect() ?? null;
    p.setExpanded(true);
  };

  return (
    <>
    <div className="player" role="region" aria-label="Now playing">
      {element}
      <div className="player-bar">
        <button className="player-art" onClick={openLarge} aria-label="Open the player">
          <img src={cover ?? generatedCover(track.dir)} alt="" />
        </button>
        <button className="player-text" onClick={openLarge}>
          <strong>{track.title}</strong>
          <span>
            <QualityChip />
            {[track.artist, track.album].filter(Boolean).join(' · ')}
            {waiting && audioCtl.wantPlay ? ' · loading…' : ''}
          </span>
        </button>
        <div className="player-controls">
          <button className={`player-btn scan hide-narrow ${back.scanning ? 'on' : ''}`} {...back.props} aria-label="Previous track" title="Previous track (hold to rewind)">
            <Icon name="prev" size={20} />
          </button>
          <button className="player-btn main" onClick={() => p.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} size={22} />
          </button>
          <button
            className={`player-btn scan ${ahead.scanning ? 'on' : ''}`}
            {...ahead.props}
            disabled={index + 1 >= queue.length && usePlayer.getState().repeat !== 'all' && duration <= 0}
            aria-label="Next track"
            title="Next track (hold to fast-forward)"
          >
            <Icon name="next" size={20} />
          </button>
        </div>
        <span className="player-time hide-narrow">
          {fmtTime(scrub.shown)} / {fmtTime(duration)}
        </span>
        <button className="player-btn close" onClick={() => p.stop()} aria-label="Stop and close the player">
          <Icon name="close" size={16} />
        </button>
        <div className="player-seek-wrap" {...scrub.wrap}>
          {scrub.drag && (
            <span className="seek-bubble" style={{ left: `${progress}%` }}>
              {fmtTime(scrub.shown)}
              {scrub.drag.label && <small>{scrub.drag.label}</small>}
            </span>
          )}
          <input
            className="player-seek"
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={Math.min(scrub.shown, duration || 0)}
            aria-label="Position"
            style={{ ['--p' as string]: `${progress}%` }}
            {...scrub.props}
          />
        </div>
      </div>
    </div>
      {expanded && <FullPlayer cover={cover} time={time} duration={duration} waiting={waiting} quality={<QualityInfo />} chip={<QualityChip />} />}
    </>
  );
}

/** What is being sent right now: the original file, or an AAC copy made by the computer (and why). */
function sending(t: QueueItem, dataSaver: boolean, converted: boolean) {
  const as = streamChoice(t, dataSaver, converted);
  if (as.pcm) return { label: 'the FLAC unpacked to WAV as it plays (Apple devices skip around in it reliably)', aac: 0 };
  if (!as.aac) return { label: t.format === 'mp3' ? 'the original MP3' : `the original ${t.format.toUpperCase()} file`, aac: 0 };
  return { label: `an AAC copy at ${as.aac} kbit/s`, aac: as.aac };
}

/** A short tag next to the track: what's coming from the computer. */
function QualityChip() {
  const { queue, index, dataSaver, converted } = usePlayer();
  const t = queue[index];
  if (!t) return null;
  const s = sending(t, dataSaver, converted);
  const src = sourceQuality(t);
  return <span className={`pq-chip ${s.aac ? 'aac' : src.lossless ? 'lossless' : ''}`}>{s.aac ? `AAC ${s.aac}` : src.short}</span>;
}

/**
 * The whole chain, from the file on the computer to your ears, so you know where the quality goes:
 * the file itself, what Nightjar sends, what the phone can do, and what Bluetooth headphones receive.
 */
function QualityInfo() {
  const { queue, index, dataSaver, converted } = usePlayer();
  const t = queue[index];
  if (!t) return null;
  const src = sourceQuality(t);
  const s = sending(t, dataSaver, converted);
  const ios = isIos();
  const above48 = t.rate > 48000;
  return (
    <div className="pq">
      <dl>
        <dt>The file</dt>
        <dd>{src.long}</dd>
        <dt>Sent to this {ios ? 'phone' : 'device'}</dt>
        <dd>
          {s.label}
          {converted && !dataSaver ? ' (this device couldn’t play the original)' : dataSaver && s.aac ? ' (Use less data is on)' : src.lossless && !s.aac ? ', bit for bit' : ''}
        </dd>
        {ios && (
          <>
            <dt>iPhone</dt>
            <dd>{above48 && !s.aac ? `Plays up to 48 kHz by itself, so this ${t.rate / 1000} kHz file is converted down. Full hi-res needs a USB DAC (an adapter with its own converter).` : 'Plays this as it comes.'}</dd>
            <dt>AirPods / Bluetooth</dt>
            <dd>Bluetooth headphones get AAC at about 256 kbit/s, whatever the source: lossless ends at the phone. Wired headphones (or AirPods Max with the USB-C cable) keep it.</dd>
          </>
        )}
      </dl>
    </div>
  );
}
