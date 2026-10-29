import { useEffect, useRef, useState } from 'react';
import { usePlayer } from '../lib/player';
import { Icon } from './Icon';
import { addToPlaylist } from './Playlists';
import { useStore } from '../store';

/**
 * Play an album that's on the computer, and the "…" next to it: Play next, Add to queue.
 * `variant="overlay"` sits on a cover (shelf); `"buttons"` goes in a row of actions.
 */
export function AlbumPlay({ dir, title, variant = 'buttons' }: { dir: string; title: string; variant?: 'overlay' | 'buttons' | 'icon' }) {
  const playAlbum = usePlayer((s) => s.playAlbum);
  const addAlbum = usePlayer((s) => s.addAlbum);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [menu]);

  return (
    <span ref={ref} className={`album-play ${variant}`}>
      <button
        className={variant === 'overlay' ? 'ap-play' : variant === 'icon' ? 'btn quiet small icon-only' : 'btn quiet small'}
        onClick={(e) => {
          e.stopPropagation();
          void playAlbum(dir);
        }}
        aria-label={`Play ${title}`}
        title="Play"
      >
        <Icon name="play" size={variant === 'overlay' ? 18 : 16} />
        {variant === 'buttons' && ' Play'}
      </button>
      {(
        <button
          className={variant === 'overlay' ? 'ap-more' : 'btn quiet small icon-only'}
          onClick={(e) => {
            e.stopPropagation();
            setMenu((m) => !m);
          }}
          aria-label={`More ways to play ${title}`}
          aria-expanded={menu}
          title="Play next or add to the queue"
        >
          <Icon name="more" size={16} />
        </button>
      )}
      {menu && (
        <span className="ap-menu" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setMenu(false);
              void addAlbum(dir, 'next');
            }}
          >
            <Icon name="next" size={15} /> Play next
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(false);
              void addAlbum(dir, 'end');
            }}
          >
            <Icon name="history" size={15} /> Add to queue
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setMenu(false);
              usePlayer.getState().openAlbum(dir);
            }}
          >
            <Icon name="folder" size={15} /> Open album
          </button>
          <button
            role="menuitem"
            onClick={async () => {
              setMenu(false);
              const backend = useStore.getState().backend;
              const album = await backend?.library.tracks(dir);
              if (album?.tracks.length) addToPlaylist(album.tracks.map((t) => ({ ...t, dir: album.dir })));
            }}
          >
            <Icon name="star" size={15} /> Add to playlist
          </button>
        </span>
      )}
    </span>
  );
}
