import type { Transfer } from '../api/types';

export type Way = 'in' | 'out';
export type RangeKey = '24h' | '7d' | '30d' | '90d' | 'all';
export type Measure = 'size' | 'files' | 'speed' | 'failures' | 'failRate' | 'wait';

/** One finished (or failed) transfer, cut down to what the statistics use. */
export interface Row {
  way: Way;
  person: string;
  /** When it ended, or was asked for when it never started (ms). */
  at: number;
  /** Bytes that actually moved. */
  bytes: number;
  ok: boolean;
  /** Bytes per second while it moved; 0 when unknown. */
  speed: number;
  /** Time spent in the other person's queue (ms); 0 when unknown. */
  wait: number;
  ext: string;
  name: string;
  why: string;
}

const DAY = 86_400_000;
export const RANGES: { key: RangeKey; label: string; ms: number }[] = [
  { key: '24h', label: '24 hours', ms: DAY },
  { key: '7d', label: '7 days', ms: 7 * DAY },
  { key: '30d', label: '30 days', ms: 30 * DAY },
  { key: '90d', label: '90 days', ms: 90 * DAY },
  { key: 'all', label: 'All time', ms: Infinity },
];

const time = (s?: string | null) => {
  const n = s ? Date.parse(s) : NaN;
  return Number.isFinite(n) ? n : 0;
};

/** The reason a transfer failed, short enough to group by. */
export function reasonOf(t: Pick<Transfer, 'state' | 'exception'>): string {
  const text = `${t.exception ?? ''} ${t.state}`.toLowerCase();
  if (text.includes('cancel')) return 'Cancelled';
  if (text.includes('timed out') || text.includes('timedout') || text.includes('timeout')) return 'Timed out';
  if (text.includes('reject') || text.includes('not shared') || text.includes('banned')) return 'Refused';
  if (text.includes('too many') || text.includes('queue')) return 'Queue limit';
  if (text.includes('offline') || text.includes('not connected') || text.includes('connection')) return 'Went offline';
  return 'Other';
}

/** Turns slskd's history into rows. Anything that can't be true (a negative speed, a finish before the start) is left out of the numbers it would spoil. */
export function toRows(list: Transfer[], way: Way): Row[] {
  const out: Row[] = [];
  for (const t of list) {
    if (!t.state?.startsWith('Completed')) continue;
    const requested = time(t.requestedAt);
    const enqueued = time(t.enqueuedAt) || requested;
    const started = time(t.startedAt);
    const ended = time(t.endedAt);
    const at = ended || started || requested;
    if (!at) continue;
    const ok = t.state.includes('Succeeded');
    const moved = ok ? t.size : Math.max(0, t.bytesTransferred || 0);
    const span = started && ended && ended > started ? (ended - started) / 1000 : 0;
    let speed = t.averageSpeed > 0 && t.averageSpeed < 1e10 ? t.averageSpeed : span > 0 ? moved / span : 0;
    if (!ok || !Number.isFinite(speed) || speed < 0) speed = 0;
    const wait = started && enqueued && started > enqueued ? started - enqueued : 0;
    const name = t.filename.slice(t.filename.lastIndexOf('\\') + 1);
    const dot = name.lastIndexOf('.');
    out.push({
      way,
      person: t.username,
      at,
      bytes: moved,
      ok,
      speed,
      wait,
      ext: dot > 0 ? name.slice(dot + 1).toLowerCase().slice(0, 5) : '?',
      name,
      why: ok ? '' : reasonOf(t),
    });
  }
  return out;
}

export interface Totals {
  files: number;
  bytes: number;
  failed: number;
  failRate: number;
  speed: number;
  wait: number;
  people: number;
}

export function totals(rows: Row[]): Totals {
  let bytes = 0;
  let files = 0;
  let failed = 0;
  let speedSum = 0;
  let speedN = 0;
  let waitSum = 0;
  let waitN = 0;
  const people = new Set<string>();
  for (const r of rows) {
    if (r.ok) {
      files++;
      bytes += r.bytes;
      people.add(r.person);
      if (r.speed > 0) {
        speedSum += r.speed;
        speedN++;
      }
    } else failed++;
    if (r.wait > 0) {
      waitSum += r.wait;
      waitN++;
    }
  }
  return {
    files,
    bytes,
    failed,
    failRate: files + failed ? failed / (files + failed) : 0,
    speed: speedN ? speedSum / speedN : 0,
    wait: waitN ? waitSum / waitN : 0,
    people: people.size,
  };
}

export const inRange = (rows: Row[], from: number, to: number) => rows.filter((r) => r.at >= from && r.at < to);

/** The start of the period and of the one before it (null for "all time", which has nothing to compare with). */
export function periodOf(key: RangeKey, now: number, rows: Row[]): { from: number; to: number; prev: number | null } {
  const r = RANGES.find((x) => x.key === key)!;
  if (!Number.isFinite(r.ms)) {
    const first = rows.reduce((m, x) => Math.min(m, x.at), now);
    return { from: first, to: now + 1, prev: null };
  }
  return { from: now - r.ms, to: now + 1, prev: now - 2 * r.ms };
}

/** Value of one measure for every slice of the period. */
export function series(rows: Row[], from: number, to: number, slices: number, measure: Measure): number[] {
  const span = Math.max(1, to - from);
  const parts: Row[][] = Array.from({ length: slices }, () => []);
  for (const r of rows) {
    const i = Math.min(slices - 1, Math.floor(((r.at - from) / span) * slices));
    if (i >= 0) parts[i].push(r);
  }
  return parts.map((p) => {
    const t = totals(p);
    switch (measure) {
      case 'size':
        return t.bytes;
      case 'files':
        return t.files;
      case 'speed':
        return t.speed;
      case 'failures':
        return t.failed;
      case 'failRate':
        return t.failRate * 100;
      case 'wait':
        return t.wait / 60_000;
    }
  });
}

export interface PersonRow {
  person: string;
  files: number;
  bytes: number;
  speed: number;
}

export function topPeople(rows: Row[], limit = 8): PersonRow[] {
  const by = new Map<string, { files: number; bytes: number; speed: number; n: number }>();
  for (const r of rows) {
    if (!r.ok) continue;
    const e = by.get(r.person) ?? { files: 0, bytes: 0, speed: 0, n: 0 };
    e.files++;
    e.bytes += r.bytes;
    if (r.speed > 0) {
      e.speed += r.speed;
      e.n++;
    }
    by.set(r.person, e);
  }
  return [...by.entries()]
    .map(([person, e]) => ({ person, files: e.files, bytes: e.bytes, speed: e.n ? e.speed / e.n : 0 }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limit);
}

export function fileTypes(rows: Row[]): { ext: string; files: number; bytes: number }[] {
  const by = new Map<string, { files: number; bytes: number }>();
  for (const r of rows) {
    if (!r.ok) continue;
    const e = by.get(r.ext) ?? { files: 0, bytes: 0 };
    e.files++;
    e.bytes += r.bytes;
    by.set(r.ext, e);
  }
  return [...by.entries()].map(([ext, e]) => ({ ext, ...e })).sort((a, b) => b.files - a.files);
}

/** Files by weekday (Monday first) and hour of the day. */
export function heat(rows: Row[]): number[][] {
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const r of rows) {
    if (!r.ok) continue;
    const d = new Date(r.at);
    grid[(d.getDay() + 6) % 7][d.getHours()]++;
  }
  return grid;
}

export function failureReasons(rows: Row[]): { why: string; count: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) if (!r.ok) by.set(r.why, (by.get(r.why) ?? 0) + 1);
  return [...by.entries()].map(([why, count]) => ({ why, count })).sort((a, b) => b.count - a.count);
}

export interface Records {
  biggest?: Row;
  fastest?: Row;
  longestWait?: Row;
  busiestDay?: { day: number; bytes: number; files: number };
}

export function records(rows: Row[]): Records {
  const out: Records = {};
  const days = new Map<number, { bytes: number; files: number }>();
  for (const r of rows) {
    if (!r.ok) continue;
    if (!out.biggest || r.bytes > out.biggest.bytes) out.biggest = r;
    if (r.speed > 0 && (!out.fastest || r.speed > out.fastest.speed)) out.fastest = r;
    const d = new Date(r.at);
    d.setHours(0, 0, 0, 0);
    const e = days.get(d.getTime()) ?? { bytes: 0, files: 0 };
    e.bytes += r.bytes;
    e.files++;
    days.set(d.getTime(), e);
  }
  for (const r of rows) if (r.wait > 0 && (!out.longestWait || r.wait > out.longestWait.wait)) out.longestWait = r;
  for (const [day, e] of days) if (!out.busiestDay || e.bytes > out.busiestDay.bytes) out.busiestDay = { day, ...e };
  return out;
}

/** "+12%" / "-4%" against the period before; null when there is nothing to compare. */
export function change(now: number, before: number): { text: string; up: boolean } | null {
  if (!before) return null;
  const p = Math.round(((now - before) / before) * 100);
  return { text: `${p > 0 ? '+' : ''}${p}%`, up: p >= 0 };
}
