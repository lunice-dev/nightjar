import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { HELPER } from '../api/slskd';
import { forgetDevice, onThisComputer, remoteApi, asDevice, type Device, type RemoteStatus } from '../api/remote';
import { useStore } from '../store';
import { Icon } from './Icon';

const api = remoteApi(HELPER);
const APP_STORE = 'https://apps.apple.com/app/tailscale/id1470499037';

/** Polls the remote access status while mounted (and faster while asked to). */
function useRemoteStatus(fast = false) {
  const [st, setSt] = useState<RemoteStatus | null>(null);
  const [error, setError] = useState<string>();
  const load = useCallback(async (fresh = false) => {
    try {
      setSt(await api.status(fresh));
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load(true);
    const t = setInterval(() => load(), fast ? 2000 : 15_000);
    return () => clearInterval(t);
  }, [load, fast]);
  return { st, error, reload: load };
}

const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `today ${time}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `yesterday ${time}`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

/** Settings → Remote access. */
export function RemoteAccessSection() {
  const toast = useStore((s) => s.toast);
  const [guide, setGuide] = useState(false);
  const [adding, setAdding] = useState(false);
  const { st, error, reload } = useRemoteStatus(guide || adding);
  const [confirmOff, setConfirmOff] = useState(false);

  if (!st) {
    if (!error) return null;
    // A phone on the home network (no helper there), or an app too old for remote access.
    return null;
  }
  const ts = st.tailscale;
  const on = !!st.address;
  const broken = !on && ts.installed && ts.backend !== 'Running' && st.devices.length > 0;

  const removeDevice = async (d: Device) => {
    const self = d.id === st.you;
    if (!confirm(self ? 'Sign this device out? You’ll need a new code to use Nightjar here again.' : `Remove ${d.name}? It can’t use Nightjar until it signs in again. Nightjar restarts its engine for a few seconds.`)) return;
    try {
      await api.removeDevice(d.id);
      if (self) {
        forgetDevice();
        location.reload();
        return;
      }
      toast(`${d.name} removed.`);
      reload(true);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <section className="settings-block remote" id="remote" aria-labelledby="remote-h">
      <h2 id="remote-h">Remote access</h2>
      {on ? (
        <p className="reach-line ok">
          <span className="presence online" aria-hidden /> On. Your devices open Nightjar at <code>{st.address}</code>
        </p>
      ) : broken ? (
        <p className="reach-line bad">
          <span className="presence offline bad-dot" aria-hidden /> Off: Tailscale isn’t connected on this computer, so your devices can’t reach Nightjar.
        </p>
      ) : (
        <p className="hint-text">
          Use Nightjar on your phone or another computer when you’re away from home: search, downloads, your library, and
          playing your music. It goes through Tailscale, a free private network between your own devices. Nothing is
          open to the internet.
        </p>
      )}

      {onThisComputer && (
        <div className="reach-actions">
          {!on && (
            <button className="btn small" onClick={() => setGuide(true)}>
              {broken ? 'Fix remote access' : 'Set up remote access'}
            </button>
          )}
          {on && (
            <>
              <button className="btn small" onClick={() => setAdding(true)}>
                <Icon name="phone" size={16} /> Add a phone or computer
              </button>
              {confirmOff ? (
                <span className="quit-confirm">
                  Your devices won’t reach Nightjar until you turn it on again.
                  <button
                    className="btn quiet small"
                    onClick={async () => {
                      setConfirmOff(false);
                      await api.serve(false).catch(() => undefined);
                      reload(true);
                    }}
                  >
                    Turn off
                  </button>
                  <button className="btn quiet small" onClick={() => setConfirmOff(false)}>
                    Keep on
                  </button>
                </span>
              ) : (
                <button className="btn quiet small" onClick={() => setConfirmOff(true)}>
                  Turn off
                </button>
              )}
            </>
          )}
        </div>
      )}

      {st.devices.length > 0 && (
        <div className="remote-devices">
          <strong>Signed-in devices</strong>
          <ul>
            {st.devices.map((d) => (
              <li key={d.id}>
                <Icon name="phone" size={16} />
                <span className="rd-name">
                  {d.name}
                  {d.id === st.you && <span className="dim"> (this device)</span>}
                </span>
                <span className="dim rd-seen">last used {when(d.lastSeen)}</span>
                <button className="link" onClick={() => removeDevice(d)}>
                  {d.id === st.you ? 'Sign out' : 'Remove'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <RemotePassword st={st} onSaved={() => reload(true)} />

      {onThisComputer && <HomeNetwork st={st} onSaved={() => reload(true)} />}

      {st.devices.length > 1 && (
        <p className="hint-text small">
          Lost a phone?{' '}
          <button
            className="link"
            onClick={async () => {
              if (!confirm('Sign out every phone and computer? Each one needs a new code to use Nightjar again.')) return;
              await api.signOutAll().catch(() => undefined);
              if (asDevice) {
                forgetDevice();
                location.reload();
              } else reload(true);
            }}
          >
            Sign out all devices
          </button>
        </p>
      )}

      {guide && (
        <RemoteGuide
          st={st}
          reload={reload}
          onClose={() => {
            setGuide(false);
            reload(true);
          }}
        />
      )}
      {adding && st.address && (
        <div className="modal-backdrop" onClick={() => setAdding(false)}>
          <div className="modal remote-guide" role="dialog" aria-label="Add a phone or computer" onClick={(e) => e.stopPropagation()}>
            <h2>Add a phone or computer</h2>
            <PhoneSteps st={st} onPaired={() => setAdding(false)} />
            <div className="save-row">
              <button className="btn quiet" onClick={() => setAdding(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/** The remote password: for signing in without a code, and on the home network without Tailscale. */
function RemotePassword({ st, onSaved }: { st: RemoteStatus; onSaved: () => void }) {
  const toast = useStore((s) => s.toast);
  const [editing, setEditing] = useState(false);
  const [pass, setPass] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.setPassword(pass);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setEditing(false);
      setPass('');
      toast('Remote password saved. Nightjar restarts its engine for a few seconds.');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="remote-pass">
      <div className="setup-folder">
        <div>
          <strong>Remote password</strong>
          <span className="hint-text small">
            {st.passwordSet
              ? 'Set. Type it instead of a code on a new device, or to sign in on your home Wi-Fi.'
              : 'Not set. Devices sign in with a code from this page; a password is handy when you’re away from this computer.'}
          </span>
        </div>
        {!editing && (
          <button className="btn quiet small" onClick={() => setEditing(true)}>
            {st.passwordSet ? 'Change' : 'Set a password'}
          </button>
        )}
      </div>
      {editing && (
        <form onSubmit={save} className="remote-pass-form">
          <span className="pass-row">
            <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus />
            <button type="button" className="btn quiet small" onClick={() => setShow((v) => !v)}>
              {show ? 'Hide' : 'Show'}
            </button>
          </span>
          {error && <p className="error">{error}</p>}
          <div className="reach-actions">
            <button className="btn small" disabled={busy || pass.length < 8}>
              {busy ? 'Saving…' : 'Save password'}
            </button>
            <button type="button" className="btn quiet small" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Phones on the home Wi-Fi, without Tailscale: search, downloads and chat, with the remote password. */
function HomeNetwork({ st, onSaved }: { st: RemoteStatus; onSaved: () => void }) {
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const r = await api.setLan(on);
      if (!r.ok) toast(r.error ?? 'Couldn’t change it.', 'error');
      else toast('Saved. Nightjar restarts its engine for a few seconds.');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="remote-lan">
      <label className="toggle">
        <input type="checkbox" checked={st.lan} disabled={busy || (!st.lan && !st.passwordSet)} onChange={(e) => toggle(e.target.checked)} />
        Also open on my home Wi-Fi without Tailscale
      </label>
      <p className="hint-text small">
        {st.lan
          ? `On a phone on the same Wi-Fi, open ${st.lanAddresses.map((a) => `http://${a}:5030`).join(' or ') || 'this computer’s address with :5030'} and sign in with a code from this page or your remote password. Everything works there, playing music too. It isn’t encrypted like the Tailscale address, so use it only on your own Wi-Fi.`
          : st.passwordSet
            ? 'Off: only this computer and your Tailscale devices can open Nightjar.'
            : 'Set a remote password first: it’s what you type on the home Wi-Fi.'}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ the guide

type Step = 'intro' | 'install' | 'login' | 'serve' | 'phone' | 'done';
const STEPS: { id: Step; label: string }[] = [
  { id: 'install', label: 'Tailscale' },
  { id: 'login', label: 'Sign in' },
  { id: 'serve', label: 'Turn on' },
  { id: 'phone', label: 'Your phone' },
];

/** What still needs doing, from what Tailscale says. */
function firstStep(st: RemoteStatus): Step {
  if (!st.tailscale.installed) return 'install';
  if (st.tailscale.backend !== 'Running') return 'login';
  if (!st.address) return 'serve';
  return 'phone';
}

function RemoteGuide({ st, reload, onClose }: { st: RemoteStatus; reload: (fresh?: boolean) => Promise<void>; onClose: () => void }) {
  const [step, setStep] = useState<Step>('intro');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const [loginUrl, setLoginUrl] = useState<string>();
  const [consent, setConsent] = useState<string>();
  const [tested, setTested] = useState<'no' | 'testing' | 'ok' | string>('no');
  const ts = st.tailscale;

  // Each step finishes itself as soon as Tailscale says it's done.
  useEffect(() => {
    if (step === 'install' && ts.installed && !busy) {
      setNote(undefined);
      setStep('login');
    }
    if (step === 'login' && ts.backend === 'Running') {
      setNote(undefined);
      setLoginUrl(undefined);
      setStep('serve');
    }
  }, [step, ts.installed, ts.backend, busy]);

  // The install runs in the app; its progress comes with the status.
  const inst = st.install;
  useEffect(() => {
    if (step !== 'install' || !inst) return;
    if (!inst.finished) {
      setBusy(true);
      setNote(
        inst.step === 'download'
          ? `Downloading Tailscale… ${inst.percent}%`
          : inst.step === 'check'
            ? 'Checking the installer is really from Tailscale…'
            : inst.step === 'install'
              ? 'Installing. Windows asks for permission: choose Yes.'
              : 'Starting…',
      );
    } else {
      setBusy(false);
      if (inst.error) {
        setError(inst.error);
        setNote(undefined);
      }
    }
  }, [step, inst]);

  const install = async () => {
    setError(undefined);
    setBusy(true);
    try {
      await api.install();
      await reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const login = async () => {
    setError(undefined);
    setBusy(true);
    try {
      const r = await api.login();
      if (!r.ok) setError(r.error);
      else if (r.url) {
        setLoginUrl(r.url);
        setNote('Your browser opened Tailscale’s sign-in page. Sign in there (Google, Apple, Microsoft or GitHub), then come back here.');
      }
      await reload(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const testNow = useCallback(async () => {
    setTested('testing');
    // The first visit makes Tailscale fetch the certificate, which can take a moment: try a few times.
    for (let i = 0; i < 4; i++) {
      const r = await api.test().catch((e: Error) => ({ ok: false, error: e.message }));
      if (r.ok) {
        setTested('ok');
        return;
      }
      if (i === 3) setTested(r.error ?? 'It didn’t answer.');
      await new Promise((res) => setTimeout(res, 3000));
    }
  }, []);

  const turnOn = useCallback(async () => {
    setError(undefined);
    setBusy(true);
    try {
      const r = await api.serve(true);
      if (r.consent) {
        setConsent(r.consent);
        return;
      }
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setConsent(undefined);
      await reload(true);
      void testNow();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [reload, testNow]);

  // While Tailscale's page waits for the person's OK, try again every few seconds.
  const tries = useRef(0);
  useEffect(() => {
    if (!consent || step !== 'serve') return;
    tries.current = 0;
    const t = setInterval(() => {
      if (++tries.current > 60) return clearInterval(t);
      void turnOn();
    }, 5000);
    return () => clearInterval(t);
  }, [consent, step, turnOn]);

  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal remote-guide" role="dialog" aria-label="Set up remote access" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>Remote access</h2>
        {step !== 'intro' && step !== 'done' && (
          <ol className="setup-steps" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s.id} aria-current={s.id === step ? 'step' : undefined} className={i < at ? 'done' : undefined}>
                {s.label}
              </li>
            ))}
          </ol>
        )}

        {step === 'intro' && (
          <>
            <p>Nightjar keeps running on this computer. Your phone (or another computer) connects to it through Tailscale, a private network only your own devices can join.</p>
            <ul className="guide-list">
              <li>You need a free Tailscale account. You sign in with Google, Apple, Microsoft or GitHub; no new password.</li>
              <li>Tailscale goes on this computer (Nightjar installs it) and on your phone (from the App Store).</li>
              <li>This computer has to be on, with Nightjar running, for your phone to reach it.</li>
            </ul>
            <div className="setup-nav">
              <button className="btn quiet" onClick={onClose}>
                Not now
              </button>
              <button className="btn" onClick={() => setStep(firstStep(st))}>
                Start
              </button>
            </div>
          </>
        )}

        {step === 'install' && (
          <>
            <p>First, Tailscale on this computer. Nightjar downloads the official installer from tailscale.com, checks it’s really from Tailscale, and runs it.</p>
            {note && (
              <p className="hint-text" role="status">
                {busy && <span className="spinner" aria-hidden />} {note}
              </p>
            )}
            {error && <p className="error">{error}</p>}
            <div className="setup-nav">
              <button className="btn quiet" onClick={onClose}>
                Close
              </button>
              <button className="btn" disabled={busy} onClick={install}>
                {error ? 'Try again' : 'Install Tailscale'}
              </button>
            </div>
          </>
        )}

        {step === 'login' && (
          <>
            <p>
              Now sign in to Tailscale. If you don’t have an account yet, signing in creates one. Use an account you can also sign in
              with on your phone.
            </p>
            {note && (
              <p className="hint-text" role="status">
                <span className="spinner" aria-hidden /> {note}
              </p>
            )}
            {loginUrl && (
              <p className="hint-text small">
                Browser didn’t open?{' '}
                <a href={loginUrl} target="_blank" rel="noreferrer">
                  Open the sign-in page
                </a>
              </p>
            )}
            {error && <p className="error">{error}</p>}
            <div className="setup-nav">
              <button className="btn quiet" onClick={onClose}>
                Close
              </button>
              <button className="btn" disabled={busy} onClick={login}>
                {loginUrl ? 'Open sign-in again' : 'Sign in to Tailscale'}
              </button>
            </div>
          </>
        )}

        {step === 'serve' && (
          <>
            {!st.address ? (
              <>
                <p>
                  Signed in{ts.account ? ` as ${ts.account}` : ''}. Now Nightjar gets its private address on your Tailscale network,
                  with a secure (https) connection.
                </p>
                {consent && (
                  <div className="callout">
                    <p>
                      Tailscale needs your OK once to give your devices secure addresses. Open its page, choose <strong>Enable</strong>,
                      then come back: Nightjar carries on by itself.
                    </p>
                    <a className="btn small" href={consent} target="_blank" rel="noreferrer">
                      Open Tailscale’s page
                    </a>
                  </div>
                )}
                {busy && !consent && (
                  <p className="hint-text" role="status">
                    <span className="spinner" aria-hidden /> Turning it on…
                  </p>
                )}
                {error && <p className="error">{error}</p>}
                <div className="setup-nav">
                  <button className="btn quiet" onClick={onClose}>
                    Close
                  </button>
                  <button className="btn" disabled={busy && !consent} onClick={turnOn}>
                    {consent ? 'I’ve allowed it' : 'Turn on remote access'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  Nightjar’s private address is <code>{st.address}</code>
                </p>
                <p className="hint-text" role="status">
                  {tested === 'testing' || tested === 'no' ? (
                    <>
                      <span className="spinner" aria-hidden /> Checking it answers…
                    </>
                  ) : tested === 'ok' ? (
                    <>
                      <span className="presence online" aria-hidden /> It answers. Remote access is on.
                    </>
                  ) : (
                    <span className="error">It didn’t answer yet: {tested}</span>
                  )}
                </p>
                <div className="setup-nav">
                  {tested !== 'ok' && tested !== 'testing' && (
                    <button className="btn quiet" onClick={testNow}>
                      Check again
                    </button>
                  )}
                  <button className="btn" disabled={tested === 'testing'} onClick={() => setStep('phone')}>
                    Next: your phone
                  </button>
                </div>
              </>
            )}
            {st.address && tested === 'no' && <AutoTest run={testNow} />}
          </>
        )}

        {step === 'phone' && (
          <>
            <PhoneSteps st={st} onPaired={() => setStep('done')} />
            <div className="setup-nav">
              <button className="btn quiet" onClick={onClose}>
                Close
              </button>
              <button className="btn quiet" onClick={() => setStep('done')}>
                Skip for now
              </button>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <p>
              <span className="presence online" aria-hidden /> Remote access is on. Open Nightjar from your Home Screen whenever Tailscale is
              on on your phone.
            </p>
            <ul className="guide-list">
              <li>To add another phone or computer: Settings → Remote access → Add a phone or computer.</li>
              <li>{st.passwordSet ? 'Your remote password also signs a device in.' : 'A remote password (below the device list) lets you sign in without a code.'}</li>
              <li>Leave this computer on with Nightjar running; it can sit in the corner next to the clock.</li>
            </ul>
            <div className="setup-nav">
              <span />
              <button className="btn" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function AutoTest({ run }: { run: () => void }) {
  useEffect(() => run(), [run]);
  return null;
}

/** On the phone: Tailscale from the App Store, then Nightjar's address and a pairing code. */
function PhoneSteps({ st, onPaired }: { st: RemoteStatus; onPaired: () => void }) {
  const [code, setCode] = useState<{ code: string; expires: string }>();
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const known = useRef(new Set(st.devices.map((d) => d.id)));
  const newDevice = st.devices.find((d) => !known.current.has(d.id));

  const fresh = useCallback(async () => {
    setError(undefined);
    try {
      setCode(await api.newCode());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void fresh();
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      void api.dropCode().catch(() => undefined);
    };
  }, [fresh]);

  useEffect(() => {
    if (newDevice) onPaired();
  }, [newDevice, onPaired]);

  const left = code ? Math.max(0, Math.round((new Date(code.expires).getTime() - now) / 1000)) : 0;
  const address = st.address ?? '';
  return (
    <div className="phone-steps">
      <div className="phone-step">
        <span className="phone-n">1</span>
        <div>
          <strong>Get Tailscale on your phone</strong>
          <p className="hint-text small">
            Scan with the iPhone or iPad camera to open the App Store, install Tailscale, sign in with the same account
            {st.tailscale.account ? ` (${st.tailscale.account})` : ''} and turn it on. On Android, get Tailscale from Google Play.
          </p>
        </div>
        <Qr text={APP_STORE} label="Tailscale in the App Store" />
      </div>
      <div className="phone-step">
        <span className="phone-n">2</span>
        <div>
          <strong>Open Nightjar on your phone</strong>
          <p className="hint-text small">
            Scan this, or type <code>{address}</code> in Safari. On an iPhone or iPad, add it to the Home Screen when Nightjar asks, then open
            it from the new icon.
          </p>
        </div>
        <Qr text={address} label="Nightjar’s address" />
      </div>
      <div className="phone-step">
        <span className="phone-n">3</span>
        <div>
          <strong>Type this code on your phone</strong>
          {code && left > 0 ? (
            <>
              <div className="pair-code" aria-label={`Code ${code.code.split('').join(' ')}`}>
                {code.code}
              </div>
              <p className="hint-text small">
                Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} more.{' '}
                <span className="spinner" aria-hidden /> Waiting for your phone…
              </p>
            </>
          ) : (
            <p className="hint-text small">
              {code ? 'This code ran out. ' : ''}
              <button className="link" onClick={fresh}>
                Show a new code
              </button>
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      </div>
    </div>
  );
}

/** A QR code, drawn as SVG. */
function Qr({ text, label }: { text: string; label: string }) {
  const svg = useMemo(() => {
    if (!text) return '';
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 3, margin: 2, scalable: true });
  }, [text]);
  if (!svg) return null;
  return <div className="qr" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: svg }} />;
}
