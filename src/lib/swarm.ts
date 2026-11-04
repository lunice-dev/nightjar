import type { TransferUser } from '../api/types';

/**
 * A wave of brand-new accounts, each taking a track or two, with names that no person types ("u3f9a1c07be2d"). Each
 * account stays far below what automated.ts looks for, so it takes the accounts together to see it. One account of the
 * wave is never blocked: a wave is several accounts with the same kind of made-up name appearing within an hour.
 */

const MIN = 60_000;

/** At least this many accounts of one kind of name, inside one window, make a wave. */
export const WAVE = { accounts: 5, window: 60 * MIN, maxFiles: 10 };
/** After a wave, accounts of the same kind of name are blocked as they turn up, for this long. */
export const WAVE_MEMORY = 7 * 24 * 60 * MIN;

/**
 * The kind of name when it looks machine-made, else null: ten or more hex digits, with a letter in front ("u3f9a1c07be2d"
 * is "u:12": a "u" and twelve digits; random hex is sometimes all digits, so that is fine) or, with no letter in front,
 * both digits and a–f in them. Plain numbers ("936442997") and words are people.
 */
export function nameKind(user: string): string | null {
  const m = /^([a-z]?)([0-9a-f]{10,32})$/.exec(user);
  if (!m) return null;
  const [, prefix, hex] = m;
  const digits = hex.match(/[0-9]/g)?.length ?? 0;
  const letters = hex.match(/[a-f]/g)?.length ?? 0;
  if (digits < 2) return null;
  if (!prefix && letters < 2) return null;
  return `${prefix || '-'}:${hex.length}`;
}

export interface Account {
  user: string;
  /** When it first asked for anything. */
  first: number;
  files: number;
}

/** One account per person among these files (every upload, or the ones the list still shows): when it first asked, and how many it asked for. */
export function accountsFromFiles(files: { username: string; requestedAt?: string | null; enqueuedAt?: string | null }[]): Account[] {
  const by = new Map<string, Account>();
  for (const f of files) {
    const at = Date.parse(f.requestedAt || f.enqueuedAt || '') || 0;
    if (!at) continue;
    const a = by.get(f.username);
    if (a) {
      a.files++;
      a.first = Math.min(a.first, at);
    } else by.set(f.username, { user: f.username, first: at, files: 1 });
  }
  return [...by.values()];
}

/** The same from the uploads list as the page holds it. */
export const accountsOf = (uploads: TransferUser[]): Account[] =>
  accountsFromFiles(uploads.flatMap((u) => u.directories.flatMap((d) => d.files.map((f) => ({ ...f, username: u.username })))));

export interface Wave {
  /** The kind of name, as nameKind gives it. */
  kind: string;
  users: string[];
  /** In plain words, for the notice. */
  summary: string;
}

/**
 * The waves in these accounts: kinds of name with enough small, new accounts inside one window. `known` are the kinds
 * of a wave seen before (kind → when), whose accounts count at once, however few.
 */
export function findWaves(accounts: Account[], known: Record<string, number> = {}, now = Date.now()): Wave[] {
  const byKind = new Map<string, Account[]>();
  for (const a of accounts) {
    const kind = nameKind(a.user);
    if (!kind || a.files > WAVE.maxFiles) continue;
    const list = byKind.get(kind);
    if (list) list.push(a);
    else byKind.set(kind, [a]);
  }
  const out: Wave[] = [];
  for (const [kind, list] of byKind) {
    list.sort((a, b) => a.first - b.first);
    // The most accounts that first appeared inside any one window.
    let best = 0;
    let j = 0;
    for (let i = 0; i < list.length; i++) {
      while (list[i].first - list[j].first > WAVE.window) j++;
      best = Math.max(best, i - j + 1);
    }
    const remembered = now - (known[kind] ?? 0) < WAVE_MEMORY;
    if (best < WAVE.accounts && !remembered) continue;
    const files = list.reduce((s, a) => s + a.files, 0);
    out.push({ kind, users: list.map((a) => a.user), summary: `${list.length} new accounts with made-up names took ${files} ${files === 1 ? 'file' : 'files'}` });
  }
  return out;
}
