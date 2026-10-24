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
  playing: boolean;
  /** Use less mobile data: lossless files come as 128 kbit/s AAC copies made by the computer. */
  dataSaver: boolean;
  /** Set when the current track had to be converted because this device couldn't play the original. */
  converted: boolean;
  loading: boolean;
  playAlbum(dir: string, start?: number): Promise<void>;
  playQueue(items: QueueItem[], start?: number): void;
  toggle(): void;
  next(): void;
  prev(): void;
  jump(i: number): void;
  stop(): void;
  setDataSaver(on: boolean): void;
}

const SAVER_KEY = 'nightjar.dataSaver';

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
    set({ queue: items, index: Math.max(0, Math.min(start, items.length - 1)), playing: true, converted: false });
  },

  toggle() {
    if (get().queue.length) set({ playing: !get().playing });
  },

  next() {
    const { index, queue } = get();
    if (index + 1 < queue.length) set({ index: index + 1, playing: true, converted: false });
    else set({ playing: false });
  },

  prev() {
    const { index } = get();
    set({ index: Math.max(0, index - 1), playing: true, converted: false });
  },

  jump(i) {
    set({ index: i, playing: true, converted: false });
  },

  stop() {
    set({ queue: [], index: 0, playing: false, converted: false });
  },

  setDataSaver(on) {
    try {
      localStorage.setItem(SAVER_KEY, on ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
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
