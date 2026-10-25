import { onThisComputer } from '../api/remote';
import { useId, useState } from 'react';
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
  const [done, setDone] = useState<{ path?: string; name?: string; error?: string }>();
  const id = useId();
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
      const r = (await res.json()) as { ok: boolean; path?: string; name?: string; error?: string };
      setDone(r.ok ? { path: r.path, name: r.name } : { error: r.error ?? 'Couldn’t make the report.' });
      if (r.ok) setNote('');
    } catch (e) {
      setDone({ error: `The Nightjar app didn’t answer (${(e as Error).message}).` });
    }
    setBusy(false);
  };
  /** From a phone or iPad: gets the zip from the PC so it can be sent from here (share sheet, or a download). */
  const save = async () => {
    if (!done?.name) return;
    try {
      const res = await fetch(`${HELPER}/report/file?name=${encodeURIComponent(done.name)}`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error('The report isn’t on the computer any more.');
      const file = new File([await res.blob()], done.name, { type: 'application/zip' });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Nightjar report' }).catch((e: Error) => {
          if (e.name !== 'AbortError') throw e;
        });
        return;
      }
      const url = URL.createObjectURL(file);
      const a = Object.assign(document.createElement('a'), { href: url, download: done.name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setDone({ ...done, error: (e as Error).message });
    }
  };
  return (
    <section className="report" aria-labelledby={id}>
      <h2 id={id}>Something not working?</h2>
      <p className="hint-text">
        Make a report and send it to whoever gave you Nightjar. It holds Nightjar’s recent logs and settings, what remote access is doing and your devices’ names (never passwords or keys), and it
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
            {onThisComputer ? (
              <button className="link" onClick={() => backend?.files.reveal(done.path!)}>
                Show in folder
              </button>
            ) : (
              <button className="link" onClick={save}>
                Send or save it from here
              </button>
            )}
          </span>
        )}
        {done?.error && <span className="error">{done.error}</span>}
      </div>
    </section>
  );
}
