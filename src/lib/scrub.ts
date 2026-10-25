import { useEffect, useRef, useState, type ChangeEvent } from 'react';

/**
 * A time bar you can drag smoothly: while your finger is down the dot just follows it, and the music jumps
 * once, when you let go (each jump is a new request to the computer, slow over mobile data). After letting go
 * the bar stays where you dropped it until the music gets there, instead of snapping back first.
 * A tap on the bar, or the arrow keys, jump straight away.
 */
export function useScrub(time: number, seek: (t: number) => void) {
  const [value, setValue] = useState<number | null>(null);
  const dragging = useRef(false);
  const latest = useRef<number | null>(null);
  const settle = useRef(0);

  // Once the music is where the bar was dropped (or after a few seconds anyway), the bar follows the music again.
  useEffect(() => {
    if (value === null || dragging.current) return;
    if (Math.abs(time - value) < 1.5) setValue(null);
  }, [time, value]);
  useEffect(() => () => clearTimeout(settle.current), []);

  const start = () => {
    dragging.current = true;
    clearTimeout(settle.current);
  };
  const commit = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const v = latest.current;
    latest.current = null;
    if (v === null) return;
    seek(v);
    clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setValue(null), 4000);
  };

  return {
    /** Where to draw the dot: the finger while dragging, else the music. */
    shown: value ?? time,
    props: {
      onPointerDown: start,
      onTouchStart: start,
      onMouseDown: start,
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        const v = Number(e.target.value);
        setValue(v);
        if (dragging.current) latest.current = v;
        else {
          seek(v); // keyboard
          clearTimeout(settle.current);
          settle.current = window.setTimeout(() => setValue(null), 4000);
        }
      },
      onPointerUp: commit,
      onPointerCancel: commit,
      onTouchEnd: commit,
      onTouchCancel: commit,
      onMouseUp: commit,
      onBlur: commit,
    },
  };
}
