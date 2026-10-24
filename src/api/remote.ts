import { inApp } from '../lib/host';

/**
 * Remote access. Away from home, the page is opened on this computer's private
 * Tailscale address (https://<computer>.<tailnet>.ts.net), and the Nightjar app's
 * helper answers under /nj on that same address. Each phone or computer signs in
 * once (pairing code or remote password) and keeps a device token, sent with
 * every helper request. Pictures and music use a per-device key in their address.
 */

const host = location.hostname;

/** The page is open on the computer Nightjar runs on (its window, luniceOS, or a browser there). */
export const onThisComputer = inApp || host === '127.0.0.1' || host === 'localhost';

/** Opened through Tailscale: everything works, after this device signs in. */
export const viaTailscale = /\.ts\.net$/i.test(host);

/** Opened on the computer's home network address (http://192.168.x.x:5030), from a phone on the same Wi-Fi. */
export const viaHomeWifi = !onThisComputer && !viaTailscale && /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d+\.\d+$/.test(host);

/** Signed in as a device (code or remote password) rather than being the computer itself. */
export const asDevice = viaTailscale || viaHomeWifi;

/** Where the helper answers for this page. */
export const helperBase = (fallback: string) =>
  viaTailscale ? `${location.origin}/nj` : viaHomeWifi ? `http://${host}:5032` : fallback;

const DEVICE_KEY = 'nightjar.device';

export const deviceToken = () => {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
};

export const forgetDevice = () => {
  try {
    localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* storage unavailable */
  }
};

/**
 * Adds this device's token to every request for the helper. Done once, here, so the
 * many places that ask the helper for something don't each have to remember it.
 */
export function signHelperRequests(base: string) {
  if (!asDevice) return;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const token = deviceToken();
    if (token && url.startsWith(base)) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('X-Nightjar-Device', token);
      return original(input, { ...init, headers }).then((res) => {
        // This device was removed (from the computer or another phone): back to the sign-in screen.
        if (res.status === 401) forgetDevice();
        return res;
      });
    }
    return original(input, init);
  };
}

/** A name for this device in the list on the computer, from what the browser says it is. */
export function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Windows/.test(ua)) return 'Windows computer';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux computer';
  return 'A device';
}

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

/** Opened from the Home Screen icon (not a Safari tab). */
export const standalone = () =>
  (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;

export interface PairResult {
  ok: boolean;
  error?: string;
  wait?: number;
}

/** Signs this device in with the pairing code shown on the computer, or the remote password. */
export async function pair(base: string, secret: string): Promise<PairResult> {
  try {
    const res = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, name: deviceName() }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = (await res.json().catch(() => ({}))) as { token?: string; error?: string; wait?: number };
    if (!res.ok || !j.token) return { ok: false, error: j.error ?? `Nightjar answered ${res.status}.`, wait: j.wait };
    localStorage.setItem(DEVICE_KEY, j.token);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Nightjar on your computer isn’t answering. Check that it’s running and that Tailscale is on here.' };
  }
}

// --- the computer's side: status and setup ---------------------------------------

export interface TailscaleState {
  installed: boolean;
  backend: string | null;
  dnsName: string | null;
  https: boolean;
  serving: boolean;
  account: string | null;
  error: string | null;
}

export interface Device {
  id: string;
  name: string;
  created: string;
  lastSeen: string;
}

export interface RemoteStatus {
  tailscale: TailscaleState;
  address: string | null;
  install: { step: string; percent: number; error: string | null; finished: boolean } | null;
  devices: Device[];
  /** This device's id, when it is a remote one. */
  you: string | null;
  passwordSet: boolean;
  username: string | null;
  lan: boolean;
  lanAddresses: string[];
}

async function call<T>(base: string, path: string, method = 'GET', body?: unknown, timeout = 30_000): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `The helper answered ${res.status}.`);
  return j;
}

export const remoteApi = (base: string) => ({
  status: (fresh = false) => call<RemoteStatus>(base, `/remote/status${fresh ? '?fresh=1' : ''}`, 'GET', undefined, 20_000),
  newCode: () => call<{ code: string; expires: string }>(base, '/remote/code', 'POST'),
  dropCode: () => call<{ ok: boolean }>(base, '/remote/code', 'DELETE'),
  removeDevice: (id: string) => call<{ ok: boolean }>(base, '/remote/device', 'POST', { id, action: 'remove' }),
  renameDevice: (id: string, name: string) => call<{ ok: boolean }>(base, '/remote/device', 'POST', { id, name }),
  signOutAll: () => call<{ ok: boolean }>(base, '/remote/signout-all', 'POST'),
  setPassword: (password: string) => call<{ ok: boolean; error?: string }>(base, '/remote/password', 'POST', { password }),
  setLan: (on: boolean) => call<{ ok: boolean; error?: string }>(base, '/remote/lan', 'POST', { on }),
  install: () => call<{ step: string; percent: number; error: string | null; finished: boolean }>(base, '/tailscale/install', 'POST'),
  login: () => call<{ ok: boolean; url?: string; already?: boolean; error?: string }>(base, '/tailscale/login', 'POST', undefined, 40_000),
  serve: (on: boolean) => call<{ ok: boolean; address?: string; consent?: string; error?: string }>(base, '/tailscale/serve', 'POST', { on }, 60_000),
  test: () => call<{ ok: boolean; error?: string }>(base, '/tailscale/test', 'GET', undefined, 40_000),
});

/** Whether the computer's door for devices answers (on the home Wi-Fi it's only open while that option is on). */
export async function helperAnswers(base: string) {
  try {
    const res = await fetch(`${base}/ping`, { signal: AbortSignal.timeout(2500) });
    return res.ok;
  } catch {
    return false;
  }
}
