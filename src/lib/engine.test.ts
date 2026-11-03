import { describe, expect, it, vi } from 'vitest';
import { describeFormats, streamTarget, takeOver, type EngineApi, type EngineCheck, type EngineNow, type EngineStatus, type MediaLike } from './engine';

// No browser here: the app window and the helper address are stand-ins.
vi.mock('./host', () => ({ inApp: true }));
vi.mock('../api/slskd', () => ({ HELPER: 'http://127.0.0.1:5031' }));

/** A stand-in for an <audio> element: properties on the class (as on a real one), events it receives. */
class FakeAudio extends EventTarget implements MediaLike {
  private s = '';
  private t = 0;
  private p = true;
  heard: string[] = [];
  volume = 1;
  get src() {
    return this.s;
  }
  set src(v: string) {
    this.s = v;
  }
  get currentTime() {
    return this.t;
  }
  set currentTime(v: number) {
    this.t = v;
  }
  get duration() {
    return 100;
  }
  get paused() {
    return this.p;
  }
  play() {
    this.p = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
  pause() {
    this.p = true;
  }
  load() {}
  getAttribute(name: string) {
    return name === 'src' ? this.s || null : null;
  }
  removeAttribute(name: string) {
    if (name === 'src') this.s = '';
  }
  dispatchEvent(e: Event) {
    this.heard.push(e.type);
    return super.dispatchEvent(e);
  }
}

const FILE = 'C:\\Music\\Album\\01.flac';
const url = (extra = '') => `http://127.0.0.1:5031/stream?k=x&path=${encodeURIComponent(FILE)}${extra}`;

function engine(check: Partial<EngineCheck> = {}) {
  const calls: string[] = [];
  let st: EngineStatus = { state: 'idle', path: null, position: 0, duration: 200, format: null, device: null, reason: null };
  const api: EngineApi = {
    check: async (path) => {
      calls.push('check');
      return { ok: true, format: '24-bit / 96 kHz, exclusive', reason: null, device: 'DAC', duration: 200, path, ...check };
    },
    play: async (path, from) => {
      calls.push(`play ${from}`);
      st = { ...st, state: 'playing', path, position: from };
      return st;
    },
    pause: async () => {
      calls.push('pause');
      st = { ...st, state: st.state === 'playing' ? 'paused' : st.state };
      return st;
    },
    resume: async () => {
      calls.push('resume');
      st = { ...st, state: st.state === 'paused' ? 'playing' : st.state };
      return st;
    },
    stop: async () => {
      calls.push('stop');
      st = { ...st, state: 'idle', path: null };
      return st;
    },
    status: async () => st,
  };
  return { api, calls, set: (s: Partial<EngineStatus>) => (st = { ...st, ...s }) };
}

function setup(check: Partial<EngineCheck> = {}) {
  const el = new FakeAudio();
  const fb = new FakeAudio();
  const e = engine(check);
  const reports: (EngineNow | null)[] = [];
  const release = takeOver(el, { api: e.api, makeFallback: () => fb, device: () => null, report: (n) => reports.push(n), every: 5 });
  return { el, fb, ...e, reports, release, now: () => reports[reports.length - 1] };
}

describe('reading a stream address', () => {
  it('finds the file and whether the original is asked for', () => {
    expect(streamTarget(url())).toEqual({ path: FILE, original: true });
    expect(streamTarget(url('&aac=128'))).toEqual({ path: FILE, original: false });
    expect(streamTarget(url('&pcm=1')).original).toBe(false);
  });
});

describe('what a device takes, in words', () => {
  it('gives the range of rates and the deepest slot', () => {
    expect(describeFormats(['44100:16/24', '96000:16/24/32', '192000:24/32'])).toBe('44.1 to 192 kHz, up to 32-bit');
    expect(describeFormats(['48000:16'])).toBe('48 kHz, up to 16-bit');
    expect(describeFormats([])).toBe('');
  });
});

describe('bit-perfect playback standing in for the audio element', () => {
  it('plays an original file through the engine', async () => {
    const t = setup();
    t.el.src = url();
    await t.el.play();
    expect(t.calls).toContain('play 0');
    expect(t.el.paused).toBe(false);
    expect(t.el.heard).toEqual(expect.arrayContaining(['loadedmetadata', 'play', 'playing']));
    expect(t.el.duration).toBe(200);
    expect(t.now()?.mode).toBe('engine');
    t.release();
  });

  it('pauses and carries on from the same place', async () => {
    const t = setup();
    t.el.src = url();
    await t.el.play();
    t.el.pause();
    expect(t.el.paused).toBe(true);
    await vi.waitFor(() => expect(t.calls).toContain('pause'));
    await t.el.play();
    expect(t.calls[t.calls.length - 1]).toBe('resume');
    t.release();
  });

  it('seeks by starting the file again at the new place', async () => {
    const t = setup();
    t.el.src = url();
    await t.el.play();
    t.el.currentTime = 42;
    expect(t.el.currentTime).toBe(42);
    await vi.waitFor(() => expect(t.calls).toContain('play 42'));
    t.release();
  });

  it('a seek while paused is used when playing again', async () => {
    const t = setup();
    t.el.src = url();
    await t.el.play();
    t.el.pause();
    t.el.currentTime = 30;
    await t.el.play();
    expect(t.calls[t.calls.length - 1]).toBe('play 30');
    t.release();
  });

  it('reports the end of the track like the element does', async () => {
    const t = setup();
    t.el.src = url();
    await t.el.play();
    t.set({ state: 'ended', position: 200 });
    await vi.waitFor(() => expect(t.el.heard).toContain('ended'));
    expect(t.el.paused).toBe(true);
    expect(t.el.heard.slice(-2)).toEqual(['pause', 'ended']);
    // Playing again after the end starts from the beginning.
    await t.el.play();
    expect(t.calls[t.calls.length - 1]).toBe('play 0');
    t.release();
  });

  it('a pause pressed while the track is starting leaves nothing playing', async () => {
    const t = setup();
    t.el.src = url();
    const started = t.el.play();
    t.el.pause();
    await started;
    await vi.waitFor(() => expect(t.calls[t.calls.length - 1]).not.toBe('play 0'));
    expect(t.el.paused).toBe(true);
  });

  it('plays the usual way, with the reason, when the device refuses the file', async () => {
    const t = setup({ ok: false, reason: 'The DAC doesn’t accept 24-bit / 88.2 kHz in exclusive mode.' });
    t.el.src = url();
    await t.el.play();
    await vi.waitFor(() => expect(t.fb.paused).toBe(false));
    expect(t.fb.src).toBe(url());
    expect(t.calls).not.toContain('play 0');
    expect(t.now()).toMatchObject({ mode: 'normal', reason: expect.stringContaining('88.2 kHz') });
    t.release();
  });

  it('sends an AAC copy straight to the usual player without asking the engine', async () => {
    const t = setup();
    t.el.src = url('&aac=256');
    await t.el.play();
    await vi.waitFor(() => expect(t.fb.paused).toBe(false));
    expect(t.calls).not.toContain('check');
    t.release();
  });

  it('switches to the usual player mid-track when the device goes away', async () => {
    const t = setup();
    t.el.src = url();
    await t.el.play();
    t.set({ state: 'failed', reason: 'The DAC was unplugged.', position: 12 });
    await vi.waitFor(() => expect(t.fb.paused).toBe(false));
    expect(t.now()).toMatchObject({ mode: 'normal', reason: 'The DAC was unplugged.' });
    t.release();
  });

  it('hands the track back to the element, still playing, when switched off', async () => {
    const t = setup();
    t.el.src = url();
    await t.el.play();
    t.el.currentTime = 50;
    await vi.waitFor(() => expect(t.calls).toContain('play 50'));
    t.release();
    expect(t.now()).toBeNull();
    await vi.waitFor(() => expect(t.el.src).toBe(url()));
    expect(t.el.paused).toBe(false);
    expect(t.calls[t.calls.length - 1]).toBe('stop');
  });

  it('takes over a track that was already playing', async () => {
    const el = new FakeAudio();
    el.src = url();
    await el.play();
    el.currentTime = 20;
    const e = engine();
    const release = takeOver(el, { api: e.api, makeFallback: () => new FakeAudio(), device: () => null, report: () => undefined, every: 5 });
    await vi.waitFor(() => expect(e.calls).toContain('play 20'));
    expect(el.paused).toBe(false);
    release();
  });
});
