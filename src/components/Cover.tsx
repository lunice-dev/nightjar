import { useEffect, useRef, useState } from 'react';
import { generatedCover, onlineCover } from '../lib/covers';
import { coverSize } from '../api/slskd';
import { useStore } from '../store';

/**
 * Album art with fallbacks: the picture in the album's folder on this computer,
 * then the Cover Art Archive, then a generated cover. Looks things up only once
 * the cover scrolls into view.
 */
/** Pictures already found, by folder and album: a cover shown once appears at once the next time. */
const found = new Map<string, string>();

export function Cover({
  dir,
  artist,
  album,
  seed,
  className = '',
  online = true,
}: {
  /** Folder on this computer that may hold cover.jpg and friends. */
  dir?: string;
  artist?: string;
  album?: string;
  /** Anything stable, for the generated cover. */
  seed: string;
  className?: string;
  /** Look the album up on MusicBrainz when there's no local picture. */
  online?: boolean;
}) {
  const backend = useStore((s) => s.backend);
  const ref = useRef<HTMLSpanElement>(null);
  // The size it's shown at (sharp on this screen), in the steps the computer makes copies in.
  const [px, setPx] = useState(0);
  const cacheKey = `${dir ?? ''}|${artist ?? ''}|${album ?? ''}|${px}`;
  const known = px ? found.get(cacheKey) : undefined;
  const [seen, setSeen] = useState(false);
  const [srcs, setSrcs] = useState<string[]>(known ? [known] : []);
  const [i, setI] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const size = () => setPx(coverSize(Math.max(el.getBoundingClientRect().width, 60) * (window.devicePixelRatio || 1)));
    size();
    const io = new IntersectionObserver(
      (e) => {
        if (!e.some((x) => x.isIntersecting)) return;
        size();
        setSeen(true);
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    // A window that isn't painting (a hidden frame, some embedded browsers) never reports; load anyway.
    const t = setTimeout(() => {
      size();
      setSeen(true);
    }, 2000);
    return () => {
      io.disconnect();
      clearTimeout(t);
    };
  }, []);

  const [localDone, setLocalDone] = useState(false);
  const askedOnline = useRef(false);
  useEffect(() => {
    if (!seen) return;
    const hit = found.get(cacheKey);
    if (hit) {
      setSrcs([hit]);
      setI(0);
      setLocalDone(true);
      askedOnline.current = true;
      return;
    }
    let gone = false;
    setSrcs([]);
    setI(0);
    setLoaded(false);
    setLocalDone(false);
    askedOnline.current = false;
    (async () => {
      if (dir && backend) {
        // Never wait long on the helper: a phone, or a browser that blocks it, just moves on.
        const local = await Promise.race([
          backend.files.coverUrl(dir, px).catch(() => null),
          new Promise<null>((r) => setTimeout(() => r(null), 3000)),
        ]);
        if (!gone && local) setSrcs([local]);
      }
      if (!gone) setLocalDone(true);
    })();
    return () => {
      gone = true;
    };
  }, [seen, dir, backend, cacheKey, px]);

  // Only when there's no picture on this computer: ask the Cover Art Archive.
  const exhausted = localDone && i >= srcs.length;
  useEffect(() => {
    if (!exhausted || askedOnline.current || !online || !album) return;
    askedOnline.current = true;
    const want = `${artist}|${album}`;
    onlineCover(artist, album).then((web) => web && `${artist}|${album}` === want && setSrcs((s) => (s.includes(web) ? s : [...s, web])));
  }, [exhausted, online, artist, album]);

  const src = srcs[i];
  return (
    <span ref={ref} className={`cover ${className}`} aria-hidden>
      <img className="cover-fallback" src={generatedCover(seed)} alt="" />
      {src && (
        <img
          key={src}
          className={`cover-art ${loaded ? 'in' : ''}`}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => {
            setLoaded(true);
            found.set(cacheKey, src);
          }}
          onError={() => {
            setLoaded(false);
            setI((n) => n + 1);
          }}
        />
      )}
    </span>
  );
}

