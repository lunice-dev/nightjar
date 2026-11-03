import { useCallback, useEffect, useState } from 'react';
import type { OrganizePlan, RecentMove, WaitingAlbum } from '../api/library';
import { usePrefs } from '../prefs';
import { useStore } from '../store';
import { useFilesAvailable } from '../lib/files';
import { bytes } from '../lib/quality';
import { rescanSoon } from '../lib/shareVersion';
import { openSettings } from '../lib/settingsNav';
import { Cover } from './Cover';
import { CheckResult, useQualityCheck } from './QualityCheck';

/**
 * Everything in your downloads folder that isn't in the library yet (the whole UNSORTED folder, including albums
 * downloaded before nightjar), one album per row: which album it is (from its tags), where it will go, and Put in
 * library in one click. Edit changes the names on the row; an album without a year waits for one (or "No year").
 */

interface Draft {
  plan?: OrganizePlan;
  error?: string;
  album: string;
  artist: string;
  year: string;
  noYear: boolean;
  format: string;
}

const keyOf = (dir: string) => dir.toLowerCase();
const loose = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^the\s+|,\s*the$/g, '').replace(/[^a-z0-9\p{L}]/gu, '');
const folderOf = (d: Draft) => (d.noYear || !d.year.trim() ? d.album.trim() : `${d.year.trim()} - ${d.album.trim()}`);
const yearOk = (d: Draft) => d.noYear || /^(1[89]|20)\d{2}$/.test(d.year.trim());
const ready = (d?: Draft) => !!d?.plan?.root && !!d.album.trim() && !!d.artist.trim() && yearOk(d);
// Keep the group folder ("JP City Pop") only while the artist is the one found in it.
const groupOf = (d: Draft) => (d.plan?.group && loose(d.artist) === loose(d.plan.artist) ? d.plan.group : null);
// Does the artist's folder exist in this format? The app said so for its own suggestion; for a typed name, compare loosely.
const joins = (d: Draft) => !!d.plan?.artistExists && loose(d.artist) === loose(d.plan.artist) && (d.plan.artistFormats ?? [d.format]).includes(d.format);
const tierOf = (format: string) => ({ 'Hi-Res': 'hires', FLAC: 'lossless', MP3: 'mid' })[format] ?? 'unknown';

export function ReadyForLibrary({ busy }: { busy: Set<string> }) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const canFiles = useFilesAvailable();
  const [data, setData] = useState<{ albums: WaitingAlbum[]; recent: RecentMove[] } | null>(null);
  const [limit, setLimit] = useState(12);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [recentOpen, setRecentOpen] = useState(false);
  const [moving, setMoving] = useState(false);

  const load = useCallback(() => {
    backend?.library.waiting().then((d) => d && setData(d));
  }, [backend]);
  useEffect(() => {
    if (!canFiles) return;
    load();
    // An album put in the library from its card above changes this list too.
    window.addEventListener('nightjar-library-changed', load);
    return () => window.removeEventListener('nightjar-library-changed', load);
  }, [canFiles, load]);

  const albums = (data?.albums ?? []).filter((a) => !busy.has(keyOf(a.dir))).sort((a, b) => b.at - a.at);
  const shown = albums.slice(0, limit);

  // What each shown album is: its tags, read by the computer, once.
  useEffect(() => {
    if (!backend) return;
    for (const a of shown) {
      const k = keyOf(a.dir);
      if (drafts[k]) continue;
      setDrafts((d) => ({ ...d, [k]: { album: '', artist: '', year: '', noYear: false, format: 'FLAC' } }));
      backend.library.plan(a.dir).then((p) =>
        setDrafts((d) => ({
          ...d,
          [k]: 'error' in p ? { ...d[k], error: p.error } : { plan: p, album: p.album, artist: p.artist, year: p.year ?? '', noYear: false, format: p.format },
        })),
      );
    }
  }, [backend, shown.map((a) => a.dir).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!canFiles || !data) return null;
  if (albums.length === 0 && data.recent.length === 0) return null;

  const edit = (k: string, change: Partial<Draft>) => setDrafts((d) => ({ ...d, [k]: { ...d[k], ...change } }));

  /** Moves one album; returns where it went, or null (the reason is shown on its row). */
  const move = async (a: WaitingAlbum) => {
    const k = keyOf(a.dir);
    const d = drafts[k];
    if (!backend || !ready(d)) return null;
    const r = await backend.library.move(a.dir, d.format, d.artist.trim(), folderOf(d), groupOf(d));
    if (!r.ok || !r.to) {
      edit(k, { error: r.error ?? 'It couldn’t be moved.' });
      return null;
    }
    usePrefs.getState().albumMoved(a.dir, r.to);
    return r;
  };

  const settle = (dirs: string[]) => {
    setLeaving((s) => new Set([...s, ...dirs.map(keyOf)]));
    setRecentOpen(true);
    if (editing && dirs.some((d) => keyOf(d) === editing)) setEditing(null);
    rescanSoon(2000);
    // The row slides out, then the list is read again (this section listens for the same event).
    setTimeout(() => window.dispatchEvent(new Event('nightjar-library-changed')), 220);
  };

  const putOne = async (a: WaitingAlbum) => {
    setMoving(true);
    const r = await move(a);
    setMoving(false);
    if (!r) return;
    const d = drafts[keyOf(a.dir)];
    toast(r.duplicate ? `${d.album} was already in your library; the download went to the Recycle Bin.` : `${d.album} is in your Library`);
    settle([a.dir]);
  };

  const readyAlbums = albums.filter((a) => ready(drafts[keyOf(a.dir)]));
  const putAll = async () => {
    setMoving(true);
    const done: string[] = [];
    for (const a of readyAlbums) if (await move(a)) done.push(a.dir);
    setMoving(false);
    if (done.length) {
      toast(done.length === 1 ? `${drafts[keyOf(done[0])].album} is in your Library` : `${done.length} albums are in your Library`);
      settle(done);
    }
  };

  const undo = async (m: RecentMove) => {
    const r = await backend!.library.undo(m.id);
    if (r.ok) {
      usePrefs.getState().albumMoved(m.to, m.from);
      window.dispatchEvent(new Event('nightjar-library-undone'));
      rescanSoon(2000);
      toast('Moved back to Downloads');
    } else toast(r.error ?? 'Couldn’t undo it.', 'error');
    setLeaving(new Set());
    load();
  };

  return (
    <section className="dl-section library-section rl" aria-labelledby="unsorted-h">
      {albums.length > 0 && (
        <div className="rl-head">
          <div>
            <h2 id="unsorted-h">
              Ready for your Library<span>{albums.length}</span>
            </h2>
            <p>Albums in your downloads folder that aren’t in your Library yet.</p>
          </div>
          <button className="rl-btn" disabled={!readyAlbums.length || moving} onClick={putAll}>
            Put {readyAlbums.length === albums.length ? 'all' : readyAlbums.length} in library
          </button>
        </div>
      )}
      {albums.length > 0 && (
        <div className="rl-rows">
          {shown.map((a) => (
            <ReadyRow
              key={a.dir}
              a={a}
              d={drafts[keyOf(a.dir)]}
              editing={editing === keyOf(a.dir)}
              leaving={leaving.has(keyOf(a.dir))}
              moving={moving}
              onEdit={() => setEditing((e) => (e === keyOf(a.dir) ? null : keyOf(a.dir)))}
              onChange={(c) => edit(keyOf(a.dir), c)}
              onPut={() => putOne(a)}
            />
          ))}
        </div>
      )}
      {albums.length > limit && (
        <button className="btn quiet small" onClick={() => setLimit((l) => l + 24)}>
          Show more ({albums.length - limit})
        </button>
      )}
      {data.recent.length > 0 && (
        <details className="rl-recent" open={recentOpen} onToggle={(e) => setRecentOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Recently put in your Library ({data.recent.length})</summary>
          <ul>
            {data.recent.map((m) => (
              <li key={m.id}>
                <span>{m.to}</span>
                <button className="rl-link" onClick={() => undo(m)}>
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ReadyRow({
  a,
  d,
  editing,
  leaving,
  moving,
  onEdit,
  onChange,
  onPut,
}: {
  a: WaitingAlbum;
  d: Draft | undefined;
  editing: boolean;
  leaving: boolean;
  moving: boolean;
  onEdit: () => void;
  onChange: (c: Partial<Draft>) => void;
  onPut: () => void;
}) {
  const backend = useStore((s) => s.backend);
  const quality = useQualityCheck(a.dir);
  const searchFor = useStore((s) => s.search);
  const plan = d?.plan;
  const ok = ready(d);
  const group = d ? groupOf(d) : null;
  const discs = a.discs ?? 0;
  const path = d ? ['Library', d.format, ...(group ? [group] : []), d.artist.trim() || '…', folderOf(d) || '…'] : [];

  return (
    <div className={`rl-row${leaving ? ' leaving' : ''}`}>
      <Cover className="rl-cover" dir={a.dir} artist={plan?.artist} album={plan?.album} seed={a.dir} />
      <div className="rl-info">
        <div className="rl-title">{plan ? d!.album || plan.album : a.name}</div>
        <div className="rl-by">
          {plan ? (
            <>
              {d!.artist || plan.artist}
              {!d!.noYear && d!.year ? ` · ${d!.year}` : ''}
            </>
          ) : d?.error ? null : (
            <span className="rl-dim">Reading the album’s tags…</span>
          )}
        </div>
        <div className="rl-facts">
          {plan && <span className={`rl-tier t-${tierOf(d!.format)}`}>{d!.format}</span>}
          <span>
            {a.tracks} {a.tracks === 1 ? 'track' : 'tracks'}
            {discs > 1 ? ` on ${discs} discs` : ''}
          </span>
          <span>{bytes(a.size)}</span>
        </div>
        {d?.error ? (
          <div className="rl-need">{d.error}</div>
        ) : plan && !plan.root ? (
          <div className="rl-need">
            Choose your library folder first.{' '}
            <button className="rl-link" onClick={() => openSettings('library')}>
              Open Settings
            </button>
          </div>
        ) : plan && ok ? (
          <div className="rl-dest">
            <span className="rl-lbl">Goes to</span>
            <span className="rl-path">
              {path.map((p, i) => (
                <span key={i}>
                  {i > 0 && <i>\</i>}
                  {p}
                </span>
              ))}
            </span>
            {joins(d!) ? <span className="rl-tag">joins your {d!.artist.trim()} folder</span> : <span className="rl-tag new">new artist folder</span>}
          </div>
        ) : plan && !yearOk(d!) ? (
          <div className="rl-need">The files don’t say the year. Add it under Edit, or choose “No year”.</div>
        ) : plan ? (
          <div className="rl-need">The album and the artist need a name. Add them under Edit.</div>
        ) : null}
        <div className="rl-from">Folder in Downloads: {a.name}</div>
        {editing && d && plan && (
          <div className="rl-edit">
            <label className="wide">
              Album
              <input value={d.album} onChange={(e) => onChange({ album: e.target.value })} />
            </label>
            <label>
              Year
              <input inputMode="numeric" maxLength={4} placeholder="e.g. 1984" value={d.year} disabled={d.noYear} onChange={(e) => onChange({ year: e.target.value.replace(/\D/g, '') })} />
              <span className="rl-check">
                <input type="checkbox" checked={d.noYear} onChange={(e) => onChange({ noYear: e.target.checked })} /> No year
              </span>
            </label>
            <label>
              Format
              <select value={d.format} onChange={(e) => onChange({ format: e.target.value })}>
                {plan.formats.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="wide">
              Artist
              <input value={d.artist} onChange={(e) => onChange({ artist: e.target.value })} />
            </label>
            {(plan.similar?.length ?? 0) > 0 && !joins(d) && (
              <p className="rl-hint wide">
                Similar folders already in your Library:{' '}
                {plan.similar.map((s) => (
                  <button key={s} className="rl-link" onClick={() => onChange({ artist: s })}>
                    {s}
                  </button>
                ))}
              </p>
            )}
          </div>
        )}
        <CheckResult check={quality} onFindAnother={() => searchFor(a.name.replace(/[\[(].*?[\])]/g, ' '))} />
      </div>
      <div className="rl-acts">
        <button className={`rl-btn${ok ? ' primary' : ''}`} disabled={!ok || moving} onClick={onPut}>
          Put in library
        </button>
        <div className="rl-line">
          <button className="rl-link" onClick={onEdit} disabled={!plan}>
            {editing ? 'Done' : 'Edit'}
          </button>
          <button className="rl-link" disabled={!!quality.running} onClick={quality.run}>
            {quality.running ? `Checking${quality.running.total ? ` ${quality.running.done}/${quality.running.total}` : '…'}` : quality.saved ? 'Check again' : 'Check quality'}
          </button>
          <button className="rl-link" onClick={() => void backend?.files.reveal(a.dir)}>
            Show in folder
          </button>
        </div>
      </div>
    </div>
  );
}
