import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlbumTracks, PlaylistFull, PlaylistTrack, Track } from '../api/library';
import { fmtTime, toItems, toQueue, usePlayer, type QueueItem } from '../lib/player';
import { generatedCover, onlineCover } from '../lib/covers';
import { useStore } from '../store';
import { Icon } from './Icon';
import { addToPlaylist, fmtLength, PlaylistCover, playlistsChanged } from './Playlists';

/** Whether a picture really loads (a missing cover answers 404). */
export const loads = (src: string) =>
  new Promise<boolean>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth > 0);
    img.onerror = () => resolve(false);
    img.src = src;
    setTimeout(() => resolve(false), 8000);
  });

/** An album's picture: the one on the computer (file or inside the music), else the Cover Art Archive. */
export function useAlbumArt(dir: string | undefined, artist?: string | null, album?: string | null) {
  const backend = useStore((s) => s.backend);
  const [art, setArt] = useState<string | null>(null);
  useEffect(() => {
    if (!dir || !backend) return;
    let alive = true;
    setArt(null);
    (async () => {
      const local = await backend.files.coverUrl(dir).catch(() => null);
      if (local && (await loads(local))) return alive && setArt(local);
      if (!album) return;
      const web = await onlineCover(artist ?? undefined, album).catch(() => null);
      if (web && (await loads(web))) return alive && setArt(web);
    })();
    return () => {
      alive = false;
    };
  }, [dir, backend, artist, album]);
  return art;
}

// ------------------------------------------------------------------ a small "…" menu

export interface MenuItem {
  label: string;
  icon?: 'next' | 'history' | 'plus' | 'trash' | 'pencil' | 'image' | 'play';
  danger?: boolean;
  onClick: () => void;
}

export function Menu({ items, label, light = true }: { items: MenuItem[]; label: string; light?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <span ref={ref} className={`dv-menu ${light ? 'on-dark' : ''}`}>
      <button
        className="dv-menu-btn"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <Icon name="more" size={18} />
      </button>
      {open && (
        <span className="dv-menu-list" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className={it.danger ? 'danger' : undefined}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                it.onClick();
              }}
            >
              <MenuGlyph name={it.icon} /> {it.label}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function MenuGlyph({ name }: { name?: MenuItem['icon'] }) {
  const d: Record<string, string> = {
    next: 'M6 6v12l8.5-6L6 6Zm10 0h2v12h-2V6Z',
    history: 'M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h10v2H4v-2Z',
    plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z',
    trash: 'M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 12H7L6 9Z',
    pencil: 'M4 17.3V20h2.7L17.8 8.9l-2.7-2.7L4 17.3ZM20.7 6a1 1 0 0 0 0-1.4l-1.3-1.3a1 1 0 0 0-1.4 0l-1.2 1.2 2.7 2.7L20.7 6Z',
    image: 'M4 5h16v14H4V5Zm2 2v8.6l3.5-3.5 2.5 2.5 3.5-4.1L18 14V7H6Zm2.5 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
    play: 'M8 5v14l11-7L8 5Z',
  };
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {name && <path d={d[name]} />}
    </svg>
  );
}

const trackMenu = (items: QueueItem[], extra: MenuItem[] = []): MenuItem[] => [
  { label: 'Play next', icon: 'next', onClick: () => usePlayer.getState().addTracks(items, 'next') },
  { label: 'Add to queue', icon: 'history', onClick: () => usePlayer.getState().addTracks(items, 'end') },
  { label: 'Add to playlist', icon: 'plus', onClick: () => addToPlaylist(items) },
  ...extra,
];

// ------------------------------------------------------------------ an album

/** An album in the drawer: big art, its tracks; tap one to play the album from there. Nothing plays until you ask. */
export function AlbumView({ dir, onArt }: { dir: string; onArt: (url: string | null) => void }) {
  const backend = useStore((s) => s.backend);
  const [album, setAlbum] = useState<AlbumTracks | null | undefined>(undefined);
  const current = usePlayer((s) => s.queue[s.index]?.path);
  const playing = usePlayer((s) => s.playing);
  const p = usePlayer.getState();

  useEffect(() => {
    let alive = true;
    setAlbum(undefined);
    backend?.library.tracks(dir).then((a) => alive && setAlbum(a));
    return () => {
      alive = false;
    };
  }, [backend, dir]);

  const first = album?.tracks[0];
  const name = first?.album ?? dir.split(/[\\/]/).pop() ?? 'Album';
  const artist = albumArtist(album?.tracks ?? []);
  const art = useAlbumArt(dir, artist, first?.album);
  useEffect(() => onArt(art ?? generatedCover(dir)), [art, onArt, dir]);

  if (album === undefined)
    return (
      <div className="fp-body dv-loading">
        <p className="hint-text">
          <span className="spinner" aria-hidden /> Reading the album…
        </p>
      </div>
    );
  if (!album || album.tracks.length === 0)
    return (
      <div className="fp-body dv-loading">
        <p>Couldn’t find music in that folder. It may have been moved.</p>
      </div>
    );

  const items = () => toItems(album.dir, album.tracks);
  const total = album.tracks.reduce((n, t) => n + t.seconds, 0);
  const discs = new Set(album.tracks.map((t) => t.disc || 1)).size > 1;

  return (
    <div className="fp-body">
      <div className="fp-art-col">
        <img className="fp-art" src={art ?? generatedCover(dir)} alt="" />
      </div>
      <div className="fp-side">
        <div className="fp-now">
          <h2>{name}</h2>
          <p className="fp-artist">{artist ?? 'Unknown artist'}</p>
          <p className="fp-album">
            <span>
              {album.tracks.length} {album.tracks.length === 1 ? 'track' : 'tracks'} · {fmtLength(total)}
            </span>
            {first && <span className="fp-chip"><span className="pq-chip">{qualityLabel(first)}</span></span>}
          </p>
        </div>
        <div className="dv-actions">
          <button className="dv-btn primary" onClick={() => { p.playQueue(items(), 0); p.showNow(); }}>
            <Icon name="play" size={18} /> Play
          </button>
          <button className="dv-btn" onClick={() => { p.playShuffled(items()); p.showNow(); }}>
            <ShuffleSmall /> Shuffle
          </button>
          <Menu label={`More for ${name}`} items={trackMenu(items())} />
        </div>
        <div className="fp-queue">
          <ol>
            {album.tracks.map((t, i) => {
              const isNow = t.path === current;
              const showDisc = discs && (i === 0 || (album.tracks[i - 1].disc || 1) !== (t.disc || 1));
              return (
                <li key={t.path} className="dv-li">
                  {showDisc && <div className="dv-disc">Disc {t.disc || 1}</div>}
                  <div className={`fp-row ${isNow ? 'playing' : ''}`}>
                    <button className="fp-row-main" onClick={() => { p.playQueue(items(), i); p.showNow(); }}>
                      <span className="fp-row-n">{isNow ? <Bars on={playing} /> : t.no || i + 1}</span>
                      <span className="fp-row-t">
                        <strong>{t.title}</strong>
                        {t.artist && t.artist !== artist && <span>{t.artist}</span>}
                      </span>
                      <span className="fp-row-d">{fmtTime(t.seconds)}</span>
                    </button>
                    <Menu label={`More for ${t.title}`} items={trackMenu(toItems(album.dir, [t]))} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

/** The album's artist: the one most tracks agree on. */
function albumArtist(tracks: Track[]) {
  const n = new Map<string, number>();
  for (const t of tracks) if (t.artist) n.set(t.artist, (n.get(t.artist) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const qualityLabel = (t: Track) =>
  ['flac', 'wav', 'aif', 'aiff', 'alac'].includes(t.format) && t.rate
    ? `${t.format.toUpperCase()} ${t.bits || ''}${t.bits ? '/' : ''}${+(t.rate / 1000).toFixed(1)}`
    : t.kbps
      ? `${t.format.toUpperCase()} ${t.kbps}`
      : t.format.toUpperCase();

export function Bars({ on }: { on: boolean }) {
  return (
    <span className={`fp-bars ${on ? 'on' : ''}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

function ShuffleSmall() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h3.5c2 0 3.3 1 4.4 2.6l2.2 3.3c1.1 1.6 2.4 2.6 4.4 2.6H21M3 17h3.5c1.4 0 2.4-.5 3.3-1.3M14.2 8.3c.9-.8 1.9-1.3 3.3-1.3H21M18 4l3 3-3 3M18 13l3 3-3 3" />
    </svg>
  );
}

// ------------------------------------------------------------------ a playlist

export function PlaylistView({ id, onArt }: { id: string; onArt: (url: string | null) => void }) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const current = usePlayer((s) => s.queue[s.index]?.path);
  const playing = usePlayer((s) => s.playing);
  const p = usePlayer.getState();
  const [pl, setPl] = useState<PlaylistFull | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [choosingCover, setChoosingCover] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    if (!backend) return;
    setPl(await backend.library.playlist(id).catch(() => null));
  }, [backend, id]);
  useEffect(() => {
    void load();
  }, [load]);

  // The background colour comes from the playlist's own cover, or its first album.
  const coverDir = pl?.cover?.startsWith('album:') ? pl.cover.slice(6) : pl?.mosaic[0];
  const albumArt = useAlbumArt(coverDir);
  const [picture, setPicture] = useState<string | null>(null);
  useEffect(() => {
    if (pl?.cover?.startsWith('image:') && backend) backend.files.pictureUrl(pl.cover.slice(6)).then(setPicture);
    else setPicture(null);
  }, [pl?.cover, backend]);
  useEffect(() => onArt(picture ?? albumArt ?? (coverDir ? generatedCover(coverDir) : null)), [picture, albumArt, onArt, coverDir]);

  if (pl === undefined)
    return (
      <div className="fp-body dv-loading">
        <p className="hint-text">
          <span className="spinner" aria-hidden /> Reading the playlist…
        </p>
      </div>
    );
  if (!pl)
    return (
      <div className="fp-body dv-loading">
        <p>This playlist doesn’t exist any more.</p>
      </div>
    );

  const change = async (c: Parameters<NonNullable<typeof backend>['library']['changePlaylist']>[0]) => {
    const r = await backend!.library.changePlaylist(c);
    if (!r.ok) toast(r.error ?? 'Couldn’t change the playlist.', 'error');
    playlistsChanged();
    await load();
    return r.ok;
  };

  // Playing skips tracks whose files are gone.
  const playable = pl.tracks.filter((t) => !t.missing);
  const queueFrom = (i: number) => {
    const before = pl.tracks.slice(0, i).filter((t) => !t.missing).length;
    p.playQueue(toQueue(playable), before);
    p.showNow();
  };
  const total = playable.reduce((n, t) => n + t.seconds, 0);
  const missing = pl.tracks.length - playable.length;

  const move = async (from: number, to: number) => {
    if (from === to) return;
    // Show the new order at once; the computer saves it.
    const tracks = [...pl.tracks];
    tracks.splice(to, 0, ...tracks.splice(from, 1));
    setPl({ ...pl, tracks });
    await change({ action: 'move', id: pl.id, from, to });
  };

  return (
    <div className="fp-body">
      <div className="fp-art-col">
        <PlaylistCover p={pl} className="fp-art dv-pl-art" />
      </div>
      <div className="fp-side">
        <div className="fp-now">
          {renaming ? (
            <form
              className="dv-rename"
              onSubmit={async (e) => {
                e.preventDefault();
                if (name.trim() && (await change({ action: 'rename', id: pl.id, name: name.trim() }))) setRenaming(false);
              }}
            >
              <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)} />
              <button className="dv-btn primary">Save</button>
              <button type="button" className="dv-btn" onClick={() => setRenaming(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <h2>{pl.name}</h2>
          )}
          <p className="fp-artist dv-pl-label">Playlist</p>
          <p className="fp-album">
            <span>
              {pl.tracks.length} {pl.tracks.length === 1 ? 'track' : 'tracks'}
              {total ? ` · ${fmtLength(total)}` : ''}
              {missing ? ` · ${missing} missing` : ''}
            </span>
          </p>
        </div>

        {confirmDelete ? (
          <div className="dv-confirm">
            <span>Delete “{pl.name}”? The music itself stays where it is.</span>
            <button
              className="dv-btn danger"
              onClick={async () => {
                if (await change({ action: 'delete', id: pl.id })) {
                  toast(`${pl.name} deleted.`);
                  p.setExpanded(false);
                }
              }}
            >
              Delete
            </button>
            <button className="dv-btn" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </div>
        ) : (
          <div className="dv-actions">
            <button className="dv-btn primary" disabled={!playable.length} onClick={() => queueFrom(0)}>
              <Icon name="play" size={18} /> Play
            </button>
            <button className="dv-btn" disabled={!playable.length} onClick={() => { p.playShuffled(toQueue(playable)); p.showNow(); }}>
              <ShuffleSmall /> Shuffle
            </button>
            <Menu
              label={`More for ${pl.name}`}
              items={[
                ...(playable.length
                  ? [
                      { label: 'Play next', icon: 'next' as const, onClick: () => p.addTracks(toQueue(playable), 'next') },
                      { label: 'Add to queue', icon: 'history' as const, onClick: () => p.addTracks(toQueue(playable), 'end') },
                    ]
                  : []),
                { label: 'Rename', icon: 'pencil', onClick: () => { setName(pl.name); setRenaming(true); } },
                { label: 'Change the cover', icon: 'image', onClick: () => setChoosingCover(true) },
                { label: 'Delete the playlist', icon: 'trash', danger: true, onClick: () => setConfirmDelete(true) },
              ]}
            />
            <span className="fp-gap" />
            {pl.tracks.length > 0 && (
              <button className={`fp-edit ${editing ? 'on' : ''}`} onClick={() => setEditing((e) => !e)} aria-pressed={editing}>
                {editing ? 'Done' : 'Edit'}
              </button>
            )}
          </div>
        )}

        <div className="fp-queue">
          {pl.tracks.length === 0 ? (
            <p className="dv-empty">
              Empty for now. Open an album (tap its cover), then use <strong>…</strong> → <strong>Add to playlist</strong> on a track or the whole album.
            </p>
          ) : (
            <DragList
              editing={editing}
              tracks={pl.tracks}
              onMove={move}
              render={(t, i, handle) => {
                const isNow = !t.missing && t.path === current;
                return (
                  <div className={`fp-row ${isNow ? 'playing' : ''} ${t.missing ? 'missing' : ''}`}>
                    <button className="fp-row-main" disabled={t.missing} onClick={editing ? undefined : () => queueFrom(i)} tabIndex={editing ? -1 : 0}>
                      <span className="fp-row-n">{isNow ? <Bars on={playing} /> : i + 1}</span>
                      <span className="fp-row-t">
                        <strong>{t.title}</strong>
                        <span>{t.missing ? 'Not on your computer any more' : [t.artist, t.album].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="fp-row-d">{t.missing ? '' : fmtTime(t.seconds)}</span>
                    </button>
                    {editing ? (
                      <>
                        <button className="fp-row-x" onClick={() => change({ action: 'remove', id: pl.id, index: i })} aria-label={`Remove ${t.title} from the playlist`}>
                          <span aria-hidden>−</span>
                        </button>
                        {handle}
                      </>
                    ) : (
                      !t.missing && (
                        <Menu
                          label={`More for ${t.title}`}
                          items={trackMenu(toQueue([t]), [{ label: 'Remove from this playlist', icon: 'trash', danger: true, onClick: () => change({ action: 'remove', id: pl.id, index: i }) }])}
                        />
                      )
                    )}
                  </div>
                );
              }}
            />
          )}
        </div>
      </div>
      {choosingCover && <CoverChooser pl={pl} onClose={() => setChoosingCover(false)} onChanged={load} />}
    </div>
  );
}

/**
 * The playlist's rows; while editing, each has a handle to drag it to a new place
 * (mouse or finger). The order is saved when you let go.
 */
function DragList({
  tracks,
  editing,
  onMove,
  render,
}: {
  tracks: PlaylistTrack[];
  editing: boolean;
  onMove: (from: number, to: number) => void;
  render: (t: PlaylistTrack, i: number, handle: React.ReactNode) => React.ReactNode;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number; dy: number } | null>(null);
  const start = useRef(0);
  const rowH = useRef(56);

  const onDown = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = e.clientY;
    const row = list.current?.children[i] as HTMLElement | undefined;
    rowH.current = row?.offsetHeight || 56;
    setDrag({ from: i, over: i, dy: 0 });
  };
  const onMoveP = (e: React.PointerEvent) => {
    if (!drag) return;
    const dy = e.clientY - start.current;
    const over = Math.max(0, Math.min(tracks.length - 1, drag.from + Math.round(dy / rowH.current)));
    setDrag({ ...drag, dy, over });
  };
  const onUp = () => {
    if (!drag) return;
    const { from, over } = drag;
    setDrag(null);
    onMove(from, over);
  };

  return (
    <ol ref={list} className={editing ? 'editing' : undefined}>
      {tracks.map((t, i) => {
        let shift = 0;
        if (drag && i !== drag.from) {
          if (drag.from < drag.over && i > drag.from && i <= drag.over) shift = -rowH.current;
          if (drag.from > drag.over && i < drag.from && i >= drag.over) shift = rowH.current;
        }
        const style = drag
          ? i === drag.from
            ? { transform: `translateY(${drag.dy}px)`, zIndex: 2, position: 'relative' as const, background: 'rgb(255 255 255 / 0.08)' }
            : { transform: `translateY(${shift}px)`, transition: 'transform 0.15s' }
          : undefined;
        const handle = (
          <span className="dv-handle" onPointerDown={onDown(i)} onPointerMove={onMoveP} onPointerUp={onUp} onPointerCancel={onUp} aria-label={`Drag to move ${t.title}`} role="button">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M4 7h16v2H4V7Zm0 4h16v2H4v-2Zm0 4h16v2H4v-2Z" />
            </svg>
          </span>
        );
        return (
          <li key={`${t.path}-${i}`} style={style}>
            {render(t, i, handle)}
          </li>
        );
      })}
    </ol>
  );
}

/** Choosing a playlist's cover: one of its albums, a picture from this device, or back to the mosaic. */
function CoverChooser({ pl, onClose, onChanged }: { pl: PlaylistFull; onClose: () => void; onChanged: () => void }) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const dirs = [...new Set(pl.tracks.filter((t) => !t.missing).map((t) => t.dir))];

  const set = async (dir: string | null) => {
    setBusy(true);
    const r = await backend!.library.changePlaylist({ action: 'cover', id: pl.id, dir });
    setBusy(false);
    if (!r.ok) return toast(r.error ?? 'Couldn’t change the cover.', 'error');
    playlistsChanged();
    onChanged();
    onClose();
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) return toast('That picture is too big (over 25 MB).', 'error');
    setBusy(true);
    const r = await backend!.library.playlistImage(pl.id, f);
    setBusy(false);
    if (!r.ok) return toast(r.error ?? 'Couldn’t use that picture.', 'error');
    playlistsChanged();
    onChanged();
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal dv-cover-chooser" role="dialog" aria-label="Choose a cover" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2>Choose a cover</h2>
        <div className="dv-cover-grid">
          <button disabled={busy} onClick={() => set(null)} className={pl.cover ? '' : 'on'}>
            <PlaylistCover p={{ ...pl, cover: null }} />
            <span>Mosaic</span>
          </button>
          {dirs.map((d) => (
            <button key={d} disabled={busy} onClick={() => set(d)} className={pl.cover === `album:${d}` ? 'on' : ''}>
              <PlaylistCover p={{ ...pl, cover: `album:${d}` }} />
              <span>{pl.tracks.find((t) => t.dir === d)?.album ?? d.split(/[\\/]/).pop()}</span>
            </button>
          ))}
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
        <div className="save-row">
          <button className="btn" disabled={busy} onClick={() => file.current?.click()}>
            {busy ? <span className="spinner" aria-hidden /> : null} Choose a picture…
          </button>
          <button className="btn quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
