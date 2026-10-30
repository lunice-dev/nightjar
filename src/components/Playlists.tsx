import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import type { PlaylistSummary, Track } from '../api/library';
import { usePlayer } from '../lib/player';
import { useStore } from '../store';
import { Cover } from './Cover';
import { Icon } from './Icon';

/** Tells every list of playlists on screen to read them again. */
export const playlistsChanged = () => window.dispatchEvent(new Event('nightjar-playlists'));

/** The playlists, kept fresh whenever one changes. */
export function usePlaylists() {
  const backend = useStore((s) => s.backend);
  const [list, setList] = useState<PlaylistSummary[] | null>(null);
  const load = useCallback(async () => {
    if (!backend) return;
    setList(await backend.library.playlists().catch(() => null));
  }, [backend]);
  useEffect(() => {
    void load();
    window.addEventListener('nightjar-playlists', load);
    return () => window.removeEventListener('nightjar-playlists', load);
  }, [load]);
  return list;
}

export const fmtLength = (seconds: number) => {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** A playlist's cover: the picture chosen for it, one album's cover, or a mosaic of up to four of its albums. */
export function PlaylistCover({ p, className = '' }: { p: Pick<PlaylistSummary, 'id' | 'cover' | 'mosaic' | 'name'>; className?: string }) {
  const backend = useStore((s) => s.backend);
  const [picture, setPicture] = useState<string | null>(null);
  useEffect(() => {
    if (!p.cover?.startsWith('image:') || !backend) {
      setPicture(null);
      return;
    }
    let alive = true;
    backend.files.pictureUrl(p.cover.slice(6)).then((u) => alive && setPicture(u));
    return () => {
      alive = false;
    };
  }, [p.cover, backend]);

  if (picture)
    return (
      <span className={`pl-cover ${className}`}>
        <img src={picture} alt="" />
      </span>
    );
  if (p.cover?.startsWith('album:'))
    return (
      <span className={`pl-cover ${className}`}>
        <Cover dir={p.cover.slice(6)} seed={p.cover} online={false} />
      </span>
    );
  const dirs = p.mosaic;
  if (dirs.length === 0)
    return (
      <span className={`pl-cover empty ${className}`}>
        <PlaylistGlyph />
      </span>
    );
  if (dirs.length === 1)
    return (
      <span className={`pl-cover ${className}`}>
        <Cover dir={dirs[0]} seed={dirs[0]} online={false} />
      </span>
    );
  // Two albums make a checkerboard, three fill three corners and repeat the first: always four squares.
  const four = dirs.length >= 4 ? dirs.slice(0, 4) : dirs.length === 3 ? [dirs[0], dirs[1], dirs[2], dirs[0]] : [dirs[0], dirs[1], dirs[1], dirs[0]];
  return (
    <span className={`pl-cover mosaic ${className}`}>
      {four.map((d, i) => (
        <Cover key={`${d}-${i}`} dir={d} seed={d} online={false} />
      ))}
    </span>
  );
}

export function PlaylistGlyph() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 6h12M4 11h12M4 16h7M17 13.5V20M17 13.5l3.5-1.2" />
      <circle cx="15" cy="20" r="2" />
    </svg>
  );
}

// ------------------------------------------------------------------ "Add to playlist"

type Adding = (Track & { dir: string })[];
const usePicker = create<{ adding: Adding | null }>(() => ({ adding: null }));

/** Asks which playlist the tracks go to (or makes a new one). */
export const addToPlaylist = (tracks: Adding) => {
  if (tracks.length) usePicker.setState({ adding: tracks });
};

/** Rendered once by the app; shows itself while tracks are being added to a playlist. */
export function PlaylistPicker() {
  const adding = usePicker((s) => s.adding);
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const list = usePlaylists();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) {
      setName('');
      setError(undefined);
    }
  }, [adding]);

  if (!adding || !backend) return null;
  const close = () => usePicker.setState({ adding: null });
  const what = adding.length === 1 ? adding[0].title : `${adding.length} tracks`;

  const into = async (p: PlaylistSummary) => {
    setBusy(true);
    const r = await backend.library.changePlaylist({ action: 'add', id: p.id, tracks: adding });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    playlistsChanged();
    toast(`${what} added to ${p.name}.`);
    close();
  };
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const r = await backend.library.changePlaylist({ action: 'create', name: name.trim(), tracks: adding });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    playlistsChanged();
    toast(`${what} added to the new playlist ${name.trim()}.`);
    close();
  };

  return (
    <div className="modal-backdrop pl-picker-back" onClick={close}>
      <div className="modal pl-picker" role="dialog" aria-label="Add to a playlist" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && close()}>
        <h2>Add to a playlist</h2>
        <p className="hint-text">{what}</p>
        <form className="pl-new" onSubmit={create}>
          <input ref={input} className="input" placeholder="New playlist name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <button className="btn" disabled={busy || !name.trim()}>
            Create
          </button>
        </form>
        {error && <p className="error">{error}</p>}
        <ul className="pl-pick-list">
          {list?.map((p) => (
            <li key={p.id}>
              <button onClick={() => into(p)} disabled={busy}>
                <PlaylistCover p={p} />
                <span>
                  <strong>{p.name}</strong>
                  <span className="dim">
                    {p.count} {p.count === 1 ? 'track' : 'tracks'}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {list && list.length === 0 && <li className="dim pl-none">No playlists yet: name one above.</li>}
          {!list && (
            <li className="dim pl-none">
              <span className="spinner" aria-hidden /> Reading your playlists…
            </li>
          )}
        </ul>
        <div className="save-row tight">
          <button className="btn quiet" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the row on the search home page

export function PlaylistShelf() {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const list = usePlaylists();
  const openPlaylist = usePlayer((s) => s.openPlaylist);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  if (!backend || list === null) return null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const r = await backend.library.changePlaylist({ action: 'create', name: name.trim() });
    if (!r.ok || !r.playlist) return toast(r.error ?? 'Couldn’t make the playlist.', 'error');
    setNaming(false);
    setName('');
    playlistsChanged();
    openPlaylist(r.playlist.id);
  };

  return (
    <section className="your-shares playlists-home compact" aria-labelledby="pl-h">
      <div className="pl-head">
        <h2 id="pl-h">
          Playlists {list.length > 0 && <span className="dim">{list.length}</span>}
        </h2>
        {naming ? (
          <form className="pl-new-form" onSubmit={create}>
            <input className="input" autoFocus placeholder="Name" aria-label="Playlist name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} onKeyDown={(e) => e.key === 'Escape' && setNaming(false)} />
            <button className="btn small" disabled={!name.trim()}>
              Create
            </button>
          </form>
        ) : (
          <button className="btn quiet small" onClick={() => setNaming(true)}>
            <span aria-hidden>+</span> New playlist
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <p className="hint-text">Open an album and use … → Add to playlist on any track or on the whole album.</p>
      ) : (
        <ul className="pl-list">
          {list.map((p) => (
            <li key={p.id}>
              <button className="pl-row" onClick={() => openPlaylist(p.id)} aria-label={`Open ${p.name}`}>
                <PlaylistCover p={p} className="pl-thumb" />
                <span className="pl-row-t">
                  <strong title={p.name}>{p.name}</strong>
                  <span>
                    {p.count} {p.count === 1 ? 'track' : 'tracks'}
                    {p.seconds ? ` · ${fmtLength(p.seconds)}` : ''}
                  </span>
                </span>
                <Icon name="chevron" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
