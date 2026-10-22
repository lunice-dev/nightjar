import { useCallback, useEffect, useState } from 'react';
import type { Settings, ShareStatus } from '../api/types';
import { Icon } from '../components/Icon';
import type { PortCheck } from '../api/backend';
import { usePrefs, type NotifyPrefs } from '../prefs';
import { useStore } from '../store';

/**
 * slskd writes shared folders as plain paths, with two optional markers:
 * "[Alias]C:\path" names the folder as others see it, "!C:\path" excludes it.
 */
interface Folder {
  path: string;
  alias: string;
  excluded: boolean;
}

const parseFolder = (raw: string): Folder => {
  const excluded = raw.startsWith('!');
  const rest = excluded ? raw.slice(1) : raw;
  const m = rest.match(/^\[([^\]]*)\](.*)$/);
  return m ? { path: m[2], alias: m[1], excluded } : { path: rest, alias: '', excluded };
};

const formatFolder = (f: Folder) => `${f.excluded ? '!' : ''}${f.alias ? `[${f.alias}]` : ''}${f.path}`;

const lastPart = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

export function SettingsScreen() {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const [settings, setSettings] = useState<Settings>();
  const [status, setStatus] = useState<ShareStatus>();
  const [error, setError] = useState<string>();
  const [draft, setDraft] = useState<Folder[]>([]);
  const [downloadDir, setDownloadDir] = useState('');
  const [slots, setSlots] = useState('');
  const [newPath, setNewPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [canPick, setCanPick] = useState(false);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [typing, setTyping] = useState(false);
  const [busyFolders, setBusyFolders] = useState(false);
  const [restartNeeded, setRestartNeeded] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // Shared by the sections that save on their own: reload, and say if slskd needs a restart.
  const afterSave = async () => {
    await new Promise((r) => setTimeout(r, 800));
    const pending = await backend!.restartNeeded().catch(() => false);
    setRestartNeeded(pending);
    await load();
    return pending;
  };

  const load = useCallback(async () => {
    if (!backend) return;
    try {
      const s = await backend.settings();
      setSettings(s);
      setDraft(s.sharedFolders.map(parseFolder));
      setDownloadDir(s.downloadDir);
      setSlots(String(s.uploadSlots));
    } catch (e) {
      setError(`Couldn't read the sharing settings: ${(e as Error).message}`);
    }
  }, [backend]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    backend?.folders.available().then(setCanPick);
    backend?.restartNeeded().then(setRestartNeeded).catch(() => undefined);
  }, [backend]);

  // Flag shared folders that don't exist on this computer; slskd skips them silently.
  useEffect(() => {
    if (!backend || !canPick) return;
    let alive = true;
    Promise.all(draft.map(async (f) => [f.path, await backend.folders.exists(f.path)] as const)).then((r) => {
      if (alive) setMissing(new Set(r.filter(([, ok]) => ok === false).map(([p]) => p)));
    });
    return () => {
      alive = false;
    };
  }, [backend, canPick, draft]);

  useEffect(() => {
    if (!backend) return;
    let alive = true;
    const poll = async () => {
      try {
        const st = await backend.shareStatus();
        if (alive) setStatus(st);
      } catch {
        /* keep the last value */
      }
    };
    poll();
    const t = setInterval(poll, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [backend]);

  if (error) {
    return (
      <div className="page">
        <div className="page-inner">
          <h1 className="page-title">Settings</h1>
          <p className="error">{error}</p>
        </div>
      </div>
    );
  }
  if (!settings) {
    return (
      <div className="page">
        <div className="page-inner">
          <h1 className="page-title">Settings</h1>
          <span className="spinner" aria-label="Loading" />
        </div>
      </div>
    );
  }

  const dirty = downloadDir !== settings.downloadDir;
  const ro = !settings.editable;

  const save = async () => {
    setSaving(true);
    try {
      const n = parseInt(slots, 10);
      // Send only what changed, so untouched settings stay exactly as written in the config.
      const slotsValue = Number.isFinite(n) && n > 0 ? n : settings.uploadSlots;
      await backend!.saveSettings({
        ...(downloadDir !== settings.downloadDir && { downloadDir }),
        ...(slotsValue !== settings.uploadSlots && { uploadSlots: slotsValue }),
      });
      // Give slskd a moment to reload its config, then see whether it wants a restart.
      await new Promise((r) => setTimeout(r, 800));
      const pending = await backend!.restartNeeded().catch(() => false);
      setRestartNeeded(pending);
      if (pending) {
        // slskd keeps reporting the old values until it restarts; show what was saved.
        setSettings({ ...settings, downloadDir, uploadSlots: slotsValue });
        toast('Saved. Restart to start using the new settings.');
      } else {
        toast('Saved');
        await load();
      }
    } catch (e) {
      toast(`Couldn't save: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Folder changes take effect straight away: save, then scan so others can see them.
  const saveFolders = async (next: Folder[], done: string) => {
    const before = draft;
    setDraft(next);
    setBusyFolders(true);
    try {
      await backend!.saveSettings({ sharedFolders: next.map(formatFolder) });
      await backend!.rescan();
      toast(done);
      await load();
    } catch (e) {
      setDraft(before);
      toast(`Couldn't update your shared folders: ${(e as Error).message}`, 'error');
    } finally {
      setBusyFolders(false);
    }
  };

  const add = async (raw: string) => {
    const p = raw.trim().replace(/[\\/]+$/, '');
    if (!p) return;
    if (draft.some((f) => f.path.toLowerCase() === p.toLowerCase())) {
      toast('That folder is already shared', 'error');
      return;
    }
    if (canPick && (await backend!.folders.exists(p)) === false) {
      toast(`There's no folder at ${p} on this computer. Check the path, or use Choose a folder to share.`, 'error');
      return;
    }
    setNewPath('');
    setTyping(false);
    await saveFolders([...draft, { path: p, alias: '', excluded: false }], `Sharing ${lastPart(p)}. Scanning it now.`);
  };

  const choose = async () => {
    try {
      const p = await backend!.folders.pick(draft[draft.length - 1]?.path);
      if (p) await add(p);
    } catch (e) {
      toast(`Couldn't open the folder dialog: ${(e as Error).message}`, 'error');
    }
  };

  const chooseDownloads = async () => {
    try {
      const p = await backend!.folders.pick(downloadDir || undefined);
      if (p) setDownloadDir(p);
    } catch (e) {
      toast(`Couldn't open the folder dialog: ${(e as Error).message}`, 'error');
    }
  };

  const shared = draft.filter((f) => !f.excluded);

  return (
    <div className="page">
      <div className="page-inner narrow">
        <div className="page-head">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-sub">
              {status
                ? status.scanning
                  ? `Scanning your folders, ${Math.round(status.progress * 100)}%`
                  : status.faulted
                    ? 'The last scan failed. Check the folder paths below, then scan again.'
                    : `You share ${status.files.toLocaleString()} files in ${status.directories.toLocaleString()} folders`
                : ' '}
            </p>
          </div>
          <button className="btn quiet small" disabled={status?.scanning} onClick={() => backend?.rescan().then(() => toast('Scanning your shared folders'))}>
            <Icon name="retry" size={16} /> Scan again
          </button>
        </div>
        {status?.scanning && (
          <div className="bar" role="progressbar" aria-valuenow={Math.round(status.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Scan progress">
            <i style={{ width: `${status.progress * 100}%` }} />
          </div>
        )}

        {restartNeeded && (
          <div className="callout restart" role="status">
            <span>
              {restarting
                ? 'Restarting the engine. This takes a few seconds, and transfers in progress are interrupted.'
                : 'Some saved changes, like the download folder, take effect after a restart.'}
            </span>
            {canPick ? (
              <button
                className="btn small"
                disabled={restarting}
                onClick={async () => {
                  setRestarting(true);
                  const ok = await backend!.restart();
                  setRestarting(false);
                  if (ok) {
                    setRestartNeeded(false);
                    toast('Restarted. The new settings are in use.');
                    await load();
                  } else {
                    toast('Couldn’t restart from here. Quit Nightjar and open it again from the Start menu.', 'error');
                  }
                }}
              >
                {restarting ? <span className="spinner" aria-hidden /> : null} {restarting ? 'Restarting…' : 'Restart now'}
              </button>
            ) : (
              <span className="dim">Quit Nightjar and open it again from the Start menu.</span>
            )}
          </div>
        )}

        {ro && (
          <p className="callout">
            You can see these settings but not change them here. To allow changes, set <code>remote_configuration: true</code> in
            the engine’s config file (data\slskd.yml) and restart Nightjar.
          </p>
        )}

        <SpeedSection settings={settings} readOnly={ro} onSaved={afterSave} />

        <LibrarySection />

        <Reachability />

        <AccountSection />

        <section className="settings-block" aria-labelledby="shared-h">
          <h2 id="shared-h">Shared folders</h2>
          <p className="hint-text">
            Everything inside these folders is visible to other people. Others see the name on the right, not the full path on
            your computer.
          </p>
          {draft.length === 0 ? (
            <p className="callout">You aren’t sharing anything yet. Many people only let others download if they share too.</p>
          ) : (
            <ul className="folders">
              {draft.map((f, i) => (
                <li key={f.path} className={f.excluded ? 'excluded' : ''}>
                  <Icon name="folder" size={16} />
                  <span className="path" title={f.path}>
                    {f.path}
                  </span>
                  {missing.has(f.path) ? (
                    <span className="alias state-failed">Folder not found</span>
                  ) : (
                    <span className="alias">{f.excluded ? 'Not shared' : `Shown as ${f.alias || lastPart(f.path)}`}</span>
                  )}
                  <button
                    className="link"
                    disabled={ro || busyFolders}
                    onClick={() =>
                      saveFolders(
                        draft.map((x, j) => (j === i ? { ...x, excluded: !x.excluded } : x)),
                        f.excluded ? `Sharing ${lastPart(f.path)} again` : `${lastPart(f.path)} is no longer shared`,
                      )
                    }
                  >
                    {f.excluded ? 'Share' : 'Exclude'}
                  </button>
                  <button
                    className="icon-btn"
                    disabled={ro || busyFolders}
                    aria-label={`Stop sharing ${f.path}`}
                    onClick={() => saveFolders(draft.filter((_, j) => j !== i), `Stopped sharing ${lastPart(f.path)}`)}
                  >
                    <Icon name="close" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="folder-actions">
            {canPick && (
              <button className="btn" disabled={ro || busyFolders} onClick={choose}>
                <Icon name="folder" size={16} /> Choose a folder to share
              </button>
            )}
            {busyFolders && <span className="spinner" aria-label="Saving" />}
            {canPick && !typing && (
              <button className="link" disabled={ro} onClick={() => setTyping(true)}>
                Type a path instead
              </button>
            )}
          </div>
          {(!canPick || typing) && (
            <form
              className="add-folder"
              onSubmit={(e) => {
                e.preventDefault();
                add(newPath);
              }}
            >
              <label htmlFor="new-folder" className="sr-only">
                Folder path to share
              </label>
              <input
                id="new-folder"
                className="input"
                placeholder="C:\Users\you\Music"
                value={newPath}
                disabled={ro || busyFolders}
                autoFocus={typing}
                onChange={(e) => setNewPath(e.target.value)}
              />
              <button className="btn quiet" type="submit" disabled={ro || busyFolders || !newPath.trim()}>
                Share this folder
              </button>
            </form>
          )}
          <p className="hint-text small">
            {canPick
              ? 'Changes here apply straight away.'
              : 'Type the full path as it is on the computer running Nightjar. Changes here apply straight away.'}{' '}
            {shared.length > 0 && `${shared.length} of ${draft.length} folders shared.`}
          </p>
        </section>

        <section className="settings-block" aria-labelledby="dl-h">
          <h2 id="dl-h">Where downloads go</h2>
          <div className="add-folder">
            <label className="sr-only" htmlFor="download-dir">
              Download folder
            </label>
            <input
              id="download-dir"
              className="input"
              value={downloadDir}
              placeholder="The engine’s default folder"
              disabled={ro}
              onChange={(e) => setDownloadDir(e.target.value)}
            />
            {canPick && (
              <button className="btn quiet" disabled={ro} onClick={chooseDownloads}>
                <Icon name="folder" size={16} /> Choose…
              </button>
            )}
          </div>
        </section>

        <div className="save-row">
          <button className="btn" disabled={ro || !dirty || saving} onClick={save}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {dirty && !saving && (
            <button className="link" onClick={load}>
              Undo changes
            </button>
          )}
        </div>

        <ProfileSection settings={settings} readOnly={ro} canPick={canPick} onSaved={afterSave} />

        <Notifications />
      </div>
    </div>
  );
}

const KINDS: { key: keyof NotifyPrefs; label: string }[] = [
  { key: 'messages', label: 'Someone sends you a message' },
  { key: 'downloads', label: 'An album finishes downloading' },
  { key: 'online', label: 'Someone in your people comes online (if you turned on their bell)' },
  { key: 'wishlist', label: 'A wishlist search finds something new' },
];

function Notifications() {
  const notify = usePrefs((s) => s.notify);
  const setNotify = usePrefs((s) => s.setNotify);
  const supported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied');

  return (
    <section className="settings-block" aria-labelledby="notify-h">
      <h2 id="notify-h">Notifications</h2>
      <p className="hint-text">
        Nightjar shows these in the corner of the window. When the window is in the background it can also use your
        system’s notifications.
      </p>
      <div className="checks">
        {KINDS.map((k) => (
          <label key={k.key} className="toggle" htmlFor={`notify-${k.key}`}>
            <input id={`notify-${k.key}`} type="checkbox" checked={notify[k.key]} onChange={(e) => setNotify({ [k.key]: e.target.checked })} />
            {k.label}
          </label>
        ))}
      </div>
      <p className="hint-text" style={{ marginTop: 14 }}>
        {!supported || permission === 'denied' ? (
          'System notifications are blocked in this browser. Allow them in the site settings to get them.'
        ) : permission === 'granted' ? (
          'System notifications are on.'
        ) : (
          <button
            className="btn quiet small"
            onClick={async () => {
              try {
                setPermission(await Notification.requestPermission());
              } catch {
                setPermission('denied');
              }
            }}
          >
            Allow system notifications
          </button>
        )}
      </p>
    </section>
  );
}

/**
 * Whether people can connect to you directly. When they can't, downloads from
 * you only work with people whose own port is open, so many fail.
 */
function Reachability() {
  const backend = useStore((s) => s.backend);
  const [state, setState] = useState<{ checking: boolean; result?: PortCheck | null }>({ checking: true });
  const [fixing, setFixing] = useState<'' | 'router' | 'firewall'>('');
  const [note, setNote] = useState('');

  const check = useCallback(async () => {
    if (!backend) return;
    setState((s) => ({ ...s, checking: true }));
    const result = await backend.checkPort();
    setState({ checking: false, result });
  }, [backend]);

  useEffect(() => {
    check();
  }, [check]);

  const fixRouter = async () => {
    if (!backend) return;
    setFixing('router');
    setNote('');
    const r = await backend.openPort();
    setFixing('');
    if (!r) setNote('The helper on this computer didn’t answer.');
    else if (r.ok) setNote(`Your router now forwards port ${r.port} to this computer (${r.ip}).`);
    else setNote(`Your router didn’t accept it: ${r.error ?? 'UPnP may be turned off on the router'}. You can forward the port by hand in the router’s settings.`);
    check();
  };

  const fixFirewall = async () => {
    if (!backend) return;
    setFixing('firewall');
    setNote('Windows will ask for permission. Choose Yes.');
    const r = await backend.allowFirewall();
    setFixing('');
    if (!r) setNote('The helper on this computer didn’t answer.');
    else if (r.ok) setNote('Windows Firewall now lets people connect to Nightjar.');
    else setNote(r.error ?? 'Windows permission was not given.');
    check();
  };

  const r = state.result;
  const canFix = !state.checking && r?.open !== true && r !== null;
  return (
    <section className="settings-block" aria-labelledby="reach-h">
      <h2 id="reach-h">Can others download from you?</h2>
      <div className="reach">
        {state.checking ? (
          <p className="hint-text">
            <span className="spinner" aria-hidden /> Checking your port from the internet…
          </p>
        ) : r?.open === true ? (
          <p className="reach-line ok">
            <span className="presence online" aria-hidden /> Yes. Port {r.port} is open{r.ip ? ` on ${r.ip}` : ''}, so people can
            connect to you directly.
          </p>
        ) : r?.open === false ? (
          <div>
            <p className="reach-line bad">
              <span className="presence offline bad-dot" aria-hidden /> Not directly. Port {r.port} is closed. Downloads and browsing
              fail with people whose port is closed too, and they look offline.
            </p>
            <p className="hint-text">Open the port on your router and allow Nightjar through Windows Firewall, then check again.</p>
          </div>
        ) : (
          <p className="hint-text">This can only be checked in the Nightjar app on this computer.</p>
        )}
        <div className="reach-actions">
          {canFix && (
            <>
              <button className="btn small" disabled={!!fixing} onClick={fixRouter}>
                {fixing === 'router' && <span className="spinner" aria-hidden />} Open the port on the router
              </button>
              <button className="btn small" disabled={!!fixing} onClick={fixFirewall}>
                {fixing === 'firewall' && <span className="spinner" aria-hidden />} Allow through Windows Firewall
              </button>
            </>
          )}
          <button className="btn quiet small" disabled={state.checking || !!fixing} onClick={check}>
            <Icon name="retry" size={16} /> Check again
          </button>
        </div>
        {note && <p className="hint-text" role="status">{note}</p>}
      </div>
    </section>
  );
}

/**
 * Where your music lives. "Put in library" moves albums from Downloads into
 * Library\FLAC, Hi-Res or MP3\Artist\Year - Album.
 */
function LibrarySection() {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const [info, setInfo] = useState<{ root: string | null; exists: boolean } | null>(null);
  const [music, setMusic] = useState<string | null>(null);
  useEffect(() => {
    backend?.library.info().then(setInfo);
    backend?.folders.known().then((k) => setMusic(k.music)).catch(() => {});
  }, [backend]);
  if (!info) return null; // no Nightjar app on this computer (a phone)
  const choose = async () => {
    const p = await backend!.folders.pick(info.root ?? music ?? undefined).catch(() => null);
    if (!p) return;
    const r = await backend!.library.setRoot(p);
    if (r.ok) {
      setInfo({ root: p, exists: true });
      toast('Library folder saved.');
    } else toast(r.error ?? 'Couldn’t save it.', 'error');
  };
  return (
    <section className="settings-block" aria-labelledby="library-h">
      <h2 id="library-h">Your music library</h2>
      <p className="hint-text">
        “Put in library” (in Downloads) moves an album here, into a folder per format and per artist:
        <br />
        <code>Library\FLAC\Artist\Year - Album</code>, <code>Library\Hi-Res\…</code> or <code>Library\MP3\…</code>. Nothing moves until
        you confirm the names.
      </p>
      <div className="setup-folder">
        <div>
          <strong>Library folder</strong>
          <span className="path">{info.root ?? 'Not chosen yet'}</span>
          {info.root && !info.exists && <span className="error">This folder doesn’t exist any more.</span>}
        </div>
        <button className="btn quiet small" onClick={choose}>
          {info.root ? 'Change' : 'Choose'}
        </button>
      </div>
      {!info.root && music && (
        <button
          className="btn small"
          onClick={async () => {
            const r = await backend!.library.setRoot(music);
            if (r.ok) setInfo({ root: music, exists: true });
          }}
        >
          Use my Music folder ({music})
        </button>
      )}
    </section>
  );
}

/** Your Soulseek name and password; changing them signs in again. */
function AccountSection() {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const problem = useStore((s) => s.link.problem);
  const [current, setCurrent] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    backend?.account().then((a) => { setCurrent(a.username); setUsername(a.username); }).catch(() => {});
  }, [backend]);

  const save = async () => {
    if (!backend) return;
    setBusy(true);
    setNote('Signing in…');
    try {
      const r = await backend.signIn(username.trim(), password);
      if (r === 'ok') {
        setCurrent(username.trim());
        setPassword('');
        setNote('');
        useStore.setState({ me: username.trim() });
        toast(`Signed in to Soulseek as ${username.trim()}.`);
      } else {
        setNote(
          r === 'rejected'
            ? 'Soulseek didn’t accept that name and password. Someone else may have this name.'
            : r === 'kicked'
              ? 'This account is signed in somewhere else. Close the other program and try again.'
              : 'Soulseek didn’t answer. Try again in a moment.',
        );
      }
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-block" aria-labelledby="account-h">
      <h2 id="account-h">Soulseek account</h2>
      {problem === 'rejected' && <p className="error">Soulseek refused the name or password below. Change them and sign in again.</p>}
      {problem === 'kicked' && <p className="error">Your account was signed in somewhere else (SoulseekQt?). Close it, then sign in again.</p>}
      <div className="account-row">
        <label className="field">
          Name
          <input className="input" maxLength={30} value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label className="field">
          Password
          <input className="input" type="password" autoComplete="new-password" placeholder={current ? 'Unchanged' : ''} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn" disabled={busy || !username.trim() || !password} onClick={save}>
          {busy ? 'Signing in…' : 'Sign in again'}
        </button>
      </div>
      {note && <p className="hint-text" role="status">{note}</p>}
    </section>
  );
}

const toMB = (kib: number | null) => (kib ? +(kib / 1024).toFixed(kib < 1024 ? 2 : 1) : null);
const fromMB = (text: string) => {
  const n = parseFloat(text.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n * 1024)) : null;
};

/** Download and upload speed in one place, in MB/s, with the upload slots next to them. */
function SpeedSection({ settings, readOnly, onSaved }: { settings: Settings; readOnly: boolean; onSaved: () => Promise<boolean> }) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const refreshLimits = useStore((s) => s.refreshLimits);
  const [down, setDown] = useState(toMB(settings.downloadLimit)?.toString() ?? '');
  const [up, setUp] = useState(toMB(settings.uploadLimit)?.toString() ?? '');
  const [slots, setSlots] = useState(String(settings.uploadSlots));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDown(toMB(settings.downloadLimit)?.toString() ?? '');
    setUp(toMB(settings.uploadLimit)?.toString() ?? '');
    setSlots(String(settings.uploadSlots));
  }, [settings.downloadLimit, settings.uploadLimit, settings.uploadSlots]);

  const nextDown = fromMB(down);
  const nextUp = fromMB(up);
  const nextSlots = Math.max(1, parseInt(slots, 10) || settings.uploadSlots);
  const dirty = nextDown !== settings.downloadLimit || nextUp !== settings.uploadLimit || nextSlots !== settings.uploadSlots;

  const save = async () => {
    setSaving(true);
    try {
      await backend!.saveSettings({
        ...(nextDown !== settings.downloadLimit && { downloadLimit: nextDown }),
        ...(nextUp !== settings.uploadLimit && { uploadLimit: nextUp }),
        ...(nextSlots !== settings.uploadSlots && { uploadSlots: nextSlots }),
      });
      const pending = await onSaved();
      refreshLimits();
      toast(pending ? 'Saved. Restart to start using the new speed settings.' : 'Speed settings saved');
    } catch (e) {
      toast(`Couldn't save: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-block speed" id="speed" aria-labelledby="speed-h">
      <h2 id="speed-h">Speed</h2>
      <p className="hint-text">Leave a box empty for no limit. Limits apply to all transfers together.</p>
      <div className="speed-grid">
        <label className="field" htmlFor="limit-down">
          Download limit
          <span className="unit-input">
            <input id="limit-down" className="input" inputMode="decimal" placeholder="No limit" value={down} disabled={readOnly} onChange={(e) => setDown(e.target.value.replace(/[^\d.,]/g, ''))} />
            <span>MB/s</span>
          </span>
        </label>
        <label className="field" htmlFor="limit-up">
          Upload limit
          <span className="unit-input">
            <input id="limit-up" className="input" inputMode="decimal" placeholder="No limit" value={up} disabled={readOnly} onChange={(e) => setUp(e.target.value.replace(/[^\d.,]/g, ''))} />
            <span>MB/s</span>
          </span>
        </label>
        <label className="field" htmlFor="slots">
          Uploads at once
          <span className="unit-input">
            <input id="slots" className="input" inputMode="numeric" value={slots} disabled={readOnly} onChange={(e) => setSlots(e.target.value.replace(/\D/g, ''))} />
            <span>people</span>
          </span>
        </label>
      </div>
      <p className="hint-text small">
        Fewer people at once means each one gets more of your upload speed. 3 to 5 is a good choice for fast uploads; everyone
        else waits in your queue.
      </p>
      <SmartToggle />
      <div className="save-row tight">
        <button className="btn" disabled={readOnly || !dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save speed settings'}
        </button>
        {(settings.downloadLimit || settings.uploadLimit) && (
          <button
            className="link"
            disabled={readOnly || saving}
            onClick={() => {
              setDown('');
              setUp('');
            }}
          >
            Remove both limits
          </button>
        )}
      </div>
    </section>
  );
}

/** What other people see when they look at you: your description and picture. */
function ProfileSection({
  settings,
  readOnly,
  canPick,
  onSaved,
}: {
  settings: Settings;
  readOnly: boolean;
  canPick: boolean;
  onSaved: () => Promise<boolean>;
}) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const browse = useStore((s) => s.browse);
  const me = useStore((s) => s.me);
  const [text, setText] = useState(settings.description);
  const [picture, setPicture] = useState(settings.picture);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(settings.description);
    setPicture(settings.picture);
  }, [settings.description, settings.picture]);

  useEffect(() => {
    let alive = true;
    if (!picture || !backend) {
      setPreview(null);
      return;
    }
    backend.files.imagePreview(picture).then((url) => alive && setPreview(url));
    return () => {
      alive = false;
    };
  }, [backend, picture]);

  const dirty = text !== settings.description || picture !== settings.picture;

  const save = async () => {
    setSaving(true);
    try {
      await backend!.saveSettings({
        ...(text !== settings.description && { description: text }),
        ...(picture !== settings.picture && { picture }),
      });
      const pending = await onSaved();
      toast(pending ? 'Profile saved. Restart so other people see it.' : 'Profile saved');
    } catch (e) {
      toast(`Couldn't save your profile: ${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-block" aria-labelledby="profile-h">
      <h2 id="profile-h">Your profile</h2>
      <p className="hint-text">This is what people see when they open your profile. A friendly line about what you share helps.</p>
      <p className="hint-text">
        Pictures: JPG, PNG, GIF or BMP, square works best, up to 5 MB. Nightjar keeps its own copy, so the picture keeps working
        even if the original moves or lives only in OneDrive.
      </p>
      <div className="profile-edit">
        <div className="avatar-box">
          {preview ? <img className="avatar" src={preview} alt="Your profile picture" /> : <div className="avatar placeholder" aria-hidden>{(me ?? '?').slice(0, 1).toUpperCase()}</div>}
          {canPick && (
            <button
              className="link"
              disabled={readOnly}
              onClick={async () => {
                try {
                  const p = await backend!.files.pickImage();
                  if (p) setPicture(p);
                } catch (e) {
                  toast(`Couldn't open the file dialog: ${(e as Error).message}`, 'error');
                }
              }}
            >
              {picture ? 'Change picture' : 'Add a picture'}
            </button>
          )}
          {picture && (
            <button className="link" disabled={readOnly} onClick={() => setPicture('')}>
              Remove picture
            </button>
          )}
        </div>
        <label className="field grow" htmlFor="profile-text">
          <span className="sr-only">Description</span>
          <textarea
            id="profile-text"
            className="input textarea"
            rows={6}
            maxLength={2000}
            placeholder="Mostly lossless rips from my own CDs and records. Say hi before queueing a whole discography."
            value={text}
            disabled={readOnly}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </div>
      <div className="save-row tight">
        <button className="btn" disabled={readOnly || !dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        {me && (
          <button className="link" onClick={() => browse(me)}>
            See how others see you
          </button>
        )}
      </div>
    </section>
  );
}

/** Automatic switching to another copy; saved in this browser, applies straight away. */
function SmartToggle() {
  const smart = usePrefs((s) => s.smart);
  const setSmart = usePrefs((s) => s.setSmart);
  return (
    <div className="smart">
      <label className="toggle" htmlFor="smart-on">
        <input id="smart-on" type="checkbox" checked={smart.enabled} onChange={(e) => setSmart({ enabled: e.target.checked })} />
        Download from the fastest copy, and move to the next one when a person refuses, fails, or keeps you waiting
      </label>
      {smart.enabled && (
        <label className="field inline" htmlFor="smart-wait">
          <span>Wait in someone’s queue for at most</span>
          <input
            id="smart-wait"
            className="input small-input"
            inputMode="numeric"
            value={smart.queueMinutes}
            onChange={(e) => setSmart({ queueMinutes: Math.max(1, parseInt(e.target.value.replace(/\D/g, ''), 10) || 1) })}
          />
          <span>minutes</span>
        </label>
      )}
      {smart.enabled && (
        <label className="toggle" htmlFor="smart-parallel">
          <input id="smart-parallel" type="checkbox" checked={smart.parallel !== false} onChange={(e) => setSmart({ parallel: e.target.checked })} />
          When several people share the identical album, download different tracks from up to three of them at once
        </label>
      )}
    </div>
  );
}
