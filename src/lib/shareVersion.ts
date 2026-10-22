import { useEffect, useState } from 'react';
import { useStore } from '../store';

/**
 * A number that goes up whenever your share changes: a rescan finishes, or the
 * folder or file count moves. Screens that show your share reload on it.
 */
export function useShareVersion(active = true) {
  const backend = useStore((s) => s.backend);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!backend || !active) return;
    let last = '';
    let stop = false;
    const check = async () => {
      try {
        const s = await backend.shareStatus();
        const key = s.scanning ? 'scanning' : `${s.directories}/${s.files}`;
        if (last && key !== last && key !== 'scanning') setVersion((v) => v + 1);
        last = key;
      } catch {
        /* try again on the next tick */
      }
      if (!stop) timer = setTimeout(check, 5000);
    };
    let timer = setTimeout(check, 0);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [backend, active]);
  return version;
}

/**
 * slskd remembers your share from its last scan; files you deleted or moved
 * since stay listed (and others get errors asking for them) until it scans
 * again. This asks for a scan and waits for it to finish.
 */
let scanning: Promise<void> | undefined;
export function rescanAndWait() {
  const backend = useStore.getState().backend;
  if (!backend) return Promise.resolve();
  scanning ??= (async () => {
    try {
      await backend.rescan();
      const until = Date.now() + 5 * 60_000;
      await new Promise((r) => setTimeout(r, 800));
      while (Date.now() < until) {
        const s = await backend.shareStatus().catch(() => undefined);
        if (s && !s.scanning) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
    } finally {
      scanning = undefined;
    }
  })();
  return scanning;
}

/** One automatic scan per session, the first time your share is shown, so it starts out true. */
let scannedOnce = false;
export function scanOnce() {
  if (scannedOnce) return Promise.resolve();
  scannedOnce = true;
  return rescanAndWait();
}

/** After downloads land in a shared folder, scan again once things settle. */
let soon: ReturnType<typeof setTimeout> | undefined;
export function rescanSoon(ms = 60_000) {
  clearTimeout(soon);
  soon = setTimeout(() => rescanAndWait().catch(() => undefined), ms);
}
