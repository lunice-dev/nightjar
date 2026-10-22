import { useEffect, useState } from 'react';
import { HELPER } from '../api/slskd';
import { useFilesAvailable } from '../lib/files';
import { create } from 'zustand';

export interface UpdateState {
  current: string;
  latest: string | null;
  notes: string | null;
  page: string | null;
  error: string | null;
  repo: string;
  available: boolean;
  checking: boolean;
  downloading: boolean;
  ready: boolean;
  size: number;
  received: number;
  checkedAt: number;
}

/** What the Nightjar app knows about updates, shared by the banner and About. */
export const useUpdates = create<{ state: UpdateState | null; dismissed: string | null; load(check?: boolean): Promise<void>; install(): Promise<void> }>((set, get) => ({
  state: null,
  dismissed: (() => {
    try {
      return localStorage.getItem('nightjar-update-dismissed');
    } catch {
      return null;
    }
  })(),
  async load(check) {
    try {
      const res = await fetch(`${HELPER}/update${check ? '?check=1' : ''}`, { signal: AbortSignal.timeout(check ? 30_000 : 5000) });
      if (res.ok) set({ state: (await res.json()) as UpdateState });
    } catch {
      /* the app isn't here (phone, sample data) */
    }
  },
  async install() {
    try {
      await fetch(`${HELPER}/update/install`, { method: 'POST', signal: AbortSignal.timeout(10_000) });
    } catch {
      /* the progress shows what happens */
    }
    // Follow the download until Nightjar closes for the installer.
    for (let i = 0; i < 600; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      await get().load();
      const s = get().state;
      if (!s?.downloading) break;
    }
  },
}));

let polling = false;
/** Looks at the app's update state now and then (the app itself checks GitHub every few hours). */
function usePollUpdates() {
  const canFiles = useFilesAvailable();
  const load = useUpdates((s) => s.load);
  useEffect(() => {
    if (!canFiles || polling) return;
    polling = true;
    void load();
    const t = setInterval(() => void load(), 10 * 60_000);
    return () => {
      clearInterval(t);
      polling = false;
    };
  }, [canFiles, load]);
}

function Progress({ s }: { s: UpdateState }) {
  const pct = s.size ? Math.round((s.received / s.size) * 100) : 0;
  return (
    <span className="hint-text" style={{ margin: 0 }}>
      <span className="spinner" aria-hidden /> {s.ready ? 'Installing… Nightjar closes and opens again by itself.' : `Downloading ${pct}%…`}
    </span>
  );
}

/** A slim line above the screens when a new version is out. */
export function UpdateBanner() {
  usePollUpdates();
  const { state: s, dismissed, install } = useUpdates();
  const [hidden, setHidden] = useState(false);
  if (!s?.available || !s.latest || hidden || dismissed === s.latest) return null;
  return (
    <div className="update-banner" role="status">
      <span>
        <b>Nightjar {s.latest}</b> is out.
      </span>
      {s.downloading || s.ready ? (
        <Progress s={s} />
      ) : (
        <>
          <button className="btn small" onClick={() => void install()}>
            Install and restart
          </button>
          <button
            className="link"
            onClick={() => {
              setHidden(true);
              try {
                localStorage.setItem('nightjar-update-dismissed', s.latest!);
              } catch {
                /* fine */
              }
            }}
          >
            Later
          </button>
        </>
      )}
      {s.error && <span className="error">{s.error}</span>}
    </div>
  );
}

/** About: the version, whether it's the newest, and a button to look now. */
export function UpdateSection() {
  usePollUpdates();
  const canFiles = useFilesAvailable();
  const { state: s, load, install } = useUpdates();
  const [busy, setBusy] = useState(false);
  if (!canFiles || !s) return null;
  return (
    <section className="updates" aria-labelledby="updates-h">
      <h2 id="updates-h">Updates</h2>
      {!s.repo ? (
        <p className="hint-text">This copy of Nightjar isn’t set up to update itself yet.</p>
      ) : s.available ? (
        <>
          <p className="hint-text">
            <b>Nightjar {s.latest}</b> is out (you have {s.current}). Installing keeps your settings, library and downloads; Nightjar closes for a moment
            and opens again.
          </p>
          {s.notes && <pre className="update-notes">{s.notes}</pre>}
        </>
      ) : (
        <p className="hint-text">
          You have the newest version, {s.current}.{s.checkedAt ? ` Last looked ${new Date(s.checkedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.` : ''}
        </p>
      )}
      <div className="updates-row">
        {s.available && !s.downloading && !s.ready && (
          <button className="btn small" onClick={() => void install()}>
            Install and restart
          </button>
        )}
        {(s.downloading || s.ready) && <Progress s={s} />}
        {s.repo && !s.downloading && !s.ready && (
          <button
            className="btn quiet small"
            disabled={busy || s.checking}
            onClick={async () => {
              setBusy(true);
              await load(true);
              setBusy(false);
            }}
          >
            {busy || s.checking ? 'Looking…' : 'Look for updates'}
          </button>
        )}
        {s.error && <span className="error">{s.error}</span>}
      </div>
    </section>
  );
}
