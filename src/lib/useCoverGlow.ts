import { useEffect, useState, type CSSProperties } from 'react';
import { coverColour } from './coverColour';
import { usePlayer } from './player';
import { useStore } from '../store';

/** The main colour of the playing album's cover (null: nothing playing, or no picture to read). */
export function useCoverGlow(dir: string | undefined) {
  const backend = useStore((s) => s.backend);
  const [rgb, setRgb] = useState<[number, number, number] | null>(null);
  useEffect(() => {
    let alive = true;
    if (!dir || !backend) {
      setRgb(null);
      return;
    }
    backend.files
      .coverUrl(dir, 96)
      .then((u) => (u ? coverColour(u) : null))
      .then((c) => alive && setRgb(c))
      .catch(() => alive && setRgb(null));
    return () => {
      alive = false;
    };
  }, [dir, backend]);
  return rgb;
}

/**
 * The two glow colours for the whole window, as CSS variables for the shell: from the cover of what's playing, or
 * the warm amber of the logo when nothing is.
 */
export function useShellGlow(): CSSProperties {
  const track = usePlayer((s) => s.queue[s.index]);
  const rgb = useCoverGlow(track?.dir);
  return {
    '--g1': rgb ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / 0.32)` : 'rgb(224 164 88 / 0.14)',
    '--g2': rgb ? `rgb(${Math.round(rgb[0] * 0.55)} ${Math.round(rgb[1] * 0.55)} ${Math.round(rgb[2] * 0.7)} / 0.18)` : 'rgb(116 163 242 / 0.07)',
  } as CSSProperties;
}
