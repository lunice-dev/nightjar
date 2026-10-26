import { uuid } from './uuid';
import { useEffect, useRef } from 'react';
import type { SearchResponse } from '../api/types';
import { isIgnored, pullShared, usePrefs, type NotifyPrefs, type WishItem } from '../prefs';
import { useStore } from '../store';
import { rescanSoon } from './shareVersion';
import { tierRank, toFolders, type FolderResult } from './quality';
import { groupDownloads } from './transfers';
import { groupCoverDir, useLocalFiles } from './useLocal';
import { parseActivity, uploadsActivity } from './activity';
import { manageDownloads } from './smart';
import { watchIdentity } from './identityWatch';
import { onThisComputer } from '../api/remote';
import { portCheck } from './portCheck';

declare const __DEMO__: boolean;

// ---------------------------------------------------------------------------
// Notifications: always a toast in the app; a system notification as well when
// the window is in the background and the browser allows it.

export function notify(kind: keyof NotifyPrefs, title: string, body?: string, onClick?: () => void) {
  if (!usePrefs.getState().notify[kind]) return;
  useStore.getState().toast(body ? `${title}\n${body}` : title);
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
      const n = new Notification(title, { body, tag: `${kind}:${title}` });
      n.onclick = () => {
        window.focus();
        onClick?.();
        n.close();
      };
    }
  } catch {
    /* some embedded browsers refuse notifications */
  }
}

// ---------------------------------------------------------------------------
// Wishlist. Soulseek asks clients to keep wishlist searches infrequent, so
// each item runs at most every WISH_EVERY, and only one runs at a time with a
// gap of WISH_GAP between any two.

const MIN = 60_000;
const isDemo = typeof __DEMO__ !== 'undefined' && __DEMO__;
export const WISH_EVERY = isDemo ? 2 * MIN : 30 * MIN;
const WISH_GAP = isDemo ? 15_000 : 3 * MIN;
const WISH_LISTEN = 20_000; // how long to collect answers before closing the search
const KEEP_MATCHES = 80;

let lastWishRun = 0;
const queue = new Set<string>(); // items asked to run now

/**
 * Whether this window holds the lease the download manager runs under (one window at a time: normally Nightjar's own
 * on the computer). Anything that asks the Soulseek network on a schedule runs only there, so a phone, an iPad and
 * a browser tab open at once don't each search the wishlist and ask after people.
 */
let managing = false;

export function checkWishNow(id: string) {
  queue.add(id);
}

async function runWish(item: WishItem) {
  const backend = useStore.getState().backend;
  if (!backend) return;
  const { updateWish } = usePrefs.getState();
  lastWishRun = Date.now();
  updateWish(item.id, { running: true });

  const responses: SearchResponse[] = [];
  let searchId: string | undefined;
  try {
    const search = await backend.startSearch(item.query);
    searchId = search.id;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, WISH_LISTEN);
      const stop = backend.watchSearch(search.id, {
        onResponses: (rs) => responses.push(...rs),
        onUpdate: (s) => s.state.startsWith('Completed') && done(),
      });
      function done() {
        clearTimeout(timer);
        stop();
        resolve();
      }
    });
  } catch {
    updateWish(item.id, { running: false, lastRunAt: Date.now() });
    return;
  } finally {
    if (searchId) backend.removeSearch(searchId).catch(() => undefined);
  }

  const current = usePrefs.getState().wishlist.find((w) => w.id === item.id);
  if (!current) return; // removed while it was running

  const found = toFolders(responses.filter((r) => !isIgnored(r.username))).filter(
    (f) => !current.minTier || tierRank(f.tier) >= tierRank(current.minTier),
  );
  const seen = new Set(current.seen);
  const fresh: FolderResult[] = found.filter((f) => !seen.has(f.key));
  fresh.forEach((f) => seen.add(f.key));

  updateWish(item.id, {
    running: false,
    lastRunAt: Date.now(),
    seen: [...seen].slice(-2000),
    matches: [...fresh, ...current.matches].slice(0, KEEP_MATCHES),
    unseen: current.unseen + fresh.length,
  });
  if (fresh.length > 0) {
    notify('wishlist', `Wishlist: ${current.query}`, `${fresh.length} new ${fresh.length === 1 ? 'copy' : 'copies'} found`, () =>
      useStore.setState({ route: 'wishlist' }),
    );
  }
}

function useWishlistRunner() {
  useEffect(() => {
    const tick = () => {
      const { wishlist } = usePrefs.getState();
      if (wishlist.some((w) => w.running)) return;
      const now = Date.now();
      const asked = wishlist.find((w) => queue.has(w.id));
      if (asked) {
        // You pressed "Search now" here: it runs here, whichever window manages the rest.
        queue.delete(asked.id);
        runWish(asked);
        return;
      }
      if (!managing || now - lastWishRun < WISH_GAP) return;
      const due = wishlist
        .filter((w) => !w.lastRunAt || now - w.lastRunAt >= WISH_EVERY)
        .sort((a, b) => (a.lastRunAt ?? 0) - (b.lastRunAt ?? 0))[0];
      if (due) runWish(due);
    };
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, []);
}

// ---------------------------------------------------------------------------
// People: check each saved person's status now and then, and say when one you
// asked to be alerted about comes online.

/** How often one person's status is asked of the server: an online alert may come up to this late. */
const STATUS_EVERY = 5 * MIN;
const statusAt = new Map<string, number>();

function useBuddyWatcher() {
  useEffect(() => {
    const tick = async () => {
      const backend = useStore.getState().backend;
      const { buddies, updateBuddy } = usePrefs.getState();
      if (!backend || buddies.length === 0 || !managing) return;
      // The person asked about longest ago, once their last answer is five minutes old. Asking the server every few
      // seconds, around the clock, is the kind of traffic a server notices.
      const now = Date.now();
      const b = [...buddies].sort((x, y) => (statusAt.get(x.username) ?? 0) - (statusAt.get(y.username) ?? 0))[0];
      if (now - (statusAt.get(b.username) ?? 0) < STATUS_EVERY) return;
      statusAt.set(b.username, now);
      try {
        const st = await backend.userStatus(b.username);
        const was = b.presence;
        updateBuddy(b.username, { presence: st.presence, ...(st.presence !== 'Offline' && { lastSeen: Date.now() }) });
        if (b.alert && was === 'Offline' && st.presence !== 'Offline') {
          notify('online', `${b.username} is online`, b.note || undefined, () => useStore.getState().browse(b.username));
        }
      } catch {
        updateBuddy(b.username, { presence: 'Offline' });
      }
    };
    // At most one question every few seconds, however long the list.
    const t = setInterval(tick, isDemo ? 3000 : 6000);
    return () => clearInterval(t);
  }, []);
}

// ---------------------------------------------------------------------------
// Messages and finished downloads

function useEventWatcher() {
  const conversations = useStore((s) => s.conversations);
  const downloads = useStore((s) => s.downloads);
  const unread = useRef<Map<string, number> | null>(null);
  const phases = useRef<Map<string, string> | null>(null);
  const files = useLocalFiles();
  const localFiles = useRef(files);
  localFiles.current = files;

  useEffect(() => {
    if (!useStore.getState().conversationsLoaded) return;
    const prev = unread.current;
    const next = new Map(conversations.map((c) => [c.username, c.unAcknowledgedMessageCount]));
    unread.current = next;
    if (!prev) return; // first load: nothing is "new" yet
    const { route, chatWith } = useStore.getState();
    for (const c of conversations) {
      if (isIgnored(c.username)) continue;
      if (c.unAcknowledgedMessageCount > (prev.get(c.username) ?? 0) && !(route === 'messages' && chatWith === c.username)) {
        const last = c.messages?.[c.messages.length - 1];
        notify('messages', `Message from ${c.username}`, last?.direction === 'In' ? last.message.slice(0, 120) : undefined, () =>
          useStore.getState().message(c.username),
        );
      }
    }
  }, [conversations]);

  useEffect(() => {
    const groups = groupDownloads(downloads, usePrefs.getState().plans);
    // Remember finished albums for the home page, so clearing the Downloads list doesn't erase them there.
    const where = useStore.getState().local;
    usePrefs.getState().recordFinished(
      groups
        .filter((g) => g.phase === 'done')
        .map((g) => ({
          key: g.key,
          title: g.title,
          artist: g.parent || undefined,
          dir: groupCoverDir(g, localFiles.current, where.downloadDir),
          size: g.size,
          tracks: g.files.length,
          from: g.usernames,
          at: g.files.reduce((t, f) => Math.max(t, Date.parse(f.endedAt ?? '') || 0), 0) || g.time,
        })),
    );
    const prev = phases.current;
    phases.current = new Map(groups.map((g) => [g.key, g.phase]));
    if (!prev) return;
    for (const g of groups) {
      const was = prev.get(g.key);
      if (was && was !== 'done' && g.phase === 'done') {
        rescanSoon(); // new music may sit inside a shared folder
        notify('downloads', 'Download finished', g.parent ? `${g.parent} – ${g.title}` : g.title, () => useStore.getState().go('downloads'));
      }
    }
  }, [downloads]);
}

// ---------------------------------------------------------------------------
// Smart downloads and the record of what others do with your share.

function useDownloadManager() {
  useEffect(() => {
    // Real speeds from slskd's history, refreshed every minute.
    useStore.getState().refreshSpeeds();
    const sp = setInterval(() => useStore.getState().refreshSpeeds(), 60_000);
    return () => clearInterval(sp);
  }, []);
  useEffect(() => {
    let busy = false;
    let pulled = Date.now(); // the page just loaded the shared copy
    const id = uuid();
    const t = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        // Albums started on another device: their plans, so they show as one album and get managed here too.
        // The shared copy is over a megabyte: the computer looks every two minutes, a phone (mobile data) every ten,
        // and never while the page is in the background. Saving merges too, so nothing waits on this.
        if (!document.hidden && Date.now() - pulled > (onThisComputer ? 120_000 : 600_000)) {
          pulled = Date.now();
          await pullShared();
        }
        const backend = useStore.getState().backend;
        managing = !!backend && (await backend.files.lease(id));
        if (!backend || !managing) return;
        // Whose album is it really? Before anything else moves tracks around.
        await watchIdentity((title, body) => notify('downloads', title, body, () => useStore.getState().go('downloads'))).catch(() => undefined);
        await manageDownloads();
      } finally {
        busy = false;
      }
    }, 5000);
    return () => clearInterval(t);
  }, []);
}

// ---------------------------------------------------------------------------
// Whether others can reach this computer: Soulseek's port test now and then, kept in Nightjar's log, so a port
// that closes and opens again by itself (a router hiccup) shows up with its times. The test is a small web page
// Soulseek runs, separate from its server: at start, every hour, and soon after someone couldn't be reached.

const PORT_EVERY = 60 * MIN;
const PORT_AT_MOST = 10 * MIN;
let portCheckedAt = 0;

function usePortWatch() {
  useEffect(() => {
    const tick = () => {
      const backend = useStore.getState().backend;
      const now = Date.now();
      if (!backend || !managing || now - portCheckedAt < PORT_AT_MOST) return;
      if (!portCheck.wanted && now - portCheckedAt < PORT_EVERY) return;
      portCheck.wanted = false;
      portCheckedAt = now;
      void backend.checkPort();
    };
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);
}

function useActivityRecorder() {
  useEffect(() => {
    const read = async () => {
      const backend = useStore.getState().backend;
      if (!backend) return;
      try {
        const [lines, uploads] = await Promise.all([backend.activity(), backend.transfers('upload')]);
        usePrefs.getState().addActivity([...parseActivity(lines, useStore.getState().me), ...uploadsActivity(uploads)]);
        // Finished uploads, for the statistics on the home and Uploads pages (kept after Clear finished).
        usePrefs.getState().recordSent(
          uploads.flatMap((u) =>
            u.directories.flatMap((d) =>
              d.files
                .filter((f) => f.state === 'Completed, Succeeded' && f.bytesTransferred > 0)
                .map((f) => ({ id: f.id, user: u.username, bytes: f.bytesTransferred, speed: f.averageSpeed, at: Date.parse(f.endedAt ?? f.requestedAt) || Date.now() })),
            ),
          ),
        );
      } catch {
        /* the next read catches up */
      }
    };
    read();
    // slskd keeps only its last hundred log lines, so read often.
    const t = setInterval(read, 4000);
    return () => clearInterval(t);
  }, []);
}

/** Everything that keeps working while you're on another screen. */
export function useBackground() {
  useWishlistRunner();
  useBuddyWatcher();
  useEventWatcher();
  useDownloadManager();
  useActivityRecorder();
  usePortWatch();
}
