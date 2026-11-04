import { useEffect, useRef, useState } from 'react';
import { dirOf, generatedCover, onlineCover } from '../lib/covers';
import { basename, isDiscFolder } from '../lib/quality';
import { coverSize } from '../api/slskd';
import { useStore } from '../store';

/**
 * Album art with fallbacks: the picture in the album's folder on this computer,
 * then the Cover Art Archive, then a generated cover. Looks things up only once
 * the cover scrolls into view.
 */
/** Pictures already found, by folder and album: a cover shown once appears at once the next time. */
const found = new Map<string, string>();
/** The last picture shown for an album at any size: a cover that mounts again shows it at once, then sharpens if needed. */
const foundAny = new Map<string, string>();

/** The folders that may hold an album's picture: a track's disc folder (CD 1) keeps it in the album folder above. */
export const coverDirs = (dir?: string): string[] => (!dir ? [] : isDiscFolder(basename(dir)) ? [dir, dirOf(dir)] : [dir]);

/** A picture already shown for this folder (or its album folder) anywhere in the app, whatever it came from. */
export function shownCoverFor(dir?: string): string | undefined {
  for (const d of coverDirs(dir))
    for (const [k, v] of foundAny) if (k.startsWith(d + '|')) return v;
  return undefined;
}

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
  const baseKey = `${dir ?? ''}|${artist ?? ''}|${album ?? ''}`;
  const known = (px ? found.get(cacheKey) : undefined) ?? foundAny.get(baseKey);
  const [seen, setSeen] = useState(false);
  const [srcs, setSrcs] = useState<string[]>(known ? [known] : []);
  const [i, setI] = useState(0);
  // A picture shown before is already decoded: it appears at once instead of fading in again.
  const [loaded, setLoaded] = useState(!!known);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Only ever asks for a sharper copy: a cover that shrinks (the window or a panel changed size) keeps its picture
    // instead of fetching a smaller one and blinking.
    const size = () => {
      const n = coverSize(Math.max(el.getBoundingClientRect().width, 60) * (window.devicePixelRatio || 1));
      setPx((cur) => (n > cur ? n : cur));
    };
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
      setLoaded(true);
      setLocalDone(true);
      askedOnline.current = true;
      return;
    }
    let gone = false;
    // A picture of this album is already on screen: it stays while a sharper one is fetched.
    if (!foundAny.has(baseKey)) {
      setSrcs([]);
      setLoaded(false);
    }
    setI(0);
    setLocalDone(false);
    askedOnline.current = false;
    (async () => {
      if (dir && backend) {
        // Never wait long on the helper: a phone, or a browser that blocks it, just moves on.
        const asked = await Promise.race([
          Promise.all(coverDirs(dir).map((d) => backend.files.coverUrl(d, px).catch(() => null))),
          new Promise<null>((r) => setTimeout(() => r(null), 3000)),
        ]);
        const locals = (asked ?? []).filter((u): u is string => !!u);
        const local = locals[0];
        if (!gone && local) {
          // Already showing this album: the sharper copy takes over only once it has loaded, so nothing blinks.
          if (foundAny.has(baseKey)) {
            const im = new Image();
            im.onload = () => !gone && setSrcs([local]);
            im.src = local;
          } else setSrcs(locals);
        }
      }
      if (!gone) setLocalDone(true);
    })();
    return () => {
      gone = true;
    };
  }, [seen, dir, backend, cacheKey, px, baseKey]);

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
            foundAny.set(baseKey, src);
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

