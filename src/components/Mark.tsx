import { useId } from 'react';

/**
 * The Nightjar mark: a nightjar seen from below, gliding across a full moon. Long pointed wings with the
 * pale wing patches every nightjar carries (here in the moon's amber), broad flat head, long square tail.
 * A nod to Soulseek's own bird. The bird is cut through the moon, so whatever is behind the mark shows
 * inside it: it works on any background. Below 32 px the wing patches are left out so the shape stays crisp.
 */
const WINGS =
  'M30.4 30.6 C26.6 26.8 22.8 24.4 18.6 23.6 C13.6 22.8 8 24.4 2.4 27.8 C8.4 27.8 14 29 19 31.2 C23 33 26.6 35.4 29.6 37.8 Z ' +
  'M33.6 30.6 C37.4 26.8 41.2 24.4 45.4 23.6 C50.4 22.8 56 24.4 61.6 27.8 C55.6 27.8 50 29 45 31.2 C41 33 37.4 35.4 34.4 37.8 Z';
const BODY =
  'M32 25.6 C34.6 25.6 35.9 26.8 35.9 28.5 C35.9 30 35.2 31.1 35.1 32.6 C35 34.6 35.3 36.6 35 38.6 C34.8 39.6 34.5 40.4 34.2 41 ' +
  'L36.9 56.6 C35.4 56.2 33.7 56 32 56 C30.3 56 28.6 56.2 27.1 56.6 L29.8 41 C29.5 40.4 29.2 39.6 29 38.6 C28.7 36.6 29 34.6 28.9 32.6 ' +
  'C28.8 31.1 28.1 30 28.1 28.5 C28.1 26.8 29.4 25.6 32 25.6 Z';
const PATCHES = 'M11.6 23.4 L14.8 22.8 L16.2 30.4 L12.8 29.6 Z M52.4 23.4 L49.2 22.8 L47.8 30.4 L51.2 29.6 Z';
/** Everything outside the moon (the moon is centred at 32,29 with radius 17). */
const OUTSIDE_MOON = 'M0 0H64V64H0Z M15 29a17 17 0 1 0 34 0a17 17 0 1 0 -34 0Z';

export function Mark({ size = 18, tile = false }: { size?: number; tile?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const small = size < 32;
  return (
    <svg className={`mark${tile ? ' tile' : ''}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <mask id={`nj-cut-${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
          <rect width="64" height="64" fill="#fff" />
          <path d={WINGS} fill="#000" />
          <path d={BODY} fill="#000" />
        </mask>
        <clipPath id={`nj-out-${id}`}>
          <path d={OUTSIDE_MOON} clipRule="evenodd" />
        </clipPath>
        <clipPath id={`nj-wings-${id}`}>
          <path d={WINGS} />
        </clipPath>
      </defs>
      {tile && <rect width="64" height="64" rx="14" className="mark-tile" />}
      <circle cx="32" cy="29" r="17" className="mark-moon" mask={`url(#nj-cut-${id})`} />
      <g className="mark-bird" clipPath={`url(#nj-out-${id})`}>
        <path d={WINGS} />
        <path d={BODY} />
      </g>
      {!small && <path d={PATCHES} className="mark-bars" clipPath={`url(#nj-wings-${id})`} />}
    </svg>
  );
}
