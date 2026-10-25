import { usePlayer } from '../lib/player';
import { AlbumPlay } from '../components/AlbumPlay';
import { onThisComputer } from '../api/remote';
import { useEffect, useMemo, useState } from 'react';
import type { LibAlbum, LibraryInfo } from '../api/library';
import { Cover } from '../components/Cover';
import { Icon } from '../components/Icon';
import { CheckButton, CheckResult, useQualityCheck } from '../components/QualityCheck';
import { useCheckAll, verdictText } from '../lib/check';
import { useFilesAvailable } from '../lib/files';
import { placeOf, useLibraryReview, type AlbumEdit } from '../lib/libraryReview';
import { bytes } from '../lib/quality';
import { rescanSoon } from '../lib/shareVersion';
import { usePrefs } from '../prefs';
import { useStore } from '../store';

const tone = (sev: number) => (sev < 0 ? 'none' : sev >= 7 ? 'bad' : sev >= 3 ? 'warn' : 'ok');

/** "FLAC 16/44.1", "Hi-Res 24/96", "MP3". */
function quality(a: LibAlbum) {
  if (a.format === 'MP3' || !a.bits) return a.format;
  return `${a.format} ${a.bits}/${(a.rate / 1000).toFixed(a.rate % 1000 ? 1 : 0)}`;
}

/**
 * Your music library: every album in it, a quality check for any of them (or all of them, in the
 * background), and a review that tidies the whole library into Format\Artist\Year - Album, moving
 * nothing until you apply it, with undo.
 */
export function LibraryScreen() {
  const backend = useStore((s) => s.backend);
  const go = useStore((s) => s.go);
  const canFiles = useFilesAvailable();
  const [info, setInfo] = useState<LibraryInfo | null>();
  const [view, setView] = useState<'albums' | 'review'>('albums');
  const { scan, scanning, error, load } = useLibraryReview();

  useEffect(() => {
    if (!backend || !canFiles) return;
    backend.library.info().then((i) => {
      setInfo(i);
      if (i?.root && i.exists) void useLibraryReview.getState().load();
    });
  }, [backend, canFiles]);

  const albums = scan?.albums ?? [];

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1 className="page-title">{view === 'review' ? 'Tidy your library' : 'Library'}</h1>
            <p className="page-sub">
              {view === 'review' ? (
                <>
                  Everything goes to <b>Format\Artist\Year - Album</b>. Nothing moves until you press Apply, and you can undo it.
                </>
              ) : info?.root ? (
                <>
                  {albums.length > 0 && `${albums.filter((a) => a.status !== 'skip').length} albums · ${bytes(albums.reduce((t, a) => t + a.size, 0))} · `}
                  <span className="dim">{info.root}</span>
                </>
              ) : (
                'Your music, checked and kept in order.'
              )}
            </p>
          </div>
          {info?.root && scan && (
            <div className="lib-head-actions">
              {view === 'albums' ? (
                <>
                  <button className="btn quiet small" disabled={!!scanning} onClick={() => load(true)} title="Look through the library folder again">
                    <Icon name="retry" size={16} /> Look again
                  </button>
                </>
              ) : (
                <button className="btn quiet small" onClick={() => setView('albums')}>
                  ← All albums
                </button>
              )}
            </div>
          )}
        </div>

        {!canFiles && <p className="callout">The library lives on the computer running the Nightjar app. Open Nightjar there to see it.</p>}
        {canFiles && info && !info.root && (
          <div className="callout">
            <p>Choose your library folder first: the folder where your music lives, sorted by format and artist.</p>
            <button className="btn small" onClick={() => go('settings')}>
              Open Settings
            </button>
          </div>
        )}
        {canFiles && info?.root && !info.exists && <p className="callout">Nightjar can’t find {info.root}. Is the drive connected?</p>}
        {error && <p className="error">{error}</p>}
        {scanning && (
          <p className="hint-text lib-scanning">
            <span className="spinner" aria-hidden /> Looking through your library{scanning.total ? ` · ${scanning.done} of ${scanning.total} albums` : '…'}
          </p>
        )}

        {scan && info?.root && (view === 'albums' ? <AlbumsView albums={albums} onReview={() => setView('review')} /> : <ReviewView albums={albums} root={info.root} />)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ every album

type Filter = 'all' | 'tidy' | 'copies' | 'unchecked' | 'wrong';

function AlbumsView({ albums, onReview }: { albums: LibAlbum[]; onReview: () => void }) {
  const checks = usePrefs((s) => s.checks);
  const all = useCheckAll();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const list = albums.filter((a) => a.status !== 'skip');
  const checkOf = (a: LibAlbum) => checks[a.dir.toLowerCase()];
  const counts = {
    all: list.length,
    tidy: list.filter((a) => a.status === 'move' || a.status === 'needsYear').length,
    copies: list.filter((a) => a.dupKey).length,
    unchecked: list.filter((a) => !checkOf(a)).length,
    wrong: list.filter((a) => (checkOf(a)?.severity ?? 0) >= 3).length,
  };
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = list
    .filter((a) =>
      filter === 'tidy' ? a.status === 'move' || a.status === 'needsYear' : filter === 'copies' ? !!a.dupKey : filter === 'unchecked' ? !checkOf(a) : filter === 'wrong' ? (checkOf(a)?.severity ?? 0) >= 3 : true,
    )
    .filter((a) => words.every((w) => `${a.artist} ${a.album} ${a.year ?? ''} ${a.rel}`.toLowerCase().includes(w)))
    .sort((a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) || (a.year ?? '').localeCompare(b.year ?? '') || a.album.localeCompare(b.album));

  // Group by artist, as the folders will be.
  const groups: [string, LibAlbum[]][] = [];
  for (const a of shown) {
    const last = groups[groups.length - 1];
    if (last && last[0].toLowerCase() === a.artist.toLowerCase()) last[1].push(a);
    else groups.push([a.artist, [a]]);
  }

  const startAll = (again: boolean) => all.start(list.filter((a) => again || !checkOf(a)).map((a) => a.dir));
  const FILTERS: [Filter, string][] = [
    ['all', 'All'],
    ['tidy', 'To tidy'],
    ['copies', 'Copies'],
    ['unchecked', 'Not checked'],
    ['wrong', 'Look wrong'],
  ];

  return (
    <>
      <CheckAllBar onStart={startAll} unchecked={counts.unchecked} total={list.length} />
      {counts.tidy > 0 && (
        <div className="callout lib-tidy-callout">
          <span>
            <b>{counts.tidy}</b> {counts.tidy === 1 ? 'album isn’t' : 'albums aren’t'} in Format\Artist\Year - Album yet
            {counts.copies > 0 && (
              <>
                , and <b>{counts.copies}</b> are copies of the same album
              </>
            )}
            .
          </span>
          <button className="btn small" onClick={onReview}>
            Review and tidy…
          </button>
        </div>
      )}
      <div className="filters lib-filters">
        <input className="input lib-search" placeholder="Find an artist or album" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find in your library" />
        {FILTERS.map(([f, label]) => (
          <button key={f} className="chip plain" aria-pressed={filter === f} disabled={f !== 'all' && counts[f] === 0} onClick={() => setFilter(f)}>
            {label} <span className="n">{counts[f]}</span>
          </button>
        ))}
      </div>
      {groups.length === 0 && <p className="hint-text">Nothing here.</p>}
      {groups.map(([artist, items]) => (
        <section key={artist} className="lib-artist" aria-label={artist}>
          <h2 className="lib-artist-name">{artist}</h2>
          {items.map((a) => (
            <AlbumRow key={a.dir} a={a} />
          ))}
        </section>
      ))}
    </>
  );
}

function CheckAllBar({ onStart, unchecked, total }: { onStart: (again: boolean) => void; unchecked: number; total: number }) {
  const all = useCheckAll();
  if (all.running) {
    const name = all.current?.split(/[\\/]/).pop();
    return (
      <div className="lib-checkall running" role="status">
        <span className="spinner" aria-hidden />
        <span className="lib-checkall-text">
          Checking {Math.min(all.done + 1, all.total)} of {all.total}
          {name && <span className="dim"> · {name}{all.currentTracks?.total ? ` (${all.currentTracks.done}/${all.currentTracks.total})` : ''}</span>}
        </span>
        <span className="foot-gap" />
        <button className="btn quiet small" onClick={all.stop}>
          Stop
        </button>
      </div>
    );
  }
  return (
    <div className="lib-checkall">
      <span className="lib-checkall-text">
        {all.total > 0 && all.done > 0 ? (
          <>
            Checked {all.done} {all.done === 1 ? 'album' : 'albums'}.{' '}
            {all.failed.length > 0 && (
              <>
                {all.failed.length === 1 ? 'One couldn’t be checked' : `${all.failed.length} couldn’t be checked`}:{' '}
                {all.failed.slice(0, 3).map((f, i) => (
                  <span key={f.dir}>
                    {i > 0 && '; '}
                    <b>{f.dir.split(/[\\/]/).slice(-2).join(' — ')}</b> ({f.error.replace(/\.$/, '')})
                  </span>
                ))}
                {all.failed.length > 3 && `; and ${all.failed.length - 3} more`}. They won’t be tried again unless you press Check again.{' '}
              </>
            )}
          </>
        ) : null}
        {unchecked > 0 ? `${unchecked} of ${total} albums haven’t been checked.` : 'Every album has been checked.'}
        <span className="dim"> A check reads every file: real lossless, real hi-res, honest bitrate, damaged files. About half a minute per album; it carries on while you use Nightjar.</span>
      </span>
      <span className="foot-gap" />
      {unchecked > 0 && (
        <button className="btn small" onClick={() => onStart(false)}>
          Check {unchecked === total ? 'all' : `the ${unchecked} left`}
        </button>
      )}
      {unchecked < total && (
        <button className="btn quiet small" onClick={() => onStart(true)}>
          Check all again
        </button>
      )}
    </div>
  );
}

function AlbumRow({ a }: { a: LibAlbum }) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const searchFor = useStore((s) => s.search);
  const check = useQualityCheck(a.dir);
  const [open, setOpen] = useState(false);
  const reveal = async () => {
    if (!(await backend?.files.reveal(a.dir))) toast('Couldn’t open Explorer. The folder may have been moved.', 'error');
  };
  const c = check.saved;
  return (
    <div className="lib-row">
      <button className="cover-open" onClick={() => usePlayer.getState().openAlbum(a.dir)} aria-label={`Open ${a.album}`}>
        <Cover className="lib-cover" dir={a.dir} artist={a.artist} album={a.album} seed={a.dir} online={false} />
      </button>
      <div className="lib-main">
        <button className="lib-title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {a.album}
          {a.year && <span className="dim"> · {a.year}</span>}
        </button>
        <div className="lib-meta">
          <span className={`lib-q ${a.format === 'Hi-Res' ? 'hires' : a.format === 'FLAC' ? 'lossless' : ''}`}>{quality(a)}</span>
          <span>
            {a.tracks} tracks · {bytes(a.size)}
          </span>
          {a.kind === 'discs' && <span>several discs</span>}
          {a.kind === 'box' && <span>box set</span>}
          {a.status === 'move' && <span className="lib-flag">not tidy</span>}
          {a.status === 'needsYear' && <span className="lib-flag">no year</span>}
          {a.dupKey && <span className="lib-flag">copy</span>}
          {c && !check.running && (
            <button className={`check-chip ${tone(c.severity)}`} onClick={() => setOpen((o) => !o)}>
              {tone(c.severity) === 'ok' ? '✓ ' : tone(c.severity) === 'warn' ? '⚠ ' : tone(c.severity) === 'none' ? '– ' : '✕ '}
              {verdictText(c.verdict)}
            </button>
          )}
        </div>
        {open && (
          <div className="lib-detail">
            <code>{a.rel}</code>
            <CheckResult check={check} onFindAnother={() => searchFor(`${a.artist} ${a.album}`)} />
            {!c && !check.running && <p className="hint-text">Not checked yet.</p>}
          </div>
        )}
      </div>
      <div className="lib-actions">
        <AlbumPlay variant="icon" dir={a.dir} title={a.album} />
        <CheckButton check={check} />
        {onThisComputer && (
          <button className="btn quiet small icon-only" onClick={reveal} title="Show in folder" aria-label="Show in folder">
            <Icon name="reveal" size={16} />
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the review

function ReviewView({ albums, root }: { albums: LibAlbum[]; root: string }) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const { edits, unticked, keptCopies, batches, load, loadBatches, tick } = useLibraryReview();
  const [applying, setApplying] = useState<{ done: number; total: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<{ moved: number; failed: { dir: string; error?: string }[]; batch: string } | null>(null);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const live = albums.filter((a) => a.status !== 'skip');
  const skipped = albums.filter((a) => a.status === 'skip');

  // Copies not yet decided: they wait until you choose.
  const copyGroups = useMemo(() => {
    const m = new Map<string, LibAlbum[]>();
    for (const a of live) if (a.dupKey && !keptCopies.includes(a.dupKey)) m.set(a.dupKey, [...(m.get(a.dupKey) ?? []), a]);
    return [...m.entries()].filter(([, g]) => g.length > 1);
  }, [live, keptCopies]);
  const waitingOnCopies = new Set(copyGroups.flatMap(([, g]) => g.map((a) => a.dir)));

  const places = new Map(live.map((a) => [a.dir, placeOf(a, edits[a.dir], root)]));
  const candidates = live.filter((a) => !waitingOnCopies.has(a.dir) && !places.get(a.dir)!.inPlace);
  // Albums without a year stay in their own list while you type it.
  const needYear = candidates.filter((a) => a.status === 'needsYear');
  const tidy = candidates.filter((a) => a.status !== 'needsYear');
  const chosen = [...needYear, ...tidy].filter((a) => !unticked[a.dir] && places.get(a.dir)!.ready);
  const inPlace = live.length - candidates.length - waitingOnCopies.size;

  // Group the moves by the artist folder they go to.
  const byArtist = new Map<string, LibAlbum[]>();
  for (const a of tidy) {
    const k = places.get(a.dir)!.artist;
    byArtist.set(k, [...(byArtist.get(k) ?? []), a]);
  }
  const artistGroups = [...byArtist.entries()].sort((x, y) => x[0].localeCompare(y[0], undefined, { sensitivity: 'base' }));
  // Renaming an artist renames their whole folder: the albums already in place too.
  const everyAlbumOf = (artist: string) => live.filter((a) => places.get(a.dir)!.artist.toLowerCase() === artist.toLowerCase()).map((a) => a.dir);

  const apply = async () => {
    if (!backend) return;
    setConfirm(false);
    const moves = chosen.map((a) => places.get(a.dir)!.move);
    setApplying({ done: 0, total: moves.length });
    const start = await backend.library.apply(moves);
    if (!start.id) {
      setApplying(null);
      toast(start.error ?? 'Couldn’t start moving.', 'error');
      return;
    }
    for (;;) {
      await new Promise((r) => setTimeout(r, 600));
      const p = await backend.library.applyProgress(start.id);
      if (!p) continue;
      setApplying({ done: p.done, total: p.total });
      if (!p.finished) continue;
      for (const r of p.results) if (r.ok && r.to && !r.unchanged) usePrefs.getState().albumMoved(r.dir, r.to);
      const moved = p.results.filter((r) => r.ok && !r.unchanged).length;
      setResult({ moved, failed: p.results.filter((r) => !r.ok), batch: p.batch });
      setApplying(null);
      rescanSoon(3000);
      // What moved is done; what you unticked or changed and didn't move stays as you left it.
      const movedDirs = new Set(p.results.filter((r) => r.ok).map((r) => r.dir));
      useLibraryReview.setState((s) => ({
        edits: Object.fromEntries(Object.entries(s.edits).filter(([d]) => !movedDirs.has(d))),
        unticked: Object.fromEntries(Object.entries(s.unticked).filter(([d]) => !movedDirs.has(d))),
      }));
      await load(true);
      await loadBatches();
      return;
    }
  };

  const undo = async (batch: string) => {
    if (!backend) return;
    const r = await backend.library.undoBatch(batch);
    for (const m of r.moved ?? []) usePrefs.getState().albumMoved(m.from, m.to);
    if (r.ok) toast(`Put ${r.undone} ${r.undone === 1 ? 'album' : 'albums'} back where ${r.undone === 1 ? 'it was' : 'they were'}.`);
    else toast(r.error ?? `${r.undone ?? 0} went back; ${r.failed?.length ?? 0} couldn’t: ${r.failed?.[0]?.error ?? ''}`, 'error');
    setResult(null);
    rescanSoon(3000);
    await load(true);
    await loadBatches();
  };

  return (
    <div className="review">
      <ul className="review-summary">
        <li>
          <b>{inPlace}</b> already in place
        </li>
        <li>
          <b>{tidy.length}</b> to tidy
        </li>
        {needYear.length > 0 && (
          <li>
            <b>{needYear.length}</b> need a year
          </li>
        )}
        {copyGroups.length > 0 && (
          <li>
            <b>{copyGroups.length}</b> {copyGroups.length === 1 ? 'album has' : 'albums have'} copies
          </li>
        )}
        {skipped.length > 0 && (
          <li>
            <b>{skipped.length}</b> to sort by hand
          </li>
        )}
      </ul>

      {result && (
        <div className="callout review-result" role="status">
          <span>
            Moved {result.moved} {result.moved === 1 ? 'album' : 'albums'}.
            {result.failed.length > 0 && ` ${result.failed.length} couldn’t be moved: ${result.failed[0].error ?? ''}`}
          </span>
          {result.moved > 0 && (
            <button className="btn quiet small" onClick={() => undo(result.batch)}>
              Undo
            </button>
          )}
        </div>
      )}

      {copyGroups.length > 0 && (
        <section className="review-section">
          <h2 className="dl-section-head">
            Copies of the same album <span className="n">{copyGroups.length}</span>
          </h2>
          <p className="hint-text">Keep the copy you want and send the others to the Recycle Bin, or keep them all. A quality check helps you choose.</p>
          {copyGroups.map(([key, g]) => (
            <CopiesCard key={key} copies={g} onKeepAll={() => useLibraryReview.getState().keepCopies(key)} />
          ))}
        </section>
      )}

      {needYear.length > 0 && (
        <section className="review-section">
          <h2 className="dl-section-head">
            Need a year <span className="n">{needYear.length}</span>
          </h2>
          <p className="hint-text">The files don’t say when these came out. Type the year, or tick “No year” to leave it out of the name.</p>
          {needYear.map((a) => (
            <YearRow key={a.dir} a={a} edit={edits[a.dir]} root={root} />
          ))}
        </section>
      )}

      <section className="review-section">
        <h2 className="dl-section-head">
          To tidy <span className="n">{tidy.length}</span>
        </h2>
        {tidy.length === 0 ? (
          <p className="hint-text">Nothing to move{copyGroups.length + needYear.length > 0 ? ' until you decide the ones above' : ': your library is in order'}.</p>
        ) : (
          <p className="hint-text">
            Untick anything you’d rather leave where it is. Change a name with Edit; change an artist’s name once for all their albums.{' '}
            <button className="link" onClick={() => tidy.forEach((a) => tick(a.dir, true))}>
              Tick all
            </button>{' '}
            ·{' '}
            <button className="link" onClick={() => tidy.forEach((a) => tick(a.dir, false))}>
              Untick all
            </button>
          </p>
        )}
        {artistGroups.map(([artist, items]) => (
          <TidyGroup key={artist} artist={artist} items={items} all={everyAlbumOf(artist)} root={root} />
        ))}
      </section>

      {skipped.length > 0 && (
        <details className="review-section review-skipped">
          <summary>
            Sort by hand <span className="n">{skipped.length}</span>
          </summary>
          <ul>
            {skipped.map((a) => (
              <li key={a.dir}>
                <code>{a.rel || a.dir}</code>
                <span className="dim">{a.note}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {batches.length > 0 && (
        <details className="review-section review-batches">
          <summary>Earlier changes</summary>
          <ul>
            {batches.map((b) => (
              <li key={b.batch}>
                <span>
                  Moved {b.count} {b.count === 1 ? 'album' : 'albums'} · {new Date(b.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </span>
                <button className="link" onClick={() => undo(b.batch)}>
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="review-bar">
        {applying ? (
          <span>
            <span className="spinner" aria-hidden /> Moving {applying.done} of {applying.total}…
          </span>
        ) : result ? (
          <span>
            Moved {result.moved} {result.moved === 1 ? 'album' : 'albums'}
            {result.failed.length > 0 && `; ${result.failed.length} couldn’t be moved`}.{' '}
            {result.moved > 0 && (
              <button className="link" onClick={() => undo(result.batch)}>
                Undo
              </button>
            )}{' '}
            <button className="link" onClick={() => setResult(null)}>
              OK
            </button>
          </span>
        ) : (
          <span>
            <b>{chosen.length}</b> of {tidy.length + needYear.length} ready to move
          </span>
        )}
        <span className="foot-gap" />
        <button className="btn" disabled={chosen.length === 0 || !!applying} onClick={() => setConfirm(true)}>
          Apply {chosen.length || ''}
        </button>
      </div>

      {confirm && (
        <div className="modal-backdrop" onClick={() => setConfirm(false)}>
          <div className="modal" role="dialog" aria-label="Apply the changes" onClick={(e) => e.stopPropagation()}>
            <h2>
              Move {chosen.length} {chosen.length === 1 ? 'album' : 'albums'}?
            </h2>
            <p>
              They move inside your library folder; nothing is deleted. Folders left empty are tidied away. Albums never merge: if a folder with the same name is already there, the
              second one gets “(2)”.
            </p>
            <p className="hint-text">You can undo the whole lot afterwards.</p>
            <div className="save-row">
              <button className="btn" onClick={apply}>
                Move {chosen.length}
              </button>
              <button className="btn quiet" onClick={() => setConfirm(false)}>
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CopiesCard({ copies, onKeepAll }: { copies: LibAlbum[]; onKeepAll: () => void }) {
  const first = copies[0];
  return (
    <div className="copies">
      <div className="copies-head">
        <b>
          {first.artist} — {first.album}
        </b>
        <span className="dim">{copies.length} copies</span>
        <span className="foot-gap" />
        <button className="btn quiet small" onClick={onKeepAll}>
          Keep all
        </button>
      </div>
      {copies.map((a) => (
        <CopyRow key={a.dir} a={a} />
      ))}
    </div>
  );
}

function CopyRow({ a }: { a: LibAlbum }) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const check = useQualityCheck(a.dir);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const recycle = async () => {
    if (!backend) return;
    setBusy(true);
    const r = await backend.library.recycle(a.dir);
    setBusy(false);
    setSure(false);
    if (!r.ok) {
      toast(r.error ?? 'Couldn’t move it to the Recycle Bin.', 'error');
      return;
    }
    usePrefs.getState().saveCheck(a.dir, null);
    toast(`Moved ${a.rel} to the Recycle Bin`);
    rescanSoon(3000);
    await useLibraryReview.getState().load(true);
  };
  return (
    <div className="copy-row">
      <div className="copy-main">
        <code>{a.rel}</code>
        <div className="lib-meta">
          <span className={`lib-q ${a.format === 'Hi-Res' ? 'hires' : a.format === 'FLAC' ? 'lossless' : ''}`}>{quality(a)}</span>
          <span>
            {a.tracks} tracks · {bytes(a.size)}
          </span>
          {a.year && <span>{a.year}</span>}
          {a.target && a.status === 'move' && <span className="dim">if kept, goes to {a.target.slice(a.dir.length - a.rel.length)}</span>}
        </div>
        <CheckResult check={check} />
      </div>
      <div className="lib-actions">
        <CheckButton check={check} />
        {sure ? (
          <>
            <button className="btn small danger" disabled={busy} onClick={recycle}>
              {busy ? 'Moving…' : 'Move to Recycle Bin'}
            </button>
            <button className="btn quiet small" onClick={() => setSure(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="btn quiet small" onClick={() => setSure(true)}>
            <Icon name="trash" size={16} /> Remove this copy
          </button>
        )}
      </div>
    </div>
  );
}

function YearRow({ a, edit, root }: { a: LibAlbum; edit?: AlbumEdit; root: string }) {
  const set = useLibraryReview((s) => s.edit);
  const p = placeOf(a, edit, root);
  return (
    <div className="year-row">
      <div className="copy-main">
        <b>
          {a.artist} — {a.album}
        </b>
        <code>{p.ready ? `→ ${p.target.slice(root.replace(/[\\/]+$/, '').length + 1)}` : a.rel}</code>
      </div>
      <input
        className="input year-input"
        inputMode="numeric"
        maxLength={4}
        placeholder="Year"
        aria-label={`Year of ${a.album}`}
        value={edit?.year ?? ''}
        onChange={(e) => set(a.dir, { year: e.target.value.replace(/\D/g, ''), noYear: undefined })}
      />
      <label className="org-check">
        <input type="checkbox" checked={!!edit?.noYear} onChange={(e) => set(a.dir, { noYear: e.target.checked || undefined })} /> No year
      </label>
    </div>
  );
}

function TidyGroup({ artist, items, all, root }: { artist: string; items: LibAlbum[]; all: string[]; root: string }) {
  const editArtist = useLibraryReview((s) => s.editArtist);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(artist);
  const fromTags = items[0].artistFromTags;
  return (
    <div className="tidy-group">
      <div className="tidy-artist">
        {renaming ? (
          <form
            className="tidy-rename"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) editArtist(all, name.trim());
              setRenaming(false);
            }}
          >
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Artist folder name" />
            <button className="btn small">Use this name</button>
            <button type="button" className="btn quiet small" onClick={() => setRenaming(false)}>
              Cancel
            </button>
          </form>
        ) : (
          <>
            <h3>{artist}</h3>
            {items.some((a) => a.artistGuessed) && <span className="dim">from the folder name; the files have no artist tag</span>}
            {fromTags && fromTags !== artist && !items.some((a) => a.artistGuessed) && <span className="dim">tags say “{fromTags}”</span>}
            <button
              className="link"
              onClick={() => {
                setName(artist);
                setRenaming(true);
              }}
            >
              {all.length > 1 ? `Rename all ${all.length} albums` : 'Rename'}
            </button>
          </>
        )}
      </div>
      {items.map((a) => (
        <TidyRow key={a.dir} a={a} root={root} />
      ))}
    </div>
  );
}

function TidyRow({ a, root }: { a: LibAlbum; root: string }) {
  const { edits, unticked, edit, tick } = useLibraryReview();
  const e = edits[a.dir];
  const p = placeOf(a, e, root);
  const [editing, setEditing] = useState(false);
  const rel = (path: string) => (path.toLowerCase().startsWith(root.toLowerCase()) ? path.slice(root.replace(/[\\/]+$/, '').length + 1) : path);
  const on = !unticked[a.dir] && p.ready;
  return (
    <div className={`tidy-row ${on ? '' : 'off'}`}>
      <input type="checkbox" checked={on} disabled={!p.ready} onChange={(ev) => tick(a.dir, ev.target.checked)} aria-label={`Move ${a.album}`} />
      <div className="tidy-main">
        <div className="tidy-paths">
          <code className="from">{a.rel}</code>
          <span className="arrow" aria-hidden>
            →
          </span>
          <code className="to">{rel(p.target)}</code>
        </div>
        <div className="tidy-why">
          {(e ? [...a.reasons.filter((r) => r.includes('→ ') && !r.startsWith('Renamed') && !r.startsWith('Artist folder')), 'Changed by you'] : a.reasons).map((r) => (
            <span key={r}>{r}</span>
          ))}
          {a.kind === 'discs' && <span>Disc folders stay inside</span>}
          {a.kind === 'box' && <span>Box set kept together</span>}
        </div>
        {editing && (
          <div className="org-grid tidy-edit">
            <label className="field">
              Format folder
              <select className="input" value={p.format} onChange={(ev) => edit(a.dir, { format: ev.target.value })}>
                {['FLAC', 'Hi-Res', 'MP3', 'Other'].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Artist
              <input className="input" value={e?.artist ?? a.artist} onChange={(ev) => edit(a.dir, { artist: ev.target.value })} />
            </label>
            <label className="field">
              Year
              <input
                className="input"
                inputMode="numeric"
                maxLength={4}
                disabled={!!e?.noYear}
                value={e?.year ?? a.year ?? ''}
                onChange={(ev) => edit(a.dir, { year: ev.target.value.replace(/\D/g, '') })}
              />
              <span className="org-check">
                <input type="checkbox" checked={!!e?.noYear} onChange={(ev) => edit(a.dir, { noYear: ev.target.checked || undefined })} /> No year
              </span>
            </label>
            <label className="field">
              Album
              <input className="input" value={e?.album ?? a.album} onChange={(ev) => edit(a.dir, { album: ev.target.value })} />
            </label>
          </div>
        )}
      </div>
      <div className="lib-actions">
        <button className="btn quiet small" onClick={() => setEditing((x) => !x)}>
          {editing ? 'Done' : 'Edit'}
        </button>
        {e && (
          <button className="link" onClick={() => useLibraryReview.setState((s) => ({ edits: Object.fromEntries(Object.entries(s.edits).filter(([k]) => k !== a.dir)) }))}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
