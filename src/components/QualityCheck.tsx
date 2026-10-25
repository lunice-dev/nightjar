import { useState } from 'react';
import { usePrefs } from '../prefs';
import { checkNote, runCheck, useCheckAll, verdictText } from '../lib/check';
import { useStore } from '../store';
import { QualityGuide } from './QualityGuide';

/** Severity to a tone: green, amber or red. */
const tone = (sev: number) => (sev < 0 ? 'none' : sev >= 7 ? 'bad' : sev >= 3 ? 'warn' : 'ok');

/**
 * Checks an album's files when you ask: whether the FLAC is really lossless, whether hi-res and 24-bit are
 * real, whether an MP3's bitrate is honest, and whether any file is damaged. The result stays with the album.
 */
export function useQualityCheck(dir: string | undefined) {
  const backend = useStore((s) => s.backend);
  const saved = usePrefs((s) => (dir ? s.checks[dir.toLowerCase()] : undefined));
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string>();

  const run = async () => {
    if (!backend || !dir) return;
    setError(undefined);
    setRunning({ done: 0, total: 0 });
    const e = await runCheck(backend, dir, (done, total) => setRunning({ done, total }));
    setRunning(null);
    if (e) setError(e);
  };
  // The background "Check all" may be on this very album.
  const mine = useCheckAll((s) => !!dir && s.current?.toLowerCase() === dir.toLowerCase());
  const bgDone = useCheckAll((s) => (mine ? (s.currentTracks?.done ?? 0) : 0));
  const bgTotal = useCheckAll((s) => (mine ? (s.currentTracks?.total ?? 0) : 0));
  return { saved, running: running ?? (mine ? { done: bgDone, total: bgTotal } : null), error, run };
}

export function CheckButton({ check }: { check: ReturnType<typeof useQualityCheck> }) {
  return (
    <button className="btn quiet small" disabled={!!check.running} onClick={check.run} title="Check that the files are what they claim: real lossless, real hi-res, honest bitrate, not damaged">
      {check.running ? (
        <>
          <span className="spinner" aria-hidden /> Checking{check.running.total ? ` ${check.running.done}/${check.running.total}` : '…'}
        </>
      ) : check.saved ? (
        'Check again'
      ) : (
        'Check quality'
      )}
    </button>
  );
}

export function CheckResult({ check, onFindAnother }: { check: ReturnType<typeof useQualityCheck>; onFindAnother?: () => void }) {
  const [open, setOpen] = useState(false);
  const c = check.saved;
  if (check.error) return <p className="error check-line">{check.error}</p>;
  if (!c) return null;
  const t = tone(c.severity);
  return (
    <div className={`check ${t}`}>
      <div className="check-head">
        <span className={`check-chip ${t}`}>{t === 'ok' ? '✓ ' : t === 'warn' ? '⚠ ' : t === 'none' ? '– ' : '✕ '}{verdictText(c.verdict)}</span>
        <span className="check-note">{checkNote(c)}</span>
        {c.tracks.length > 0 && (
          <button className="link" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide tracks' : 'Each track'}
          </button>
        )}
        {t !== 'ok' && t !== 'none' && onFindAnother && (
          <button className="link" onClick={onFindAnother}>
            Find another copy
          </button>
        )}
      </div>
      {open && (
        <table className="check-tracks">
          <tbody>
            {c.tracks.map((x) => (
              <tr key={x.name} className={tone(x.severity)}>
                <td className="name">{x.name}</td>
                <td className="verdict">{verdictText(x.verdict)}</td>
                <td className="dim">{x.cutoff ? `${(x.cutoff / 1000).toFixed(1)} kHz` : ''}</td>
                <td className="dim note">{x.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <QualityGuide first="checks" />
    </div>
  );
}
