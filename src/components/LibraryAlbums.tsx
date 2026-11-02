import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AlbumTracks, LibAlbum } from '../api/library';
import { onThisComputer } from '../api/remote';
import { useCheckAll, verdictText } from '../lib/check';
import { usePcShell } from '../lib/pcShell';
import { usePlayer } from '../lib/player';
import { bytes } from '../lib/quality';
import { usePrefs, type SavedCheck } from '../prefs';
import { useStore } from '../store';
import { AlbumPlay } from './AlbumPlay';
import { Cover } from './Cover';
import { Icon } from './Icon';
import { addToPlaylist } from './Playlists';
import { CheckButton, CheckResult, useQualityCheck } from './QualityCheck';

export const tone = (sev: number) => (sev < 0 ? 'none' : sev >= 7 ? 'bad' : sev >= 3 ? 'warn' : 'ok');
const mark = (t: string) => (t === 'ok' ? '✓' : t === 'warn' ? '⚠' : t === 'none' ? '–' : '✕');

/** "FLAC 16/44.1", "Hi-Res 24/96", "MP3". */
export function quality(a: LibAlbum) {
  if (a.format === 'MP3' || !a.bits) return a.format;
  return `${a.format} ${a.bits}/${(a.rate / 1000).toFixed(a.rate % 1000 ? 1 : 0)}`;
}

const tierOf = (format: string) => (format === 'Hi-Res' ? 't-hires' : format === 'FLAC' ? 't-lossless' : 't-unknown');

type Filter = 'all' | 'tidy' | 'copies' | 'unchecked' | 'wrong';
type View = 'covers' | 'list';
type Sort = 'artist' | 'year' | 'size' | 'check';

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['tidy', 'To tidy'],
  ['copies', 'Copies'],
  ['unchecked', 'Not checked'],
  ['wrong', 'Look wrong'],
];
const SORTS: [Sort, string][] = [
  ['artist', 'Artist'],
  ['year', 'Newest'],
  ['size', 'Largest'],
  ['check', 'Check result'],
];
const FORMAT_ORDER = ['Hi-Res', 'FLAC', 'MP3'];

/** A choice remembered on this device only (the view isn't something to sync to a phone). */
function useStored<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const s = localStorage.getItem(`nightjar.lib.${key}`);
      return allowed.includes(s as T) ? (s as T) : fallback;
    } catch {
      return fallback;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(`nightjar.lib.${key}`, v);
    } catch {
      /* private window or blocked storage: the choice just isn't remembered */
    }
  };
  return [value, set] as const;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Every album in the library. The top shows the library's shape (how much is Hi-Res, FLAC, MP3) and what needs
 * attention; below it a cover wall or a list, and on a wide window the chosen album's details sit beside it.
 */
export function AlbumsView({ albums, onReview, panelSlot }: { albums: LibAlbum[]; onReview: () => void; /** On a computer, where the chosen album's panel is docked (beside the page, not in it). */ panelSlot?: HTMLElement | null }) {
  const docked = usePcShell() && !!panelSlot;
  const checks = usePrefs((s) => s.checks);
  const [filter, setFilter] = useState<Filter>('all');
  const [format, setFormat] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [view, setView] = useStored<View>('view', 'covers', ['covers', 'list']);
  const [sort, setSort] = useStored<Sort>('sort', 'artist', ['artist', 'year', 'size', 'check']);
  const [selected, setSelected] = useState<string | null>(null);

  const list = useMemo(() => albums.filter((a) => a.status !== 'skip'), [albums]);
  const checkOf = useCallback((a: LibAlbum) => checks[a.dir.toLowerCase()], [checks]);

  const counts = useMemo(
    () => ({
      all: list.length,
      tidy: list.filter((a) => a.status === 'move' || a.status === 'needsYear').length,
      copies: list.filter((a) => a.dupKey).length,
      unchecked: list.filter((a) => !checkOf(a)).length,
      wrong: list.filter((a) => (checkOf(a)?.severity ?? 0) >= 3).length,
    }),
    [list, checkOf],
  );

  // The library's shape, in a fixed order; anything unusual counts as "Other".
  const shape = useMemo(() => {
    const n = new Map<string, number>();
    for (const a of list) n.set(a.format, (n.get(a.format) ?? 0) + 1);
    return [...n.entries()].sort((x, y) => (FORMAT_ORDER.indexOf(x[0]) + 1 || 9) - (FORMAT_ORDER.indexOf(y[0]) + 1 || 9));
  }, [list]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const sev = (a: LibAlbum) => checkOf(a)?.severity ?? -2;
    const byArtist = (a: LibAlbum, b: LibAlbum) =>
      a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) || (a.year ?? '').localeCompare(b.year ?? '') || a.album.localeCompare(b.album);
    return list
      .filter((a) => !format || a.format === format)
      .filter((a) =>
        filter === 'tidy' ? a.status === 'move' || a.status === 'needsYear' : filter === 'copies' ? !!a.dupKey : filter === 'unchecked' ? !checkOf(a) : filter === 'wrong' ? sev(a) >= 3 : true,
      )
      .filter((a) => words.every((w) => `${a.artist} ${a.album} ${a.year ?? ''} ${a.rel}`.toLowerCase().includes(w)))
      .sort((a, b) => {
        if (sort === 'year') return (b.year ?? '').localeCompare(a.year ?? '') || byArtist(a, b);
        if (sort === 'size') return b.size - a.size || byArtist(a, b);
        if (sort === 'check') return sev(b) - sev(a) || byArtist(a, b);
        return byArtist(a, b);
      });
  }, [list, format, filter, q, sort, checkOf]);

  // Under each artist's name, as the folders will be (only when sorted by artist).
  const groups = useMemo(() => {
    if (sort !== 'artist') return [['', shown]] as [string, LibAlbum[]][];
    const g: [string, LibAlbum[]][] = [];
    for (const a of shown) {
      const last = g[g.length - 1];
      if (last && last[0].toLowerCase() === a.artist.toLowerCase()) last[1].push(a);
      else g.push([a.artist, [a]]);
    }
    return g;
  }, [shown, sort]);

  const current = selected ? list.find((a) => a.dir === selected) : undefined;
  const select = useCallback((dir: string) => setSelected((s) => (s === dir ? null : dir)), []);
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current]);

  return (
    <>
      <LibraryBar shape={shape} total={list.length} format={format} onFormat={setFormat} counts={counts} albums={list} onReview={onReview} />
      <div className="lx-toolbar">
        <input className="input lx-search" placeholder="Find an artist or album" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find in your library" />
        <div className="lx-chips">
          {FILTERS.map(([f, label]) => (
            <button key={f} className="chip plain" aria-pressed={filter === f} disabled={f !== 'all' && counts[f] === 0} onClick={() => setFilter(f)}>
              {label} <span className="n">{counts[f]}</span>
            </button>
          ))}
        </div>
        <span className="foot-gap" />
        <label className="lx-sort">
          <span className="dim">Sort</span>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort albums by">
            {SORTS.map(([s, label]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="lx-seg" role="group" aria-label="View">
          <button aria-pressed={view === 'covers'} onClick={() => setView('covers')}>
            Covers
          </button>
          <button aria-pressed={view === 'list'} onClick={() => setView('list')}>
            List
          </button>
        </div>
      </div>

      <div className="lx-wrap">
        <div className={`lx-split${current && !docked ? ' open' : ''}`}>
          <div className="lx-main">
            {shown.length === 0 && <p className="hint-text">Nothing here.</p>}
            {view === 'covers' ? (
              groups.map(([artist, items]) => (
                <section key={artist || 'all'} className="lx-group" aria-label={artist || 'Albums'}>
                  {artist && <h2 className="lx-artist">{artist}</h2>}
                  <div className="lx-grid">
                    {items.map((a) => (
                      <Tile key={a.dir} a={a} c={checkOf(a)} selected={a.dir === selected} onSelect={select} />
                    ))}
                  </div>
                </section>
              ))
            ) : (
              <AlbumTable albums={shown} checkOf={checkOf} selected={selected} onSelect={select} sort={sort} onSort={setSort} />
            )}
          </div>
          {current && (docked ? createPortal(<AlbumDetail key={current.dir} a={current} docked onClose={() => setSelected(null)} />, panelSlot!) : <AlbumDetail key={current.dir} a={current} onClose={() => setSelected(null)} />)}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ the top: shape and checking

function LibraryBar({
  shape,
  total,
  format,
  onFormat,
  counts,
  albums,
  onReview,
}: {
  shape: [string, number][];
  total: number;
  format: string | null;
  onFormat: (f: string | null) => void;
  counts: { tidy: number; copies: number; unchecked: number };
  albums: LibAlbum[];
  onReview: () => void;
}) {
  const checks = usePrefs((s) => s.checks);
  const all = useCheckAll();
  const startAll = (again: boolean) => all.start(albums.filter((a) => again || !checks[a.dir.toLowerCase()]).map((a) => a.dir));
  const name = all.current?.split(/[\\/]/).pop();
  const toggle = (f: string) => onFormat(format === f ? null : f);

  return (
    <div className="lx-bar">
      <div className="lx-shape" role="group" aria-label="Albums by format">
        <div className="lx-ribbon" aria-hidden>
          {shape.map(([f, n]) => (
            <button key={f} tabIndex={-1} className={`${tierOf(f)}${format && format !== f ? ' off' : ''}`} style={{ flexGrow: n }} onClick={() => toggle(f)} title={`${f}: ${n}`} />
          ))}
        </div>
        <div className="lx-legend">
          {shape.map(([f, n]) => (
            <button key={f} className={`lx-key ${tierOf(f)}`} aria-pressed={format === f} onClick={() => toggle(f)}>
              <span className="lx-dot" aria-hidden />
              {f} <b>{n.toLocaleString()}</b>
              {total > 0 && <span className="dim"> {Math.round((n / total) * 100) || '<1'}%</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="lx-actions">
        {all.running ? (
          <>
            <span className="lx-running" role="status">
              <span className="spinner" aria-hidden /> Checking {Math.min(all.done + 1, all.total)} of {all.total}
              {name && <span className="dim lx-running-name"> · {name}{all.currentTracks?.total ? ` (${all.currentTracks.done}/${all.currentTracks.total})` : ''}</span>}
            </span>
            <button className="btn quiet small" onClick={all.stop}>
              Stop
            </button>
          </>
        ) : (
          <>
            {counts.tidy > 0 && (
              <button className="btn quiet small" onClick={onReview} title="Move everything into Format\Artist\Year - Album. Nothing moves until you press Apply.">
                Review and tidy…
              </button>
            )}
            {counts.unchecked > 0 ? (
              <button className="btn small" onClick={() => startAll(false)} title="A check reads every file: real lossless, real hi-res, honest bitrate, damaged files. About half a minute per album; it carries on while you use Nightjar.">
                Check {counts.unchecked === total ? 'all' : `the ${counts.unchecked} left`}
              </button>
            ) : (
              total > 0 && (
                <button className="btn quiet small" onClick={() => startAll(true)}>
                  Check all again
                </button>
              )
            )}
          </>
        )}
      </div>

      {!all.running && all.failed.length > 0 && (
        <p className="lx-fails">
          {all.failed.length === 1 ? 'One album couldn’t be checked' : `${all.failed.length} albums couldn’t be checked`}:{' '}
          {all.failed.slice(0, 3).map((f, i) => (
            <span key={f.dir}>
              {i > 0 && '; '}
              <b>{f.dir.split(/[\\/]/).slice(-2).join(' — ')}</b> ({f.error.replace(/\.$/, '')})
            </span>
          ))}
          {all.failed.length > 3 && `; and ${all.failed.length - 3} more`}. They aren’t tried again unless you press Check again.
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the cover wall

const Tile = memo(function Tile({ a, c, selected, onSelect }: { a: LibAlbum; c: SavedCheck | undefined; selected: boolean; onSelect: (dir: string) => void }) {
  // Nothing sits on the cover: what needs a look is a line of plain text under it.
  const t = c ? tone(c.severity) : null;
  const problem = t === 'warn' || t === 'bad' ? { text: verdictText(c!.verdict), tone: t } : null;
  const flags = [a.status === 'needsYear' ? 'no year' : a.status === 'move' ? 'not tidy' : null, a.dupKey ? 'copy' : null].filter(Boolean);
  return (
    <div className={`lx-tile ${tierOf(a.format)}${selected ? ' selected' : ''}`}>
      <div className="lx-art">
        <button className="lx-art-hit" onClick={() => onSelect(a.dir)} onDoubleClick={() => void usePlayer.getState().openOrPlayAlbum(a.dir)} aria-pressed={selected} aria-label={`${a.album}${a.year ? `, ${a.year}` : ''}: details`}>
          <Cover className="lx-cover" dir={a.dir} artist={a.artist} album={a.album} seed={a.dir} online={false} />
        </button>
      </div>
      <div className="lx-caption">
        <span className="lx-name" title={a.album}>
          {a.album}
        </span>
        <span className="lx-sub">
          {a.year && `${a.year} · `}
          {quality(a)}
        </span>
        {(problem || flags.length > 0) && (
          <span className="lx-note">
            {problem && <span className={problem.tone}>{problem.text}</span>}
            {problem && flags.length > 0 && ' · '}
            {flags.join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
});

// ------------------------------------------------------------------ the list

function AlbumTable({
  albums,
  checkOf,
  selected,
  onSelect,
  sort,
  onSort,
}: {
  albums: LibAlbum[];
  checkOf: (a: LibAlbum) => SavedCheck | undefined;
  selected: string | null;
  onSelect: (dir: string) => void;
  sort: Sort;
  onSort: (s: Sort) => void;
}) {
  const head = (s: Sort, label: string) => (
    <th aria-sort={sort === s ? 'ascending' : undefined}>
      <button className="lx-th" onClick={() => onSort(s)} aria-pressed={sort === s}>
        {label}
      </button>
    </th>
  );
  return (
    <table className="lx-table">
      <thead>
        <tr>
          <th className="lx-c-art" />
          {head('artist', 'Album')}
          {head('year', 'Year')}
          <th>Quality</th>
          <th className="num">Tracks</th>
          {head('size', 'Size')}
          {head('check', 'Check')}
        </tr>
      </thead>
      <tbody>
        {albums.map((a) => {
          const c = checkOf(a);
          const t = c ? tone(c.severity) : null;
          return (
            <tr key={a.dir} className={a.dir === selected ? 'selected' : undefined} onClick={() => onSelect(a.dir)} onDoubleClick={() => void usePlayer.getState().openOrPlayAlbum(a.dir)}>
              <td className="lx-c-art">
                <Cover className="lx-mini" dir={a.dir} artist={a.artist} album={a.album} seed={a.dir} online={false} />
              </td>
              <td className="lx-c-name">
                <button className="lx-row-title" onClick={(e) => { e.stopPropagation(); onSelect(a.dir); }} aria-pressed={a.dir === selected}>
                  {a.album}
                </button>
                <span className="lx-row-artist">{a.artist}</span>
                {a.status === 'needsYear' ? <span className="lib-flag">no year</span> : a.status === 'move' && <span className="lib-flag">not tidy</span>}
                {a.dupKey && <span className="lib-flag">copy</span>}
              </td>
              <td className="num">{a.year ?? ''}</td>
              <td>
                <span className={`lib-q format ${tierOf(a.format)}`}>{quality(a)}</span>
              </td>
              <td className="num">{a.tracks ? a.tracks.toLocaleString() : ''}</td>
              <td className="num">{a.size > 0 ? bytes(a.size) : ''}</td>
              <td>{c && t && <span className={`check-chip ${t}`}>{mark(t)} {verdictText(c.verdict)}</span>}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ------------------------------------------------------------------ one album

function AlbumDetail({ a, onClose, docked = false }: { a: LibAlbum; onClose: () => void; docked?: boolean }) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const searchFor = useStore((s) => s.search);
  const check = useQualityCheck(a.dir);
  const [tracks, setTracks] = useState<AlbumTracks | null | undefined>();
  const playing = usePlayer((s) => s.queue[s.index]?.path);

  useEffect(() => {
    let gone = false;
    backend?.library.tracks(a.dir).then((t) => !gone && setTracks(t));
    return () => {
      gone = true;
    };
  }, [backend, a.dir]);

  const reveal = async () => {
    if (!(await backend?.files.reveal(a.dir))) toast('Couldn’t open Explorer. The folder may have been moved.', 'error');
  };
  const discs = new Set(tracks?.tracks.map((t) => t.disc)).size > 1;

  // On a computer the album sits in a panel docked beside the page: the cover, what it is, what to do with it, and
  // the tracks scrolling on their own. Nothing is boxed.
  if (docked) {
    const p = usePlayer.getState();
    const trackList = (
      <>
        {tracks === undefined ? (
          <p className="hint-text">
            <span className="spinner" aria-hidden /> Reading the tracks…
          </p>
        ) : tracks && tracks.tracks.length > 0 ? (
          <>
            <h3 className="lx-panel-h">
              {tracks.tracks.length} {tracks.tracks.length === 1 ? 'track' : 'tracks'}
            </h3>
            <ol className="lx-tracks">
              {tracks.tracks.map((t, i) => (
                <li key={t.path}>
                  <button className={`lx-track${playing === t.path ? ' now' : ''}`} onClick={() => void p.playAlbum(a.dir, i)} title="Play from this track">
                    <span className="lx-no">{discs && t.disc ? `${t.disc}.` : ''}{t.no || ''}</span>
                    <span className="lx-track-title">{t.title}</span>
                    <span className="dim">{t.seconds ? mmss(t.seconds) : ''}</span>
                  </button>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="hint-text">nightjar couldn’t read the tracks. The folder may have been moved.</p>
        )}
      </>
    );
    return (
      <aside className="lx-panel" aria-label={`${a.album}, details`}>
        <button className="lx-panel-close" onClick={onClose} title="Close (Esc)">
          Close
        </button>
        <div className="lx-panel-head">
          <Cover className="lx-panel-cover" dir={a.dir} artist={a.artist} album={a.album} seed={a.dir} online={false} />
          <h2>{a.album}</h2>
          <p className="lx-panel-by">
            {a.artist}
            {a.year && <span className="dim"> · {a.year}</span>}
          </p>
          <p className="lx-panel-facts">
            <span className={`lx-panel-q ${tierOf(a.format)}`}>{quality(a)}</span>
            <span>
              {a.tracks.toLocaleString()} {a.tracks === 1 ? 'track' : 'tracks'}
              {a.size > 0 && <> · {bytes(a.size)}</>}
            </span>
            {a.kind === 'discs' && <span>several discs</span>}
            {a.kind === 'box' && <span>box set</span>}
            {a.status === 'move' && <span className="lx-flag">not tidy</span>}
            {a.status === 'needsYear' && <span className="lx-flag">no year</span>}
            {a.dupKey && <span className="lx-flag">copy</span>}
          </p>
          <div className="lx-panel-acts">
            <button className="lx-go" onClick={() => void p.playAlbum(a.dir)}>
              Play
            </button>
            <button className="lx-act" onClick={() => void p.addAlbum(a.dir, 'next')}>
              Play next
            </button>
            <button className="lx-act" onClick={() => void p.addAlbum(a.dir, 'end')}>
              Queue
            </button>
            <button className="lx-act" onClick={() => tracks?.tracks.length && addToPlaylist(tracks.tracks.map((t) => ({ ...t, dir: tracks.dir })))} disabled={!tracks?.tracks.length}>
              Playlist
            </button>
            <CheckButton check={check} />
            {onThisComputer && (
              <button className="lx-act" onClick={reveal} title="Show in the folder">
                Folder
              </button>
            )}
          </div>
        </div>
        <div className="lx-panel-scroll">
          <CheckResult check={check} onFindAnother={() => searchFor(`${a.artist} ${a.album}`)} />
          {!check.saved && !check.running && !check.error && <p className="hint-text">Not checked yet.</p>}
          <code className="lx-path">{a.rel}</code>
          {trackList}
        </div>
      </aside>
    );
  }

  return (
    <aside className="lx-detail" aria-label={`${a.album}, details`}>
      <button className="btn quiet small icon-only lx-close" onClick={onClose} aria-label="Close details" title="Close (Esc)">
        <Icon name="close" size={16} />
      </button>
      <Cover className="lx-detail-cover" dir={a.dir} artist={a.artist} album={a.album} seed={a.dir} online={false} />
      <div className="lx-detail-head">
        <h2>{a.album}</h2>
        <p>
          {a.artist}
          {a.year && <span className="dim"> · {a.year}</span>}
        </p>
      </div>
      <div className="lib-meta">
        <span className={`lib-q format ${tierOf(a.format)}`}>{quality(a)}</span>
        <span>
          {a.tracks.toLocaleString()} {a.tracks === 1 ? 'track' : 'tracks'}
          {a.size > 0 && <> · {bytes(a.size)}</>}
        </span>
        {a.kind === 'discs' && <span>several discs</span>}
        {a.kind === 'box' && <span>box set</span>}
        {a.status === 'move' && <span className="lib-flag">not tidy</span>}
        {a.status === 'needsYear' && <span className="lib-flag">no year</span>}
        {a.dupKey && <span className="lib-flag">copy</span>}
      </div>
      <div className="lx-detail-actions">
        <AlbumPlay variant="buttons" dir={a.dir} title={a.album} />
        <CheckButton check={check} />
        {onThisComputer && (
          <button className="btn quiet small icon-only" onClick={reveal} title="Show in folder" aria-label="Show in folder">
            <Icon name="reveal" size={16} />
          </button>
        )}
      </div>
      <CheckResult check={check} onFindAnother={() => searchFor(`${a.artist} ${a.album}`)} />
      {!check.saved && !check.running && !check.error && <p className="hint-text">Not checked yet.</p>}
      <code className="lx-path">{a.rel}</code>
      {tracks === undefined ? (
        <p className="hint-text">
          <span className="spinner" aria-hidden /> Reading the tracks…
        </p>
      ) : tracks && tracks.tracks.length > 0 ? (
        <ol className="lx-tracks">
          {tracks.tracks.map((t, i) => (
            <li key={t.path}>
              <button className={`lx-track${playing === t.path ? ' now' : ''}`} onClick={() => void usePlayer.getState().playAlbum(a.dir, i)} title="Play from this track">
                <span className="lx-no">{discs && t.disc ? `${t.disc}.` : ''}{t.no || ''}</span>
                <span className="lx-track-title">{t.title}</span>
                <span className="dim">{t.seconds ? mmss(t.seconds) : ''}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="hint-text">Nightjar couldn’t read the tracks. The folder may have been moved.</p>
      )}
    </aside>
  );
}
