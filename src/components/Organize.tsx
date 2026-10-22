import { useEffect, useMemo, useState } from 'react';
import type { OrganizePlan } from '../api/library';
import { usePrefs } from '../prefs';
import { useStore } from '../store';
import { rescanSoon } from '../lib/shareVersion';

/**
 * Puts one album into the library: Library\Format\Artist\Year - Album. Shows where it will go, lets you
 * correct every name first, says when the artist's folder is new, and moves only when you confirm.
 */
export function OrganizeDialog({ dir, onClose, onMoved }: { dir: string; onClose: () => void; onMoved?: (to: string, id?: string) => void }) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const go = useStore((s) => s.go);
  const [plan, setPlan] = useState<OrganizePlan>();
  const [error, setError] = useState<string>();
  const [format, setFormat] = useState('FLAC');
  const [artist, setArtist] = useState('');
  const [year, setYear] = useState('');
  const [noYear, setNoYear] = useState(false);
  const [album, setAlbum] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    backend?.library.plan(dir).then((p) => {
      if ('error' in p) setError(p.error);
      else {
        setPlan(p);
        setFormat(p.format);
        setArtist(p.artist);
        setYear(p.year ?? '');
        setAlbum(p.album);
      }
    });
  }, [backend, dir]);

  const yearOk = noYear || /^(1[89]|20)\d{2}$/.test(year.trim());
  const folder = noYear || !year.trim() ? album.trim() : `${year.trim()} - ${album.trim()}`;
  const ready = !!plan?.root && artist.trim() && album.trim() && yearOk;
  const sep = plan?.root?.includes('/') && !plan.root.includes('\\') ? '/' : '\\';
  // Keep the group folder ("JP City Pop") only while the artist is the one found in it.
  const gk = (s: string) => s.toLowerCase().replace(/[^a-z0-9\p{L}]/gu, '');
  const group = plan?.group && gk(artist) === gk(plan.artist) ? plan.group : null;
  const target = plan?.root ? [plan.root.replace(/[\\/]+$/, ''), format, ...(group ? [group] : []), artist.trim() || '…', folder || '…'].join(sep) : '';
  // Does the artist's folder exist? The app said so for its own suggestion; for a typed name, compare loosely.
  const existing = useMemo(() => {
    if (!plan) return false;
    const k = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^the\s+|,\s*the$/g, '').replace(/[^a-z0-9]/g, '');
    return plan.artistExists && k(artist) === k(plan.artist) && (plan.artistFormats ?? [format]).includes(format);
  }, [plan, artist, format]);
  const elsewhere = plan && plan.artistExists && !existing && (plan.artistFormats?.length ?? 0) > 0 ? plan.artistFormats.filter((f) => f !== format) : [];

  const move = async () => {
    if (!backend || !ready) return;
    setBusy(true);
    const r = await backend.library.move(dir, format, artist.trim(), folder, group);
    setBusy(false);
    if (!r.ok || !r.to) {
      setError(r.error ?? 'It couldn’t be moved.');
      return;
    }
    usePrefs.getState().albumMoved(dir, r.to);
    rescanSoon(2000);
    window.dispatchEvent(new Event('nightjar-library-changed'));
    toast(r.duplicate ? `${album} was already in your library; the download went to the Recycle Bin.` : `Moved to ${r.to}`);
    onMoved?.(r.to, r.id);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Put into your library" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>Put into your library</h2>
        {error && <p className="error">{error}</p>}
        {!plan && !error && (
          <p className="hint-text">
            <span className="spinner" aria-hidden /> Reading the album’s tags…
          </p>
        )}
        {plan && !plan.root && (
          <div>
            <p>Choose your library folder first: the folder where your music lives, sorted by artist.</p>
            <button
              className="btn small"
              onClick={() => {
                onClose();
                go('settings');
              }}
            >
              Open Settings
            </button>
          </div>
        )}
        {plan?.root && (
          <>
            <div className="org-grid">
              <label className="field">
                Format folder
                <select className="input" value={format} onChange={(e) => setFormat(e.target.value)}>
                  {plan.formats.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Artist
                <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} />
                <span className={`org-badge ${existing ? 'old' : 'new'}`}>{existing ? 'Existing folder' : 'New folder'}</span>
              </label>
              {(plan.similar?.length ?? 0) > 0 && !existing && (
                <p className="hint-text org-similar">
                  Similar folders already in your library:{' '}
                  {plan.similar.map((s) => (
                    <button key={s} className="link" onClick={() => setArtist(s)}>
                      {s}
                    </button>
                  ))}
                </p>
              )}
              {elsewhere.length > 0 && (
                <p className="hint-text org-similar">
                  {plan.artist} already has a folder in {elsewhere.join(' and ')}; this creates one in {format}.
                </p>
              )}
              {plan.artistGuessed && <p className="hint-text org-similar">The files have no artist tag; this name comes from the folder above the album.</p>}
              <label className="field">
                Year
                <input className="input" inputMode="numeric" maxLength={4} placeholder="e.g. 2007" value={year} disabled={noYear} onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} />
                <span className="org-check">
                  <input type="checkbox" checked={noYear} onChange={(e) => setNoYear(e.target.checked)} /> No year
                </span>
              </label>
              <label className="field">
                Album
                <input className="input" value={album} onChange={(e) => setAlbum(e.target.value)} />
              </label>
            </div>
            {!plan.year && !noYear && !year && <p className="hint-text">The files don’t say the year. Type it, or tick “No year”.</p>}
            <div className="org-target">
              <span className="dim">Goes to</span>
              <code>{target}</code>
            </div>
            <div className="save-row">
              <button className="btn" disabled={!ready || busy} onClick={move}>
                {busy ? 'Moving…' : 'Move'}
              </button>
              <button className="btn quiet" onClick={onClose}>
                Not now
              </button>
            </div>
          </>
        )}
        {!plan?.root && (
          <div className="save-row">
            <button className="btn quiet" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
