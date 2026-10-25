import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { audioCtl, usePlayer } from './player';

/** Moves the music by `by` seconds, staying inside the track. */
export function seekBy(by: number) {
  const el = audioCtl.el;
  if (!el || !Number.isFinite(el.duration)) return;
  el.currentTime = Math.min(Math.max(0, el.currentTime + by), Math.max(0, el.duration - 0.5));
}

/** A track this long is a mix, a live set or an audiobook: the full player adds jump buttons for it. */
export const LONG_TRACK = 20 * 60;

/** How long a press must last to count as holding, not a tap. */
const HOLD_MS = 350;
/** How often holding moves the music, and how far each step goes after holding that long (ms). */
const TICK_MS = 300;
const STEPS: [after: number, seconds: number][] = [
  [4000, 12],
  [2000, 6],
  [0, 3],
];

/**
 * Previous and next buttons that scan when held, like Apple Music: a tap skips the track, holding moves through it,
 * faster the longer you hold (about 10×, then 20×, then 40×). Each step is one jump, so it works over mobile data.
 */
export function useHoldToScan(direction: 1 | -1, onTap: () => void) {
  const timer = useRef<number>();
  const ticker = useRef<number>();
  const held = useRef(false);
  const [scanning, setScanning] = useState(false);

  const stop = () => {
    clearTimeout(timer.current);
    clearInterval(ticker.current);
    setScanning(false);
  };
  useEffect(() => stop, []);

  return {
    scanning,
    props: {
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0 || !usePlayer.getState().queue.length) return;
        held.current = false;
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          held.current = true;
          setScanning(true);
          const since = Date.now();
          const step = () => seekBy(direction * STEPS.find(([after]) => Date.now() - since >= after)![1]);
          step();
          ticker.current = window.setInterval(step, TICK_MS);
        }, HOLD_MS);
      },
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
      // The press-and-hold menu (iPhone, iPad) would open on a long press.
      onContextMenu: (e: MouseEvent) => e.preventDefault(),
      onClick: () => {
        // A hold ends in a click too; it already did its work.
        if (held.current) held.current = false;
        else onTap();
      },
    },
  };
}

/**
 * ← and → move the music 5 seconds, with Shift 30, anywhere in the app while something plays. Not while typing,
 * and not on a slider or list that uses the arrows itself.
 */
export function useSeekKeys(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="listbox"], [role="tablist"]')) return;
      e.preventDefault();
      seekBy((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 30 : 5));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on]);
}

/**
 * Double-tap the left or right of the album art to go back or forward 10 seconds; more taps add 10 more each.
 * `shown` is what to flash on the art ("−20 s"), or null.
 */
export function useDoubleTapSeek() {
  const last = useRef<{ at: number; side: 1 | -1 } | null>(null);
  const [shown, setShown] = useState<{ side: 1 | -1; total: number } | null>(null);
  const hide = useRef<number>();
  useEffect(() => () => clearTimeout(hide.current), []);

  const onClick = (e: MouseEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const side: 1 | -1 = e.clientX - box.left > box.width / 2 ? 1 : -1;
    const now = Date.now();
    const prev = last.current;
    last.current = { at: now, side };
    // The first tap only arms it; the second within a third of a second jumps, and each tap after adds a jump.
    if (!prev || prev.side !== side || now - prev.at > 320) {
      if (!shown || shown.side !== side) return;
    }
    seekBy(side * 10);
    setShown((s) => ({ side, total: s && s.side === side ? s.total + 10 : 10 }));
    clearTimeout(hide.current);
    hide.current = window.setTimeout(() => {
      setShown(null);
      last.current = null;
    }, 700);
  };
  return { shown, onClick };
}
