import { useCallback, useEffect, useState } from 'react';
import type { PlaylistBackup } from '../api/library';
import { useStore } from '../store';
import { playlistsChanged } from './Playlists';

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Nightjar keeps copies of your playlists on its own: when it starts, and as you change them. If they ever
 * go wrong (a mistaken delete, a damaged file), go back to one of the copies here.
 */
export function PlaylistBackupsSection() {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const [list, setList] = useState<PlaylistBackup[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async () => {
    if (!backend) return;
    setList(await backend.library.playlistBackups().catch(() => null));
  }, [backend]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!backend || list === null) return null;

  const restore = async (b: PlaylistBackup) => {
    if (!window.confirm(`Go back to your playlists from ${fmtWhen(b.when)}? What you have now is kept as a backup too.`)) return;
    setBusy(b.name);
    const r = await backend.library.restorePlaylists(b.name);
    setBusy(undefined);
    if (!r.ok) return toast(r.error ?? 'Couldn’t restore it.', 'error');
    playlistsChanged();
    toast('Your playlists are back as they were.');
    void load();
  };

  return (
    <section className="settings-block" aria-labelledby="plb-h">
      <h2 id="plb-h">Playlist backups</h2>
      <p className="hint-text">
        Nightjar keeps copies of your playlists on this computer, when it starts and as you change them (the last few, plus one a day for
        two weeks). A damaged playlists file is fixed from the newest copy on its own.
      </p>
      {list.length === 0 ? (
        <p className="hint-text">No copies yet. The first one is made when you next change a playlist.</p>
      ) : (
        <>
          <button className="btn quiet small" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide the copies' : `Show the ${list.length} ${list.length === 1 ? 'copy' : 'copies'}`}
          </button>
          {open && (
            <ul className="plb-list">
              {list.map((b) => (
                <li key={b.name}>
                  <div className="setup-folder">
                    <div>
                      <strong>{fmtWhen(b.when)}</strong>
                      <span className="dim">
                        {b.readable ? `${b.playlists} ${b.playlists === 1 ? 'playlist' : 'playlists'}, ${b.tracks} tracks` : 'Can’t be read'}
                      </span>
                    </div>
                    <button className="btn quiet small" disabled={!b.readable || !!busy} onClick={() => restore(b)}>
                      {busy === b.name ? 'Restoring…' : 'Restore'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
