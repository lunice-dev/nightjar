import { useState } from 'react';
import { DemoBackend } from '../api/demo';
import { API_BASE, HELPER, SlskdBackend } from '../api/slskd';
import { isIos, pair, standalone, viaTailscale } from '../api/remote';
import { useStore } from '../store';
import { Mark } from '../components/Mark';
import { sharePrefsThrough } from '../prefs';

/**
 * Shown when no engine is reachable, or when slskd asks for a login.
 */
export function ConnectScreen({ error, onRetry }: { error?: string; onRetry: () => void }) {
  const phase = useStore((s) => s.phase);
  const backend = useStore((s) => s.backend);
  const setBackend = useStore((s) => s.setBackend);
  const ready = useStore((s) => s.ready);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string>();

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backend) return;
    setBusy(true);
    setLoginError(undefined);
    try {
      await backend.login(username, password, remember);
      const server = await backend.server();
      ready(server.username);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setLoginError(status === 401 ? 'That username and password didn’t match.' : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const demo = () => {
    sharePrefsThrough(null); // sample data never touches your real preferences
    setBackend(new DemoBackend(), 'ready');
    ready('demo');
  };

  return (
    <main className="connect">
      <div className="connect-card">
        <h1>
          <Mark size={34} /> Nightjar
        </h1>
        {phase === 'login' && viaTailscale ? (
          <PairDevice onDone={onRetry} />
        ) : phase === 'login' ? (
          <>
            <p>Sign in to Nightjar on your computer with its phone login. This isn’t your Soulseek account.</p>
            <form onSubmit={login}>
              <label className="field">
                Username
                <input className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
              </label>
              <label className="field">
                Password
                <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              <label className="toggle" style={{ marginBottom: 18 }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Stay signed in on this computer
              </label>
              {loginError && <p className="error" role="alert">{loginError}</p>}
              <button className="btn" style={{ width: '100%' }} disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </>
        ) : (
          <>
            <p>
              Nightjar’s engine isn’t answering. If you opened this page in a browser, open the Nightjar app on the computer
              it’s installed on (or check it’s still running next to the clock), then try again.
            </p>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn" style={{ width: '100%' }} onClick={onRetry}>
              Try again
            </button>
          </>
        )}
        {!viaTailscale && (
          <>
            <div className="or">or</div>
            <button className="btn quiet" style={{ width: '100%' }} onClick={demo}>
              Explore with sample data
            </button>
          </>
        )}
      </div>
    </main>
  );
}

export async function probeSlskd(): Promise<{ backend: SlskdBackend; phase: 'login' | 'ready'; me?: string }> {
  const backend = new SlskdBackend(API_BASE);
  let needsLogin = await backend.needsLogin();
  if (needsLogin && (await backend.helperLogin())) needsLogin = await backend.needsLogin();
  if (needsLogin) return { backend, phase: 'login' };
  const server = await backend.server();
  return { backend, phase: 'ready', me: server.username };
}

/**
 * A phone or computer opening Nightjar through Tailscale for the first time: it signs in
 * with the code shown in Settings on the computer (or the remote password) and stays signed in.
 * On an iPhone, the Home Screen app keeps its own storage, apart from Safari, so it's added
 * to the Home Screen first and signed in from there.
 */
function PairDevice({ onDone }: { onDone: () => void }) {
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [inSafari, setInSafari] = useState(() => isIos() && !standalone());

  if (inSafari)
    return (
      <div className="pair">
        <p>
          <strong>First, add Nightjar to your Home Screen</strong>, so it opens like an app and stays signed in.
        </p>
        <ol className="pair-steps">
          <li>
            Tap the <strong>Share</strong> button <ShareGlyph /> at the bottom of Safari.
          </li>
          <li>
            Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
          </li>
          <li>Open Nightjar from its new icon and type the code there.</li>
        </ol>
        <button className="link" onClick={() => setInSafari(false)}>
          Use it in Safari instead
        </button>
      </div>
    );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const r = await pair(HELPER, secret);
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.wait ? `${r.error} (${r.wait} s)` : r.error);
  };

  return (
    <form className="pair" onSubmit={submit}>
      <p>
        On your computer, open Nightjar → <strong>Settings</strong> → <strong>Remote access</strong> → <strong>Add a phone or computer</strong>, and
        type the code it shows. Your remote password works too.
      </p>
      <label className="field">
        Code or password
        <input
          className="input pair-input"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoFocus
          required
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn" style={{ width: '100%' }} disabled={busy || !secret.trim()}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

function ShareGlyph() {
  return (
    <svg width="15" height="18" viewBox="0 0 15 18" aria-label="Share" role="img" style={{ verticalAlign: '-3px' }}>
      <path d="M7.5 1v10M4 4.5 7.5 1 11 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 7H2.5v9.5h10V7H10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
