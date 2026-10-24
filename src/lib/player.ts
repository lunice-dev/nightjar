import { create } from 'zustand';
import type { Track } from '../api/library';
import { useStore } from '../store';

/**
 * Playing music from the computer's library and downloads, in Nightjar's window or on a
 * phone. The queue is the album (or tracks) you chose; the <audio> element lives in the
 * Player bar.
 */

export interface QueueItem extends Track {
  /** The album's folder, for its cover. */
  dir: string;
}

interface PlayerState {
  queue: QueueItem[];
  index: number;
  /**
   * Whether music is coming out right now. Only the <audio> element sets this (its play and pause
   * events): the page, the lock screen and headphones all act on that one element, so they can't disagree.
   */
  playing: boolean;
  /** Use less mobile data: lossless files come as 128 kbit/s AAC copies made by the computer. */
  dataSaver: boolean;
  /** Set when the current track had to be converted because this device couldn't play the original. */
  converted: boolean;
  loading: boolean;
  playAlbum(dir: string, start?: number): Promise<void>;
  playQueue(items: QueueItem[], start?: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  prev(): void;
  jump(i: number): void;
  stop(): void;
  setDataSaver(on: boolean): void;
}

const SAVER_KEY = 'nightjar.dataSaver';

/** The one <audio> element (the Player bar hands it over) and whether a new track should start playing. */
export const audioCtl = {
  el: null as HTMLAudioElement | null,
  /** Play the next track that loads: set by every "play this" action, cleared by pause and stop. */
  wantPlay: false,
};

const startEl = () => {
  const el = audioCtl.el;
  if (el?.src) el.play().catch(() => undefined);
};

export const usePlayer = create<PlayerState>((set, get) => ({
  queue: [],
  index: 0,
  playing: false,
  dataSaver: (() => {
    try {
      return localStorage.getItem(SAVER_KEY) === '1';
    } catch {
      return false;
    }
  })(),
  converted: false,
  loading: false,

  async playAlbum(dir, start = 0) {
    const { backend, toast } = useStore.getState();
    if (!backend) return;
    set({ loading: true });
    const album = await backend.library.tracks(dir);
    set({ loading: false });
    if (!album || album.tracks.length === 0) {
      toast('Couldn’t find music to play in that folder.', 'error');
      return;
    }
    get().playQueue(album.tracks.map((t) => ({ ...t, dir: album.dir })), start);
  },

  playQueue(items, start = 0) {
    if (items.length === 0) return;
    audioCtl.wantPlay = true;
    set({ queue: items, index: Math.max(0, Math.min(start, items.length - 1)), converted: false });
  },

  play() {
    audioCtl.wantPlay = true;
    startEl();
  },

  pause() {
    audioCtl.wantPlay = false;
    audioCtl.el?.pause();
  },

  toggle() {
    const el = audioCtl.el;
    if (!get().queue.length || !el) return;
    if (el.paused) get().play();
    else get().pause();
  },

  next() {
    const { index, queue } = get();
    if (index + 1 >= queue.length) return;
    audioCtl.wantPlay = true;
    set({ index: index + 1, converted: false });
  },

  prev() {
    const { index } = get();
    const el = audioCtl.el;
    // A few seconds in, "previous" goes back to the start of the track, like every music player.
    if (el && (el.currentTime > 3 || index === 0)) {
      el.currentTime = 0;
      get().play();
      return;
    }
    audioCtl.wantPlay = true;
    set({ index: index - 1, converted: false });
  },

  jump(i) {
    const el = audioCtl.el;
    if (i === get().index && el) {
      el.currentTime = 0;
      get().play();
      return;
    }
    audioCtl.wantPlay = true;
    set({ index: i, converted: false });
  },

  stop() {
    audioCtl.wantPlay = false;
    const el = audioCtl.el;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    set({ queue: [], index: 0, playing: false, converted: false });
  },

  setDataSaver(on) {
    try {
      localStorage.setItem(SAVER_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
    // The track reloads as the other kind of copy: keep playing if it was.
    if (audioCtl.el && !audioCtl.el.paused) audioCtl.wantPlay = true;
    set({ dataSaver: on });
  },
}));

/** Lossless formats the computer can turn into AAC copies. */
export const convertible = (t: Track) => ['flac', 'wav', 'aif', 'aiff'].includes(t.format);

/** What to ask the computer for: the original, or an AAC copy (and at what bitrate). */
export function streamChoice(t: Track, dataSaver: boolean, failedOriginal: boolean): number | undefined {
  if (!convertible(t)) return undefined;
  if (dataSaver) return 128;
  if (failedOriginal) return 256;
  return undefined;
}

export const fmtTime = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};

/** What the file on the computer is, in words: "FLAC · 24-bit / 96 kHz · lossless, hi-res". */
export function sourceQuality(t: Track) {
  const fmt = t.format.toUpperCase();
  const lossless = ['flac', 'wav', 'aif', 'aiff', 'alac'].includes(t.format) || (t.format === 'm4a' && t.bits > 0);
  const khz = t.rate ? `${+(t.rate / 1000).toFixed(1)} kHz` : '';
  if (!lossless) {
    const kbps = t.kbps ? `${t.kbps} kbit/s` : '';
    return { lossless, short: [fmt, t.kbps ? `${t.kbps}` : ''].filter(Boolean).join(' '), long: [fmt, kbps, khz, 'lossy'].filter(Boolean).join(' · ') };
  }
  const hires = t.bits > 16 || t.rate > 48000;
  const depth = t.bits ? `${t.bits}-bit` : '';
  return {
    lossless,
    short: `${fmt} ${t.bits || ''}${t.bits && t.rate ? '/' : ''}${t.rate ? +(t.rate / 1000).toFixed(1) : ''}`.trim(),
    long: [fmt, [depth, khz].filter(Boolean).join(' / '), hires ? 'lossless, hi-res' : 'lossless'].filter(Boolean).join(' · '),
  };
}
