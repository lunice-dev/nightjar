import { useEffect } from 'react';
import { dockGroupOf, useNowDock } from '../lib/nowDock';
import { useLibraryReview } from '../lib/libraryReview';
import { usePcShell } from '../lib/pcShell';
import { useStore } from '../store';
import { AlbumDetail } from './LibraryAlbums';
import { NowPanel } from './NowPanel';

/** Whether the Now panel is showing on this screen (a computer only). */
export function useDockVisible() {
  const pc = usePcShell();
  const route = useStore((s) => s.route);
  const open = useNowDock((s) => s.open);
  const albumDir = useNowDock((s) => s.albumDir);
  const group = dockGroupOf(route);
  return pc && (open[group] || (group === 'library' && !!albumDir));
}

/**
 * The panel docked at the right edge of the window: the same Now component on every screen. In the Library it has a
 * second tab for the album picked there. The page makes room for it (the `now-open` class, see the styles).
 */
export function NowDock() {
  const visible = useDockVisible();
  const route = useStore((s) => s.route);
  const albumDir = useNowDock((s) => s.albumDir);
  const tab = useNowDock((s) => s.tab);
  const scan = useLibraryReview((s) => s.scan);
  const album = albumDir ? scan?.albums?.find((a) => a.dir === albumDir) : undefined;
  const inLibrary = route === 'library';

  useEffect(() => {
    document.documentElement.classList.toggle('now-open', visible);
    return () => document.documentElement.classList.remove('now-open');
  }, [visible]);

  if (!visible) return null;
  const showAlbum = inLibrary && !!album && tab === 'album';
  return (
    <aside className="now-dock" aria-label={showAlbum ? 'Album' : 'Now playing'}>
      {inLibrary && album && (
        <div className="np-tabs" role="tablist">
          <button role="tab" aria-selected={!showAlbum} onClick={() => useNowDock.getState().setTab('now')}>
            Now
          </button>
          <button role="tab" aria-selected={showAlbum} onClick={() => useNowDock.getState().setTab('album')}>
            Album
          </button>
        </div>
      )}
      {showAlbum ? <AlbumDetail key={album!.dir} a={album!} docked onClose={() => useNowDock.getState().closeAlbum()} onPlayed={() => useNowDock.getState().showNow()} /> : <NowPanel variant="dock" />}
    </aside>
  );
}
