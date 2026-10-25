import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';

/** Moving your finger this far above or below the bar slows the dot down, like Apple Music (px → share of the speed). */
const RATES: [beyond: number, rate: number, label: string][] = [
  [180, 0.1, 'Fine scrubbing'],
  [110, 0.25, 'Quarter-speed scrubbing'],
  [50, 0.5, 'Half-speed scrubbing'],
  [0, 1, ''],
];

/**
 * A time bar you can drag smoothly: while your finger is down the dot just follows it, and the music jumps
 * once, when you let go (each jump is a new request to the computer, slow over mobile data). After letting go
 * the bar stays where you dropped it until the music gets there, instead of snapping back first.
 * A tap on the bar, or the arrow keys, jump straight away.
 *
 * Dragging is handled here, on a wrapper round the bar (`wrap`), so the finger can move away from the bar to
 * scrub more finely; the bar itself (`props`) only answers the keyboard.
 */
export function useScrub(time: number, duration: number, seek: (t: number) => void) {
  const [value, setValue] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ label: string } | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number; value: number } | null>(null);
  const settle = useRef(0);

  // Once the music is where the bar was dropped (or after a few seconds anyway), the bar follows the music again.
  useEffect(() => {
    if (value === null || pointer.current) return;
    if (Math.abs(time - value) < 1.5) setValue(null);
  }, [time, value]);
  useEffect(() => () => clearTimeout(settle.current), []);

  const release = (v: number) => {
    seek(v);
    clearTimeout(settle.current);
    settle.current = window.setTimeout(() => setValue(null), 4000);
  };
  const clamp = (v: number) => Math.min(Math.max(0, v), duration || 0);

  const end = (e: PointerEvent<HTMLElement>) => {
    const p = pointer.current;
    if (!p || p.id !== e.pointerId) return;
    pointer.current = null;
    setDrag(null);
    release(p.value);
  };

  return {
    /** Where to draw the dot: the finger while dragging, else the music. */
    shown: value ?? time,
    /** While dragging: how finely ("" at full speed). */
    drag,
    wrap: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (!duration || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const box = e.currentTarget.getBoundingClientRect();
        // A tap goes straight to where it landed; a drag carries on from there.
        const v = clamp(((e.clientX - box.left) / box.width) * duration);
        try {
          e.currentTarget.setPointerCapture(e.pointerId); // keep following the finger once it leaves the bar
        } catch {
          // a pointer the browser no longer knows: the drag still works while it stays on the bar
        }
        pointer.current = { id: e.pointerId, x: e.clientX, y: box.top + box.height / 2, value: v };
        clearTimeout(settle.current);
        setValue(v);
        setDrag({ label: '' });
      },
      onPointerMove: (e: PointerEvent<HTMLElement>) => {
        const p = pointer.current;
        if (!p || p.id !== e.pointerId) return;
        const width = e.currentTarget.getBoundingClientRect().width || 1;
        const [, rate, label] = RATES.find(([beyond]) => Math.abs(e.clientY - p.y) >= beyond)!;
        p.value = clamp(p.value + ((e.clientX - p.x) / width) * duration * rate);
        p.x = e.clientX;
        setValue(p.value);
        setDrag((d) => (d?.label === label ? d : { label }));
      },
      onPointerUp: end,
      onPointerCancel: end,
    },
    props: {
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        // The keyboard (dragging never reaches the bar itself).
        const v = Number(e.target.value);
        setValue(v);
        release(v);
      },
    },
  };
}
