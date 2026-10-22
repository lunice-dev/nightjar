import type { LogLine, TransferUser } from '../api/types';
import type { ActivityEvent } from '../prefs';

/**
 * Turns slskd's log lines about other people into activity events. slskd only
 * keeps the last hundred lines, so Nightjar reads them often and keeps its own
 * history.
 */
const RULES: { re: RegExp; kind: ActivityEvent['kind']; detail: (m: RegExpMatchArray) => string; user: (m: RegExpMatchArray) => string }[] = [
  { re: /^Sent browse response to (.+)$/, kind: 'browse', user: (m) => m[1], detail: () => 'Browsed your shared folders' },
  {
    re: /^Folder contents for (.+) sent to (.+)$/,
    kind: 'folder',
    user: (m) => m[2],
    detail: (m) => `Opened ${lastParts(m[1])}`,
  },
  { re: /^Upload of (.+) to (.+) requested$/, kind: 'requested', user: (m) => m[2], detail: (m) => `Asked for ${lastParts(m[1])}` },
  {
    re: /^Rejected enqueue request for (?:blacklisted )?user (\S+)(?: \([^)]*\))?(?::\s*(.+))?$/,
    kind: 'refused',
    user: (m) => m[1],
    detail: (m) => `Refused: ${(m[2] ?? 'not allowed to download from you').replace(/\.$/, '')}`,
  },
  {
    re: /^Returned empty browse listing for blacklisted user (\S+)/,
    kind: 'refused',
    user: (m) => m[1],
    detail: () => 'Tried to browse; you don’t share with them',
  },
];

function lastParts(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join(' › ');
}

/** slskd quotes names and paths in its log, sometimes dropping the closing quote. */
const unquote = (s: string) => s.replace(/"/g, '').trim();

export function parseActivity(lines: LogLine[], me?: string): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const l of lines) {
    const msg = l.message.trim().replace(/"/g, '');
    for (const r of RULES) {
      const m = msg.match(r.re);
      if (!m) continue;
      const at = Date.parse(l.timestamp);
      const user = unquote(r.user(m));
      if (me && user === me) break; // your own look at your share isn't news
      out.push({ id: `${l.timestamp}|${msg}`, at: Number.isFinite(at) ? at : Date.now(), user, kind: r.kind, detail: r.detail(m) });
      break;
    }
  }
  return out;
}

/**
 * Finished uploads come from slskd's transfer list, which outlives the log, so
 * downloads by others show up even if Nightjar wasn't open at the time.
 */
export function uploadsActivity(users: TransferUser[]): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  for (const u of users)
    for (const d of u.directories)
      for (const t of d.files) {
        if (t.state !== 'Completed, Succeeded') continue;
        const at = Date.parse(t.endedAt ?? t.requestedAt);
        out.push({ id: `up|${t.id}`, at: Number.isFinite(at) ? at : Date.now(), user: t.username, kind: 'uploaded', detail: `Downloaded ${lastParts(t.filename)}` });
      }
  return out;
}
