import { useStore, type Route } from '../store';
import { usePlayer } from './player';

/**
 * Swipe sideways to move between the tabs, like flipping pages: right to left goes to the next tab
 * (Search → Downloads…), left to right to the one before. The page follows your finger and, underneath,
 * the name of the tab you're heading to; let go past a third of the way (or with a quick flick) to go
 * there. The order is the tabs you see: the bar at the bottom on a phone, the top bar on bigger screens.
 * A two-finger sideways swipe on a trackpad does the same on the computer.
 */
const LABEL: Record<string, string> = {
  search: 'Search', wishlist: 'Wishlist', downloads: 'Downloads', library: 'Library', uploads: 'Uploads',
  messages: 'Messages', rooms: 'Rooms', people: 'People', settings: 'Settings',
};
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

let under: HTMLDivElement | null = null;
function showUnder(dir: -1 | 1, text: string, el: HTMLElement) {
  if (!under) {
    under = document.createElement('div');
    under.className = 'swipe-under';
    document.body.appendChild(under);
  }
  const r = el.getBoundingClientRect();
  Object.assign(under.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: getComputedStyle(el).borderRadius });
  under.dataset.dir = dir === -1 ? 'back' : 'forward';
  under.innerHTML = `<span><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${dir === -1 ? 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20v-2Z' : 'M4 11h12.2l-5.6-5.6L12 4l8 8-8 8-1.4-1.4 5.6-5.6H4v-2Z'}"/></svg>${text}</span>`;
  under.style.display = 'grid';
}
const hideUnder = () => {
  if (under) under.style.display = 'none';
};

let active: { dir: -1 | 1; to: Route; el: HTMLElement; startX: number; startY: number; t: number; dx: number } | null = null;

function begin(dir: -1 | 1, x: number, y: number) {
  const to = neighbourTab(dir);
  const el = target();
  if (!to || !el) return false;
  active = { dir, to, el, startX: x, startY: y, t: performance.now(), dx: 0 };
  showUnder(dir, LABEL[to], el);
  el.classList.add('swiping');
  return true;
}

function move(dx: number) {
  if (!active) return;
  // Only the right way counts: the tab before follows a swipe to the right, the next one a swipe to the left.
  const d = active.dir === -1 ? Math.max(0, dx) : Math.min(0, dx);
  active.dx = d;
  active.el.style.transform = `translateX(${d}px)`;
  if (under) under.style.opacity = String(Math.min(1, Math.abs(d) / 120));
}

function end(cancel = false) {
  if (!active) return;
  const { el, dx, dir, t, to: target_ } = active;
  active = null;
  const w = el.getBoundingClientRect().width;
  const fast = Math.abs(dx) / Math.max(1, performance.now() - t) > 0.6 && Math.abs(dx) > 40;
  const go = !cancel && (Math.abs(dx) > w / 3 || fast);
  el.classList.remove('swiping');
  el.style.transition = 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1)';
  el.style.transform = go ? `translateX(${dir === -1 ? w : -w}px)` : 'translateX(0)';
  const done = () => {
    el.style.transition = '';
    hideUnder();
    el.style.transform = '';
    if (go && target_) {
      useStore.getState().go(target_);
      // The new tab slides in from the side it came from, so it doesn't just pop.
      requestAnimationFrame(() => {
        const next = target();
        if (!next) return;
        next.style.transition = 'none';
        next.style.transform = `translateX(${dir === -1 ? -60 : 60}px)`;
        next.style.opacity = '0.5';
        requestAnimationFrame(() => {
          next.style.transition = 'transform 0.25s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.2s ease-out';
          next.style.transform = '';
          next.style.opacity = '';
          setTimeout(() => (next.style.transition = ''), 280);
        });
      });
    }
  };
  setTimeout(done, 230);
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
