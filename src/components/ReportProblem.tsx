import { onThisComputer } from '../api/remote';
import { useState } from 'react';
import { HELPER } from '../api/slskd';
import { useFilesAvailable } from '../lib/files';
import { useStore } from '../store';

/**
 * "Something went wrong?": puts Nightjar's recent logs and settings (never passwords or keys) in one zip in
 * Downloads, to send to whoever gave you Nightjar. Nightjar itself sends nothing.
 */
export function ReportProblem() {
  const backend = useStore((s) => s.backend);
  const canFiles = useFilesAvailable();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ path?: string; error?: string }>();
  if (!canFiles) return null;
  const make = async () => {
    setBusy(true);
    setDone(undefined);
    try {
      const res = await fetch(`${HELPER}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note }),
        signal: AbortSignal.timeout(60_000),
      });
      const r = (await res.json()) as { ok: boolean; path?: string; error?: string };
      setDone(r.ok ? { path: r.path } : { error: r.error ?? 'Couldn’t make the report.' });
      if (r.ok) setNote('');
    } catch (e) {
      setDone({ error: `The Nightjar app didn’t answer (${(e as Error).message}).` });
    }
    setBusy(false);
  };
  return (
    <section className="report" aria-labelledby="report-h">
      <h2 id="report-h">Something not working?</h2>
      <p className="hint-text">
        Make a report and send it to whoever gave you Nightjar. It holds Nightjar’s recent logs and settings, never your passwords or keys, and it
        stays on your computer until you send it.
      </p>
      <textarea
        className="input report-note"
        rows={3}
        placeholder="What happened? What did you click, what did you expect? (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="What happened"
      />
      <div className="report-row">
        <button className="btn small" disabled={busy} onClick={make}>
          {busy ? 'Making the report…' : 'Make a report'}
        </button>
        {done?.path && (
          <span className="hint-text report-done">
            Saved in Downloads{onThisComputer ? '' : ' on your computer'}: <b>{done.path.split(/[\\/]/).pop()}</b>{' '}
            {onThisComputer && (
              <button className="link" onClick={() => backend?.files.reveal(done.path!)}>
                Show in folder
              </button>
            )}
          </span>
        )}
        {done?.error && <span className="error">{done.error}</span>}
      </div>
    </section>
  );
}
