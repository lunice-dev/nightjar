import { useId, useLayoutEffect, useRef } from 'react';
import { INTRO_SVG } from './introSvg';

/**
 * The logo drawing itself: the bird flies in and lands on the moon (`play`), or the finished logo straight away.
 * The animation is SVG (SMIL), restarted from 0 when it appears so it always plays from the beginning.
 */
export function Intro({ play }: { play: boolean }) {
  const uid = 'nj' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const host = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const svg = host.current?.querySelector('svg');
    if (!svg) return;
    try {
      if (play) {
        svg.setCurrentTime(0);
        svg.unpauseAnimations();
      } else {
        svg.pauseAnimations();
        svg.setCurrentTime(60);
      }
    } catch {
      /* SVG animation unavailable: the drawing still shows */
    }
  }, [play]);
  return <div className="intro" ref={host} dangerouslySetInnerHTML={{ __html: INTRO_SVG.replaceAll('__UID__', uid) }} />;
}
