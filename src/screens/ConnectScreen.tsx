import { useState } from 'react';
import { DemoBackend } from '../api/demo';
import { API_BASE, SlskdBackend } from '../api/slskd';
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
        {phase === 'login' ? (
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
        <div className="or">or</div>
        <button className="btn quiet" style={{ width: '100%' }} onClick={demo}>
          Explore with sample data
        </button>
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
