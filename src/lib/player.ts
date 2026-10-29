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
  /** Tells apart the same track queued twice. */
  qid: string;
}

export type Repeat = 'off' | 'all' | 'one';
export type DrawerView = { kind: 'now' } | { kind: 'album'; dir: string } | { kind: 'playlist'; id: string };

let qn = 0;
export const toItems = (dir: string, tracks: Track[]): QueueItem[] => tracks.map((t) => ({ ...t, dir, qid: `q${++qn}` }));
/** Tracks that each know their own folder (a playlist mixes albums). */
export const toQueue = (tracks: (Track & { dir: string })[]): QueueItem[] => tracks.map((t) => ({ ...t, qid: `q${++qn}` }));

const shuffled = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

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
  /** The large player is open. */
  expanded: boolean;
  /** What the drawer shows: what's playing, an album, or a playlist. */
  view: DrawerView;
  /** Asks the open drawer to slide down and close (back button, swipe). */
  closeRequested: boolean;
  requestClose(): void;
  shuffle: boolean;
  repeat: Repeat;
  /** The queue in its own order, kept while shuffle is on so turning it off puts it back. */
  unshuffled: QueueItem[] | null;
  playAlbum(dir: string, start?: number): Promise<void>;
  playQueue(items: QueueItem[], start?: number): void;
  /** Adds an album right after the current track ("next") or at the end of the queue. */
  addAlbum(dir: string, where: 'next' | 'end'): Promise<void>;
  remove(qid: string): void;
  /** Moves a track that hasn't played yet to another place among the ones still to come (`to` is a queue position). */
  move(qid: string, to: number): void;
  setShuffle(on: boolean): void;
  cycleRepeat(): void;
  /** What happens when a track ends by itself. */
  ended(): void;
  setExpanded(open: boolean): void;
  /** Opens the drawer on an album (nothing starts playing). */
  openAlbum(dir: string): void;
  /** Tapping a cover: with nothing playing, plays the album and opens the player; otherwise opens the album's page so the queue isn't replaced. */
  openOrPlayAlbum(dir: string): Promise<void>;
  openPlaylist(id: string): void;
  /** Back to what's playing. */
  showNow(): void;
  /** Plays a list of tracks mixed up. */
  playShuffled(items: QueueItem[]): void;
  /** Puts tracks right after the current one ("next") or at the end of the queue. */
  addTracks(items: QueueItem[], where: 'next' | 'end'): void;
  play(): void;
  pause(): void;
  toggle(): void;
  next(): void;
  prev(): void;
  jump(i: number): void;
  stop(): void;
  setDataSaver(on: boolean): void;
  /** 0 to 1. Only some devices let a page change it (iPhones and iPads keep it on the side buttons). */
  volume: number;
  setVolume(v: number): void;
  /** Stops the music later: at a moment, or when the current track ends. */
  sleep: { at: number } | { track: true } | null;
  /** Minutes from now, "track" for the end of the current track, null to cancel. */
  setSleep(when: number | 'track' | null): void;
  /** Called as the music plays: stops it when the sleep timer is up (a timeout alone may not run on a locked phone). */
  checkSleep(): void;
}

const SAVER_KEY = 'nightjar.dataSaver';
const VOLUME_KEY = 'nightjar.volume';

/** Whether the page can change the volume. iPhones accept the value but ignore it (the side buttons rule), so no slider there. */
export const canSetVolume = (() => {
  try {
    if (/iPhone|iPod/.test(navigator.userAgent)) return false;
    const a = new Audio();
    a.volume = 0.5;
    return a.volume === 0.5;
  } catch {
    return false;
  }
})();

let sleepTimer: ReturnType<typeof setTimeout> | undefined;

/** The one <audio> element (the Player bar hands it over) and whether a new track should start playing. */
export const audioCtl = {
  el: null as HTMLAudioElement | null,
  /** Play the next track that loads: set by every "play this" action, cleared by pause and stop. */
  wantPlay: false,
};

/**
 * Puts a track in the element and starts it, in the same moment as the button press that asked for it
 * (iPhones only let a lock-screen button start sound from inside its own handler). When the address
 * isn't ready yet, the Player loads it a moment later instead.
 */
function loadNow(t: QueueItem | undefined, converted = false) {
  const el = audioCtl.el;
  const backend = useStore.getState().backend;
  if (!el || !t || !backend) return;
  const url = backend.files.streamUrlNow(t.path, streamChoice(t, usePlayer.getState().dataSaver, converted));
  if (!url) return;
  if (el.src !== url) el.src = url;
  if (audioCtl.wantPlay) el.play().catch(() => undefined);
}

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
  volume: (() => {
    try {
      const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '');
      return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    } catch {
      return 1;
    }
  })(),
  sleep: null,
  converted: false,
  loading: false,
  expanded: false,
  view: { kind: 'now' },
  closeRequested: false,
  shuffle: false,
  repeat: 'off',
  unshuffled: null,

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
    set({ shuffle: false, unshuffled: null });
    get().playQueue(toItems(album.dir, album.tracks), start);
  },

  async addAlbum(dir, where) {
    const { backend, toast } = useStore.getState();
    if (!backend) return;
    const album = await backend.library.tracks(dir);
    if (!album || album.tracks.length === 0) {
      toast('Couldn’t find music to play in that folder.', 'error');
      return;
    }
    const items = toItems(album.dir, album.tracks);
    const { queue, index, unshuffled } = get();
    if (queue.length === 0) {
      get().playQueue(items, 0);
      return;
    }
    const at = where === 'next' ? index + 1 : queue.length;
    set({
      queue: [...queue.slice(0, at), ...items, ...queue.slice(at)],
      unshuffled: unshuffled ? [...unshuffled, ...items] : null,
    });
    const name = album.tracks[0]?.album ?? 'The album';
    toast(where === 'next' ? `${name} plays next.` : `${name} added to the queue.`);
  },

  remove(qid) {
    const { queue, index, unshuffled } = get();
    const i = queue.findIndex((q) => q.qid === qid);
    if (i < 0) return;
    if (i === index) {
      // Removing what's playing: go on with the next one (or stop if it was the last).
      if (queue.length === 1) return get().stop();
      const rest = queue.filter((q) => q.qid !== qid);
      const ni = Math.min(i, rest.length - 1);
      const playing = !!audioCtl.el && !audioCtl.el.paused;
      audioCtl.wantPlay = playing;
      loadNow(rest[ni]);
      set({ queue: rest, index: ni, converted: false, unshuffled: unshuffled?.filter((q) => q.qid !== qid) ?? null });
      return;
    }
    set({
      queue: queue.filter((q) => q.qid !== qid),
      index: i < index ? index - 1 : index,
      unshuffled: unshuffled?.filter((q) => q.qid !== qid) ?? null,
    });
  },

  move(qid, to) {
    const { queue, index } = get();
    const from = queue.findIndex((q) => q.qid === qid);
    if (from <= index) return; // what has played, and what's playing now, stay where they are
    const at = Math.max(index + 1, Math.min(queue.length - 1, to));
    if (at === from) return;
    const next = queue.slice();
    const [item] = next.splice(from, 1);
    next.splice(at, 0, item);
    set({ queue: next });
  },

  setShuffle(on) {
    const { queue, index, unshuffled } = get();
    const current = queue[index];
    if (on) {
      // What has played stays; what's coming is mixed.
      set({ shuffle: true, unshuffled: queue, queue: [...queue.slice(0, index + 1), ...shuffled(queue.slice(index + 1))] });
    } else {
      const back = unshuffled ?? queue;
      const ni = current ? Math.max(0, back.findIndex((q) => q.qid === current.qid)) : 0;
      set({ shuffle: false, unshuffled: null, queue: back, index: ni });
    }
  },

  cycleRepeat() {
    const r = get().repeat;
    set({ repeat: r === 'off' ? 'all' : r === 'all' ? 'one' : 'off' });
  },

  ended() {
    const { repeat, index, queue, sleep } = get();
    const el = audioCtl.el;
    if (sleep && 'track' in sleep) {
      // "End of track": this was the track; stay on it, stopped.
      audioCtl.wantPlay = false;
      set({ sleep: null });
      return;
    }
    if (repeat === 'one' && el) {
      el.currentTime = 0;
      get().play();
      return;
    }
    if (index + 1 < queue.length || repeat === 'all') get().next();
    else audioCtl.wantPlay = false;
  },

  setExpanded(open) {
    set(open ? { expanded: true, closeRequested: false } : { expanded: false, view: { kind: 'now' }, closeRequested: false });
  },

  requestClose() {
    if (get().expanded) set({ closeRequested: true });
  },

  openAlbum(dir) {
    set({ expanded: true, closeRequested: false, view: { kind: 'album', dir } });
  },

  async openOrPlayAlbum(dir) {
    if (get().queue.length > 0) return get().openAlbum(dir);
    await get().playAlbum(dir);
    if (get().queue.length > 0) set({ expanded: true, closeRequested: false, view: { kind: 'now' } });
  },

  openPlaylist(id) {
    set({ expanded: true, closeRequested: false, view: { kind: 'playlist', id } });
  },

  showNow() {
    set({ view: { kind: 'now' } });
  },

  playShuffled(items) {
    if (items.length === 0) return;
    const mixed = shuffled(items);
    set({ shuffle: true, unshuffled: items });
    get().playQueue(mixed, 0);
    set({ shuffle: true, unshuffled: items });
  },

  addTracks(items, where) {
    if (items.length === 0) return;
    const { queue, index, unshuffled } = get();
    if (queue.length === 0) return get().playQueue(items, 0);
    const at = where === 'next' ? index + 1 : queue.length;
    set({ queue: [...queue.slice(0, at), ...items, ...queue.slice(at)], unshuffled: unshuffled ? [...unshuffled, ...items] : null });
    useStore.getState().toast(
      items.length === 1 ? `${items[0].title} ${where === 'next' ? 'plays next' : 'added to the queue'}.` : `${items.length} tracks ${where === 'next' ? 'play next' : 'added to the queue'}.`,
    );
  },

  playQueue(items, start = 0) {
    if (items.length === 0) return;
    audioCtl.wantPlay = true;
    const i = Math.max(0, Math.min(start, items.length - 1));
    loadNow(items[i]);
    set({ queue: items, index: i, converted: false });
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
    const { index, queue, repeat } = get();
    // At the end, "repeat all" goes round to the first track.
    const ni = index + 1 < queue.length ? index + 1 : repeat === 'all' && queue.length ? 0 : -1;
    if (ni < 0) return;
    audioCtl.wantPlay = true;
    loadNow(queue[ni]);
    set({ index: ni, converted: false });
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
    loadNow(get().queue[index - 1]);
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
    loadNow(get().queue[i]);
    set({ index: i, converted: false });
  },

  stop() {
    audioCtl.wantPlay = false;
    clearTimeout(sleepTimer);
    const el = audioCtl.el;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    const v = get().view;
    set({ queue: [], index: 0, playing: false, converted: false, expanded: v.kind !== 'now' && get().expanded, shuffle: false, unshuffled: null, sleep: null });
  },

  setVolume(v) {
    const volume = Math.max(0, Math.min(1, v));
    if (audioCtl.el) audioCtl.el.volume = volume;
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {
      /* storage unavailable */
    }
    set({ volume });
  },

  setSleep(when) {
    clearTimeout(sleepTimer);
    if (when === null) return set({ sleep: null });
    if (when === 'track') return set({ sleep: { track: true } });
    const at = Date.now() + when * 60000;
    sleepTimer = setTimeout(() => get().checkSleep(), when * 60000 + 50);
    set({ sleep: { at } });
  },

  checkSleep() {
    const { sleep } = get();
    if (!sleep || !('at' in sleep) || Date.now() < sleep.at) return;
    clearTimeout(sleepTimer);
    set({ sleep: null });
    get().pause();
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

/** How a track comes from the computer: as it is, unpacked to WAV, or as an AAC copy at some bitrate. */
export interface StreamAs {
  aac?: number;
  pcm?: boolean;
}

/** Apple's Safari drifts when you skip around in FLAC files, so Apple devices get them unpacked to WAV (same sound, bit for bit). */
const apple = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent)));

/** What to ask the computer for. */
export function streamChoice(t: Track, dataSaver: boolean, failedOriginal: boolean): StreamAs {
  if (!convertible(t)) return {};
  if (dataSaver) return { aac: 128 };
  if (failedOriginal) return { aac: 256 };
  if (apple && t.format === 'flac') return { pcm: true };
  return {};
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
