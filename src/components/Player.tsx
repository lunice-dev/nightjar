import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { fmtTime, sourceQuality, streamChoice, usePlayer, type QueueItem } from '../lib/player';
import { isIos } from '../api/remote';
import { Icon } from './Icon';
import { generatedCover, onlineCover } from '../lib/covers';

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
  const { queue, index, playing, dataSaver, converted } = usePlayer();
  const audio = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [cover, setCover] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const track = queue[index];

  // Load the current track: the original file, or the computer's AAC copy when asked for (or needed).
  useEffect(() => {
    const el = audio.current;
    if (!el || !track || !backend) return;
    let alive = true;
    const kbps = streamChoice(track, dataSaver, converted);
    setWaiting(true);
    backend.files.streamUrl(track.path, kbps).then((url) => {
      if (!alive) return;
      if (!url) {
        toast('Playing needs the Nightjar app on your computer.', 'error');
        usePlayer.getState().stop();
        return;
      }
      el.src = url;
      setTime(0);
      setDuration(track.seconds || 0);
      if (usePlayer.getState().playing) el.play().catch(() => usePlayer.setState({ playing: false }));
    });
    return () => {
      alive = false;
    };
  }, [track?.path, dataSaver, converted, backend, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // Play / pause follows the store.
  useEffect(() => {
    const el = audio.current;
    if (!el || !el.src) return;
    if (playing && el.paused) el.play().catch(() => usePlayer.setState({ playing: false }));
    if (!playing && !el.paused) el.pause();
  }, [playing]);

  // The album's cover, for the bar and the lock screen: the picture on the computer (a file in the
  // folder, or the art inside the music files), else the Cover Art Archive. Nothing found: a generated one in the bar only.
  useEffect(() => {
    if (!track || !backend) return;
    let alive = true;
    setCover(null);
    (async () => {
      const local = await backend.files.coverUrl(track.dir).catch(() => null);
      if (local && (await loads(local))) return alive && setCover(local);
      const web = await onlineCover(track.artist ?? undefined, track.album ?? undefined).catch(() => null);
      if (web && (await loads(web))) return alive && setCover(web);
    })();
    return () => {
      alive = false;
    };
  }, [track?.dir, backend]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lock screen and headphone controls.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !track) return;
    const ms = navigator.mediaSession;
    ms.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist ?? '',
      album: track.album ?? '',
      artwork: cover ? [{ src: new URL(cover, location.href).href, sizes: '512x512' }] : [],
    });
    const p = usePlayer.getState;
    ms.setActionHandler('play', () => usePlayer.setState({ playing: true }));
    ms.setActionHandler('pause', () => usePlayer.setState({ playing: false }));
    ms.setActionHandler('nexttrack', () => p().next());
    ms.setActionHandler('previoustrack', () => p().prev());
    try {
      ms.setActionHandler('seekto', (d) => {
        if (audio.current && d.seekTime != null) audio.current.currentTime = d.seekTime;
      });
    } catch {
      /* not supported here */
    }
  }, [track, cover]);

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = track ? (playing ? 'playing' : 'paused') : 'none';
  }, [playing, track]);

  // Halfway through, ask the computer to get the next track ready (an AAC copy takes a few seconds to make).
  const warmed = useRef('');
  useEffect(() => {
    const nextTrack = queue[index + 1];
    if (!nextTrack || !backend || duration <= 0 || time < duration / 2 || warmed.current === nextTrack.path) return;
    warmed.current = nextTrack.path;
    const kbps = streamChoice(nextTrack, dataSaver, false);
    if (!kbps) return;
    backend.files.streamUrl(nextTrack.path, kbps).then((url) => {
      if (url) fetch(url, { headers: { Range: 'bytes=0-1' } }).catch(() => undefined);
    });
  }, [time, duration, queue, index, backend, dataSaver]);

  if (!track) return <audio ref={audio} hidden />;

  const onError = () => {
    // An original this device can't play (some hi-res files on iPhones): ask for an AAC copy instead.
    if (!converted && !dataSaver && ['flac', 'wav', 'aif', 'aiff'].includes(track.format)) {
      usePlayer.setState({ converted: true });
      return;
    }
    toast(`Couldn’t play ${track.title}.`, 'error');
    usePlayer.getState().next();
  };

  const p = usePlayer.getState();
  const progress = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;

  return (
    <div className={`player ${open ? 'open' : ''}`} role="region" aria-label="Now playing">
      <audio
        ref={audio}
        preload="auto"
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        onEnded={() => p.next()}
        onError={onError}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onPause={() => usePlayer.getState().playing && !audio.current?.ended && usePlayer.setState({ playing: false })}
        onPlay={() => !usePlayer.getState().playing && usePlayer.setState({ playing: true })}
      />
      <div className="player-bar">
        <button className="player-art" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Hide the queue' : 'Show the queue'}>
          <img src={cover ?? generatedCover(track.dir)} alt="" />
        </button>
        <button className="player-text" onClick={() => setOpen((o) => !o)}>
          <strong>{track.title}</strong>
          <span>
            <QualityChip />
            {[track.artist, track.album].filter(Boolean).join(' · ')}
            {waiting && playing ? ' · loading…' : ''}
          </span>
        </button>
        <div className="player-controls">
          <button className="player-btn hide-narrow" onClick={() => p.prev()} disabled={index === 0} aria-label="Previous track">
            <Icon name="prev" size={20} />
          </button>
          <button className="player-btn main" onClick={() => p.toggle()} aria-label={playing ? 'Pause' : 'Play'}>
            <Icon name={playing ? 'pause' : 'play'} size={22} />
          </button>
          <button className="player-btn" onClick={() => p.next()} disabled={index + 1 >= queue.length} aria-label="Next track">
            <Icon name="next" size={20} />
          </button>
        </div>
        <span className="player-time hide-narrow">
          {fmtTime(time)} / {fmtTime(duration)}
        </span>
        <button className="player-btn close" onClick={() => p.stop()} aria-label="Stop and close the player">
          <Icon name="close" size={16} />
        </button>
        <input
          className="player-seek"
          type="range"
          min={0}
          max={duration || 0}
          step={1}
          value={Math.min(time, duration || 0)}
          aria-label="Position"
          style={{ ['--p' as string]: `${progress}%` }}
          onChange={(e) => {
            if (audio.current) audio.current.currentTime = Number(e.target.value);
          }}
        />
      </div>
      {open && (
        <div className="player-queue">
          <div className="player-queue-head">
            <strong>{track.album ?? 'Playing'}</strong>
            <label className="toggle" title="Lossless files come as smaller AAC copies made by your computer">
              <input type="checkbox" checked={dataSaver} onChange={(e) => p.setDataSaver(e.target.checked)} />
              Use less data
            </label>
          </div>
          <QualityInfo />
          <ol>
            {queue.map((t, i) => (
              <li key={t.path} aria-current={i === index ? 'true' : undefined}>
                <button onClick={() => p.jump(i)}>
                  <span className="n">{t.no || i + 1}</span>
                  <span className="t">{t.title}</span>
                  <span className="d">{fmtTime(t.seconds)}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** What is being sent right now: the original file, or an AAC copy made by the computer (and why). */
function sending(t: QueueItem, dataSaver: boolean, converted: boolean) {
  const kbps = streamChoice(t, dataSaver, converted);
  if (!kbps) return { label: t.format === 'mp3' ? 'the original MP3' : `the original ${t.format.toUpperCase()} file`, aac: 0 };
  return { label: `an AAC copy at ${kbps} kbit/s`, aac: kbps };
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
