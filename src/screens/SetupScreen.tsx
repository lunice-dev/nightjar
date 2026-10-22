import { useEffect, useState } from 'react';
import { Mark } from '../components/Mark';
import { useStore } from '../store';

/**
 * First start: three short steps for someone who has never used Soulseek.
 * 1. a Soulseek name and password (Soulseek creates the account the first time),
 * 2. where downloads go and what to share,
 * 3. signing in, with plain answers when it doesn't work.
 */
type Step = 'account' | 'folders' | 'signing';

export function SetupScreen({ onDone }: { onDone: () => void }) {
  const backend = useStore((s) => s.backend);
  const [step, setStep] = useState<Step>('account');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [downloadDir, setDownloadDir] = useState('');
  const [shared, setShared] = useState<string[]>([]);
  const [canPick, setCanPick] = useState(false);
  const [music, setMusic] = useState<{ music: string | null; musicInOneDrive: boolean }>({ music: null, musicInOneDrive: false });
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!backend) return;
    backend.settings().then((s) => {
      setDownloadDir(s.downloadDir);
      setShared(s.sharedFolders);
    }).catch(() => {});
    backend.account().then((a) => a.username && setUsername(a.username)).catch(() => {});
    backend.folders.available().then(setCanPick).catch(() => {});
    backend.folders.known().then(setMusic).catch(() => {});
  }, [backend]);

  const nameProblem =
    username.trim().length === 0
      ? 'Choose a name.'
      : username.length > 30
        ? 'Soulseek names have at most 30 characters.'
        : username !== username.trim()
          ? 'A name can’t start or end with a space.'
          : null;
  const passProblem = password.length === 0 ? 'Choose a password.' : null;

  const pick = async (start?: string) => {
    try {
      return await backend!.folders.pick(start);
    } catch {
      return null;
    }
  };

  const finish = async () => {
    if (!backend) return;
    setStep('signing');
    setError(undefined);
    try {
      setStatus('Saving your folders…');
      await backend.saveSettings({ downloadDir, sharedFolders: shared });
      setStatus('Signing in to Soulseek…');
      const r = await backend.signIn(username, password);
      if (r === 'ok') {
        setStatus('Done.');
        onDone();
        return;
      }
      setStep('account');
      setError(
        r === 'rejected'
          ? `Soulseek didn’t accept “${username}” with that password. Someone else probably has this name: choose another one. If it’s your account, check the password.`
          : r === 'kicked'
            ? 'This account is signed in somewhere else, for example in SoulseekQt. Close the other program (including its icon next to the clock) and try again.'
            : 'Soulseek didn’t answer. Check that this computer is online and try again.',
      );
    } catch (e) {
      setStep('folders');
      setError((e as Error).message);
    }
  };

  return (
    <main className="connect setup">
      <div className="connect-card setup-card">
        <h1>
          <Mark size={34} /> Nightjar
        </h1>
        <ol className="setup-steps" aria-label="Setup">
          <li aria-current={step === 'account' ? 'step' : undefined}>Account</li>
          <li aria-current={step === 'folders' ? 'step' : undefined}>Folders</li>
          <li aria-current={step === 'signing' ? 'step' : undefined}>Ready</li>
        </ol>

        {step === 'account' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!nameProblem && !passProblem) {
                setError(undefined);
                setStep('folders');
              }
            }}
          >
            <p>
              Nightjar finds music on Soulseek, a network of people sharing their collections. Choose a name and a password.
              If the name is free, Soulseek creates your account the first time you sign in. No email needed.
            </p>
            <label className="field">
              Soulseek name
              <input className="input" autoComplete="username" maxLength={30} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </label>
            <label className="field">
              Password
              <span className="pass-row">
                <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="btn quiet small" onClick={() => setShow((v) => !v)}>
                  {show ? 'Hide' : 'Show'}
                </button>
              </span>
            </label>
            <p className="hint-text">Already use SoulseekQt or another client? Use the same name and password. Your details stay on this computer.</p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="btn" style={{ width: '100%' }} disabled={!!nameProblem || !!passProblem}>
              Next
            </button>
          </form>
        )}

        {step === 'folders' && (
          <div>
            <p>Where should downloads go, and what do you share? Sharing is how Soulseek works: people download faster from those who share.</p>
            <div className="setup-folder">
              <div>
                <strong>Downloads</strong>
                <span className="path">{downloadDir || 'Not chosen yet'}</span>
              </div>
              {canPick && (
                <button className="btn quiet small" onClick={async () => { const p = await pick(downloadDir); if (p) setDownloadDir(p); }}>
                  Change
                </button>
              )}
            </div>
            <div className="setup-folder column">
              <strong>Shared folders</strong>
              {shared.length === 0 && <span className="hint-text">Nothing shared yet. Your music folder is a good start.</span>}
              {music.music && !shared.includes(music.music) && (
                <button className="btn small" onClick={() => setShared((s) => [...s, music.music!])}>
                  Share my Music folder
                </button>
              )}
              {shared.map((f) => (
                <span key={f} className="shared-row">
                  <span className="path">{f}</span>
                  <button className="link" onClick={() => setShared((s) => s.filter((x) => x !== f))}>
                    Remove
                  </button>
                </span>
              ))}
              {music.music && shared.includes(music.music) && music.musicInOneDrive && (
                <span className="hint-text">
                  Your Music folder is in OneDrive. Files that are only in the cloud are downloaded to this computer when
                  Nightjar reads them. If that’s a lot, share a folder that is on this computer instead.
                </span>
              )}
              {canPick && (
                <button className="btn quiet small" onClick={async () => { const p = await pick(music.music ?? undefined); if (p && !shared.includes(p)) setShared((s) => [...s, p]); }}>
                  {shared.length ? 'Add another folder' : 'Choose a folder'}
                </button>
              )}
            </div>
            <p className="hint-text">You can change all of this later in Settings.</p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <div className="setup-nav">
              <button className="btn quiet" onClick={() => setStep('account')}>
                Back
              </button>
              <button className="btn" disabled={!downloadDir} onClick={finish}>
                Sign in to Soulseek
              </button>
            </div>
          </div>
        )}

        {step === 'signing' && (
          <p className="hint-text" role="status">
            <span className="spinner" aria-hidden /> {status}
          </p>
        )}
      </div>
    </main>
  );
}
