import { create } from 'zustand';
import { HELPER } from '../api/slskd';
import { inApp } from './host';

/**
 * Bit-perfect playback on the computer: the Windows app plays the file itself, straight to the sound
 * device in exclusive mode at the file's own sample rate, so Windows' mixer never changes it. Only in
 * nightjar's own window (a phone can't reach the computer's sound device).
 *
 * The player stays as it is: while this is on, `takeOver` stands in for its <audio> element (same
 * properties, same events) and passes play, pause and seek to the app. A file the device can't take as
 * it is plays through an ordinary audio element instead, and the reason is shown.
 */

export const bitPerfectAvailable = inApp;

export interface EngineStatus {
  state: 'idle' | 'playing' | 'paused' | 'ended' | 'failed';
  path: string | null;
  position: number;
  duration: number;
  /** False when the track goes through Windows' mixer on the chosen device (it wouldn't take it as it is). */
  exclusive?: boolean;
  format: string | null;
  device: string | null;
  reason: string | null;
}

export interface EngineCheck {
  /** The engine can play it on the chosen device… */
  ok: boolean;
  /** …untouched (false: through Windows' mixer, with `reason`). Older apps don't say, and only answer ok for untouched. */
  exclusive?: boolean;
  format: string | null;
  reason: string | null;
  device: string | null;
  duration: number;
}

export interface EngineDevice {
  id: string;
  name: string;
  isDefault: boolean;
  /** What it takes in exclusive mode, as "rate:depths", for example "96000:16/24/32". */
  exclusive: string[];
}

export interface EngineApi {
  check(path: string, device: string | null): Promise<EngineCheck>;
  play(path: string, from: number, device: string | null): Promise<EngineStatus>;
  pause(): Promise<EngineStatus>;
  resume(): Promise<EngineStatus>;
  stop(): Promise<EngineStatus>;
  status(): Promise<EngineStatus>;
  /** 0 to 1, for tracks that go through Windows; untouched ones ignore it. */
  volume(v: number): Promise<EngineStatus>;
}

async function call<T>(what: string, q: Record<string, string | number | null> = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== null && v !== '') params.set(k, String(v));
  const qs = params.toString();
  const res = await fetch(`${HELPER}/engine/${what}${qs ? `?${qs}` : ''}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok && res.status !== 404) throw new Error(`engine ${what}: ${res.status}`);
  return (await res.json()) as T;
}

export const engineApi: EngineApi & { devices(): Promise<{ devices: EngineDevice[] }> } = {
  devices: () => call('devices'),
  check: (path, device) => call('check', { path, device }),
  play: (path, from, device) => call('play', { path, from: Math.max(0, from).toFixed(3), device }),
  pause: () => call('pause'),
  resume: () => call('resume'),
  stop: () => call('stop'),
  status: () => call('status'),
  volume: (v) => call('volume', { v: Math.max(0, Math.min(1, v)).toFixed(3) }),
};

/** "96000:16/24/32" lines in words: "44.1 to 192 kHz, up to 32-bit". */
export function describeFormats(exclusive: string[]) {
  const rows = exclusive.map((x) => x.split(':')).map(([r, d]) => ({ rate: +r, depth: Math.max(...d.split('/').map(Number)) }));
  if (!rows.length) return '';
  const khz = (r: number) => `${+(r / 1000).toFixed(1)}`;
  const lo = Math.min(...rows.map((r) => r.rate));
  const hi = Math.max(...rows.map((r) => r.rate));
  const depth = Math.max(...rows.map((r) => r.depth));
  return `${lo === hi ? khz(lo) : `${khz(lo)} to ${khz(hi)}`} kHz, up to ${depth}-bit`;
}

// --- The switch and what's happening now ------------------------------------------------------

const ON_KEY = 'nightjar.bitPerfect';
const DEVICE_KEY = 'nightjar.bitPerfectDevice';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* not kept */
  }
};

/** How the current track is being played, for the sound quality panel. */
export interface EngineNow {
  /** "engine": bit-perfect; "normal": through Windows' mixer, with the reason when there is one. */
  mode: 'engine' | 'normal';
  format: string | null;
  device: string | null;
  reason: string | null;
}

interface EngineState {
  on: boolean;
  /** The chosen output, or null for whatever Windows uses by default. */
  device: string | null;
  now: EngineNow | null;
  setOn(on: boolean): void;
  setDevice(id: string | null): void;
}

export const useEngine = create<EngineState>((set) => ({
  on: bitPerfectAvailable && read(ON_KEY) === '1',
  device: read(DEVICE_KEY) || null,
  now: null,
  setOn(on) {
    write(ON_KEY, on ? '1' : null);
    set({ on: on && bitPerfectAvailable, now: null });
  },
  setDevice(id) {
    write(DEVICE_KEY, id);
    set({ device: id });
  },
}));

// --- Standing in for the <audio> element ---------------------------------------------------------

/** What the bridge needs from an audio element (an HTMLAudioElement, or a stand-in in tests). */
export interface MediaLike extends EventTarget {
  src: string;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  volume: number;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions | boolean): void;
}

const EVENTS = ['loadstart', 'loadedmetadata', 'durationchange', 'canplay', 'playing', 'waiting', 'play', 'pause', 'timeupdate', 'seeking', 'seeked', 'ended', 'error', 'ratechange', 'emptied'];

/** The file a stream address asks for, and whether it asks for the file as it is (no AAC copy, no WAV unpacking). */
export function streamTarget(url: string): { path: string; original: boolean } {
  try {
    const u = new URL(url, 'http://x');
    return { path: u.searchParams.get('path') ?? '', original: !u.searchParams.has('aac') && !u.searchParams.has('pcm') };
  } catch {
    return { path: '', original: false };
  }
}

const samePath = (a: string, b: string) => a.replace(/\//g, '\\').toLowerCase() === b.replace(/\//g, '\\').toLowerCase();

interface Options {
  api?: EngineApi;
  /** The ordinary element for files the engine can't take as they are. */
  makeFallback?: () => MediaLike;
  device?: () => string | null;
  report?: (now: EngineNow | null) => void;
  /** How often the position is asked for while playing, in ms. */
  every?: number;
}

/**
 * Makes `el` play through the engine until the returned function is called, which hands the track back
 * to the element where it was (playing or paused).
 */
export function takeOver(el: MediaLike, opts: Options = {}): () => void {
  const api = opts.api ?? engineApi;
  const device = opts.device ?? (() => useEngine.getState().device);
  const report = opts.report ?? ((now) => useEngine.setState({ now }));
  const fire = (type: string) => el.dispatchEvent(new Event(type));

  // Requests to the app go one at a time, in order: a pause must never overtake the play before it.
  let chain: Promise<unknown> = Promise.resolve();
  const send = <T,>(fn: () => Promise<T>): Promise<T | null> => {
    const r = chain.then(fn).catch(() => null);
    chain = r;
    return r;
  };

  const fb = (opts.makeFallback ?? (() => new Audio() as MediaLike))();
  const forward = (e: Event) => {
    if (mode === 'normal') fire(e.type);
  };
  for (const t of EVENTS) fb.addEventListener(t, forward);

  let url = '';
  let path = '';
  let mode: 'engine' | 'normal' | null = null;
  let ready: Promise<void> = Promise.resolve();
  let gen = 0; // goes up with every new track; answers about an older one are dropped
  let paused = true;
  let time = 0;
  let duration = NaN;
  let seekTo: number | null = null; // a place asked for that the engine hasn't reached yet
  let started = false; // the engine has this track open (playing or paused)
  let volume = el.volume;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stopTimer = () => {
    clearInterval(timer);
    timer = undefined;
  };

  function load(next: string) {
    gen++;
    const g = gen;
    stopTimer();
    if (started) void send(() => api.stop());
    started = false;
    if (mode === 'normal') {
      fb.pause();
      fb.removeAttribute('src');
      fb.load();
    }
    url = next;
    mode = null;
    paused = true;
    time = 0;
    seekTo = null;
    duration = NaN;
    if (!next) {
      report(null);
      ready = Promise.resolve();
      return;
    }
    const target = streamTarget(next);
    path = target.path;
    fire('emptied');
    fire('loadstart');
    ready = (async () => {
      const c = target.original && path ? await send(() => api.check(path, device())) : null;
      if (g !== gen) return;
      if (c?.ok) {
        // The engine plays it on the chosen device: untouched, or (when the device won't take it as it is) through Windows there.
        mode = 'engine';
        duration = c.duration;
        const untouched = c.exclusive !== false;
        report({ mode: untouched ? 'engine' : 'normal', format: c.format, device: c.device, reason: untouched ? null : c.reason });
        fire('durationchange');
        fire('loadedmetadata');
        fire('canplay');
      } else {
        report({ mode: 'normal', format: null, device: c?.device ?? null, reason: c ? c.reason : target.original ? 'The bit-perfect player didn’t answer.' : null });
        toNormal(time, false);
      }
    })();
  }

  /** Plays the track through the ordinary element from `at`, after the engine has let go of the device. */
  function toNormal(at: number, play: boolean) {
    const g = gen;
    stopTimer();
    started = false;
    mode = 'normal'; // `paused` is left alone: a play pressed while the file was being checked still counts
    void send(() => api.stop()).then(() => {
      if (g !== gen) return;
      fb.volume = volume;
      fb.src = url;
      if (at > 0) fb.addEventListener('loadedmetadata', () => (fb.currentTime = at), { once: true });
      if (play) fb.play().catch(() => undefined);
    });
  }

  function fail(reason: string | null, at: number) {
    const wasPlaying = !paused;
    report({ mode: 'normal', format: null, device: null, reason });
    toNormal(at, wasPlaying);
  }

  function play(): Promise<void> {
    if (mode === 'normal') return fb.play();
    if (!paused) return Promise.resolve();
    paused = false;
    fire('play');
    return start();
  }

  async function start() {
    const g = gen;
    await ready;
    if (g !== gen || paused) return;
    if (mode === 'normal') {
      // `play` was pressed before we knew this file plays the ordinary way.
      paused = true;
      await send(() => Promise.resolve(null)); // after the engine has let go
      if (g === gen) await fb.play().catch(() => undefined);
      return;
    }
    if (mode !== 'engine') return;
    let from = seekTo ?? time;
    if (duration > 0 && from >= duration - 0.25) from = 0;
    const resume = started && seekTo === null;
    const s = await send(() => (resume ? api.resume() : api.play(path, from, device())));
    if (g !== gen) return;
    if (!s || s.state === 'failed') return fail(s?.reason ?? 'The bit-perfect player didn’t answer.', from);
    started = true;
    // Windows may refuse exclusive use only now that the device is opened: the engine then plays it the shared way.
    if (s.exclusive === false) report({ mode: 'normal', format: s.format, device: s.device, reason: s.reason });
    if (seekTo === from) seekTo = null;
    if (paused) {
      // Paused while it was starting.
      void send(() => api.pause());
      return;
    }
    if (seekTo === null) time = s.position;
    fire('playing');
    fire('timeupdate');
    watch();
  }

  function pause() {
    if (mode === 'normal') return fb.pause();
    if (paused) return;
    paused = true;
    stopTimer();
    fire('pause');
    if (started) {
      const g = gen;
      void send(() => api.pause()).then((s) => {
        if (g !== gen || !s || seekTo !== null) return;
        time = s.position;
        fire('timeupdate');
      });
    }
  }

  // Seeking: the engine restarts the file at the new place. Taps that come faster than it can follow
  // are folded into one, so holding the skip button doesn't queue up a restart for every step.
  let seeking = false;
  function seek(t: number) {
    if (mode === 'normal') {
      fb.currentTime = t;
      return;
    }
    t = Math.max(0, duration > 0 ? Math.min(t, duration) : t);
    seekTo = t;
    time = t;
    fire('seeking');
    fire('timeupdate');
    if (paused || !started) {
      fire('seeked');
      return;
    }
    if (seeking) return;
    seeking = true;
    const g = gen;
    void (async () => {
      while (g === gen && seekTo !== null && !paused) {
        const to = seekTo as number;
        const s = await send(() => api.play(path, to, device()));
        if (g !== gen) break;
        if (!s || s.state === 'failed') {
          seeking = false;
          return fail(s?.reason ?? null, to);
        }
        if (seekTo === to) {
          seekTo = null;
          time = s.position;
        }
      }
      seeking = false;
      if (g === gen) {
        fire('seeked');
        fire('timeupdate');
      }
    })();
  }

  /** While playing: the position, the end of the track, and a device that went away. */
  function watch() {
    stopTimer();
    const g = gen;
    timer = setInterval(async () => {
      const s = await api.status().catch(() => null);
      if (!s || g !== gen || mode !== 'engine' || paused || seekTo !== null) return;
      if (s.path && path && !samePath(s.path, path)) return;
      if (s.state === 'playing') {
        time = s.position;
        fire('timeupdate');
      } else if (s.state === 'ended') {
        stopTimer();
        started = false;
        time = duration > 0 ? duration : s.position;
        paused = true;
        fire('timeupdate');
        fire('pause');
        fire('ended');
      } else if (s.state === 'failed') {
        fail(s.reason, time);
      }
    }, opts.every ?? 250);
  }

  // Take the track the element has now, where it is, playing or not.
  const had = { url: el.getAttribute('src') ?? '', at: el.currentTime || 0, playing: !el.paused };
  el.pause();
  el.removeAttribute('src');
  el.load();

  const own = (name: string, d: PropertyDescriptor) => Object.defineProperty(el, name, { configurable: true, ...d });
  own('src', { get: () => url, set: (v: string) => load(String(v ?? '')) });
  own('currentTime', { get: () => (mode === 'normal' ? fb.currentTime : time), set: (t: number) => seek(+t || 0) });
  own('duration', { get: () => (mode === 'normal' ? fb.duration : duration) });
  own('paused', { get: () => (mode === 'normal' ? fb.paused : paused) });
  own('volume', {
    get: () => volume,
    set: (v: number) => {
      volume = v;
      fb.volume = v;
      void api.volume(v).catch(() => undefined);
    },
  });
  own('play', { value: play });
  own('pause', { value: pause });
  own('load', { value: () => (url ? undefined : load('')) });
  own('getAttribute', { value: (name: string) => (name === 'src' ? url || null : Object.getPrototypeOf(el).getAttribute.call(el, name)) });
  own('removeAttribute', { value: (name: string) => (name === 'src' ? load('') : Object.getPrototypeOf(el).removeAttribute.call(el, name)) });

  // A page reload leaves no player behind: whatever an earlier page started stops now, and on the way out.
  void send(() => api.stop());
  void send(() => api.volume(volume));
  const leave =() => void api.stop().catch(() => undefined);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', leave);

  // Another output chosen: the track starts again there, from the same place.
  const unsubscribe = useEngine.subscribe((s, prev) => {
    if (s.device === prev.device || !url) return;
    const at = el.currentTime;
    const wasPlaying = !el.paused;
    load(url);
    time = at;
    seekTo = at > 0 ? at : null;
    if (wasPlaying) void play();
  });

  if (had.url) {
    load(had.url);
    time = had.at;
    seekTo = had.at > 0 ? had.at : null;
    if (had.playing) void play();
  }

  return () => {
    const back = { url, at: el.currentTime, playing: !el.paused };
    unsubscribe();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', leave);
    gen++;
    stopTimer();
    for (const t of EVENTS) fb.removeEventListener(t, forward);
    fb.pause();
    fb.removeAttribute('src');
    fb.load();
    for (const name of ['src', 'currentTime', 'duration', 'paused', 'volume', 'play', 'pause', 'load', 'getAttribute', 'removeAttribute']) delete (el as unknown as Record<string, unknown>)[name];
    el.volume = volume;
    report(null);
    void send(() => api.stop()).then(() => {
      if (!back.url) return;
      el.src = back.url;
      if (back.at > 1) el.addEventListener('loadedmetadata', () => (el.currentTime = back.at), { once: true });
      if (back.playing) el.play().catch(() => undefined);
    });
  };
}
