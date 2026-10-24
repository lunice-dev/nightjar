import { useStore, type Route } from '../store';
import { usePlayer } from './player';

/**
 * Swipe sideways to move between the tabs, like flipping pages: right to left goes to the next tab
 * (Search → Downloads…), left to right to the one before. The page follows your finger and
 * the next tab slides in after it; let go past a third of the way (or with a quick flick) to go
 * there. The order is the tabs you see: the bar at the bottom on a phone, the top bar on bigger screens.
 * A two-finger sideways swipe on a trackpad does the same on the computer.
 */
const ALL: Route[] = ['search', 'wishlist', 'downloads', 'library', 'uploads', 'messages', 'rooms', 'people', 'settings'];
const PHONE: Route[] = ['search', 'downloads', 'messages', 'people'];

/** The tab next to the one open, in the order on screen; null at either end. */
function neighbourTab(dir: -1 | 1): Route | null {
  const order = window.innerWidth < 700 ? PHONE : ALL;
  const r = useStore.getState().route;
  const here = order.indexOf(r === 'browse' ? 'people' : r === 'about' ? 'settings' : r);
  if (here < 0) return null;
  return order[here + dir] ?? null;
}

/** The page that moves. */
const target = () => document.querySelector('.main') as HTMLElement | null;

let active: { dir: -1 | 1; to: Route; el: HTMLElement; startX: number; startY: number; t: number; dx: number } | null = null;

function begin(dir: -1 | 1, x: number, y: number) {
  const to = neighbourTab(dir);
  const el = target();
  if (!to || !el) return false;
  active = { dir, to, el, startX: x, startY: y, t: performance.now(), dx: 0 };
  el.classList.add('swiping');
  return true;
}

function move(dx: number) {
  if (!active) return;
  // Only the right way counts: the tab before follows a swipe to the right, the next one a swipe to the left.
  const d = active.dir === -1 ? Math.max(0, dx) : Math.min(0, dx);
  active.dx = d;
  active.el.style.transform = `translateX(${d}px)`;
}

function end(cancel = false) {
  if (!active) return;
  const { el, dx, dir, t, to } = active;
  active = null;
  const w = el.getBoundingClientRect().width;
  const fast = Math.abs(dx) / Math.max(1, performance.now() - t) > 0.5 && Math.abs(dx) > 30;
  const go = !cancel && (Math.abs(dx) > w / 3 || fast);
  const ease = 'cubic-bezier(0.32, 0.72, 0, 1)';
  if (!go) {
    // Not far enough: spring back.
    el.style.transition = `transform 0.25s ${ease}`;
    el.style.transform = 'translateX(0)';
    setTimeout(() => {
      el.style.transition = '';
      el.style.transform = '';
      el.classList.remove('swiping');
    }, 260);
    return;
  }
  // Far enough: a picture of this page carries on out while the next tab slides in right behind it, both
  // at once, so there's never a gap between them.
  const out = dir === -1 ? w : -w;
  const ms = Math.round(160 + 140 * (Math.abs(out - dx) / w));
  const ghost = snapshot(el, dx);

  useStore.getState().go(to);
  el.style.transition = 'none';
  el.style.transform = `translateX(${dx - out}px)`; // just beside the picture, on the other side
  requestAnimationFrame(() => {
    el.getBoundingClientRect();
    const move = `transform ${ms}ms ${ease}`;
    el.style.transition = move;
    ghost.style.transition = move;
    el.style.transform = 'translateX(0)';
    ghost.style.transform = `translateX(${out}px)`;
    setTimeout(() => {
      ghost.remove();
      el.style.transition = '';
      el.style.transform = '';
      el.classList.remove('swiping');
    }, ms + 20);
  });
}

/** A still copy of the page, scrolled where it was, laid exactly over it. */
function snapshot(el: HTMLElement, dx: number) {
  const r = el.getBoundingClientRect();
  const copy = el.cloneNode(true) as HTMLElement;
  copy.classList.add('swipe-ghost');
  copy.removeAttribute('id');
  Object.assign(copy.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0', zIndex: '5', pointerEvents: 'none' });
  // Copies start scrolled to the top: put each scrolled part back where it was.
  const from = [el, ...el.querySelectorAll<HTMLElement>('*')];
  const to = [copy, ...copy.querySelectorAll<HTMLElement>('*')];
  const scrolled: [HTMLElement, number, number][] = [];
  from.forEach((n, k) => {
    if ((n.scrollTop || n.scrollLeft) && to[k]) scrolled.push([to[k], n.scrollTop, n.scrollLeft]);
  });
  copy.style.transform = `translateX(${dx}px)`;
  document.body.appendChild(copy);
  scrolled.forEach(([n, t, l]) => ((n.scrollTop = t), (n.scrollLeft = l)));
  return copy;
}

/** Things you drag sideways yourself: a swipe that starts on them is theirs. */
const ownsSideways = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.('input[type="range"], .search-tabs, .tiers, .fp-seek, .player-seek, .dv-handle, .modal');

export function startSwipeNav() {
  // Fingers: anywhere on the page, once the movement is clearly sideways.
  let start: { x: number; y: number } | null = null;
  window.addEventListener(
    'touchstart',
    (e) => {
      start = null;
      if (active || e.touches.length !== 1 || ownsSideways(e.target) || usePlayer.getState().expanded) return;
      if (!(e.target as HTMLElement | null)?.closest?.('.main')) return;
      start = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    },
    { passive: true },
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      if (!start) return;
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      const dx = x - start.x, dy = y - start.y;
      if (!active) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (start = null); // scrolling up or down
        if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (!begin(dx > 0 ? -1 : 1, start.x, start.y)) return void (start = null);
      }
      e.preventDefault();
      move(dx);
    },
    { passive: false },
  );
  window.addEventListener('touchend', () => {
    start = null;
    end();
  });
  window.addEventListener('touchcancel', () => {
    start = null;
    end(true);
  });

  // Trackpads: a two-finger sideways swipe arrives as sideways wheel movement.
  let wheelTimer = 0;
  let acc = 0;
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || usePlayer.getState().expanded || Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.5) return;
      // A sideways scroll that something on the page can still use belongs to it.
      for (let n = e.target as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) {
          const atStart = n.scrollLeft <= 0, atEnd = n.scrollLeft + n.clientWidth >= n.scrollWidth - 1;
          if ((e.deltaX < 0 && !atStart) || (e.deltaX > 0 && !atEnd)) return;
        }
      }
      if (!active) {
        acc = 0;
        // Fingers moving right on a trackpad scroll left (negative deltaX): the tab before.
        if (!begin(e.deltaX < 0 ? -1 : 1, 0, 0)) return;
      }
      e.preventDefault();
      acc -= e.deltaX;
      move(acc);
      clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => end(), 140);
    },
    { passive: false },
  );
}
