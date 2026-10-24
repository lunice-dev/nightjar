import { currentEntry, neighbour, type Entry } from './navHistory';

/**
 * Swipe sideways to go back or forward, like Safari: start at the left edge of the screen to go back,
 * at the right edge to go forward. The page (or the open player) follows your finger, and underneath
 * a panel says where you're going; let go past a third of the way (or with a quick flick) to go there.
 * A two-finger sideways swipe on a trackpad does the same on the computer.
 */
const EDGE = 28; // px from the screen edge where a swipe can start
const LABEL: Record<string, string> = {
  search: 'Search', wishlist: 'Wishlist', downloads: 'Downloads', library: 'Library', uploads: 'Uploads',
  messages: 'Messages', rooms: 'Rooms', people: 'People', browse: 'Browse', settings: 'Settings', about: 'About',
};

function describe(from: Entry | null, to: Entry): string {
  if (from?.drawer && !to.drawer) return 'Close the player';
  if (to.drawer) return to.drawer.kind === 'now' ? 'Now playing' : to.drawer.kind === 'album' ? 'The album' : 'The playlist';
  return LABEL[to.route] ?? 'Back';
}

/** The element that moves: the open player, or the page. */
const target = () => (document.querySelector('.full-player') as HTMLElement | null) ?? (document.querySelector('.main') as HTMLElement | null);

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

let active: { dir: -1 | 1; el: HTMLElement; startX: number; startY: number; t: number; dx: number; decided: boolean } | null = null;

function begin(dir: -1 | 1, x: number, y: number) {
  const to = neighbour(dir);
  const el = target();
  if (!to || !el) return false;
  active = { dir, el, startX: x, startY: y, t: performance.now(), dx: 0, decided: false };
  showUnder(dir, describe(currentEntry(), to), el);
  el.classList.add('swiping');
  return true;
}

function move(dx: number) {
  if (!active) return;
  // Only the right way counts: back follows a swipe to the right, forward a swipe to the left.
  const d = active.dir === -1 ? Math.max(0, dx) : Math.min(0, dx);
  active.dx = d;
  active.el.style.transform = `translateX(${d}px)`;
  if (under) under.style.opacity = String(Math.min(1, Math.abs(d) / 120));
}

function end(cancel = false) {
  if (!active) return;
  const { el, dx, dir, t } = active;
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
    if (go) {
      // The new page slides in from the other side, so it doesn't just pop.
      if (dir === -1) history.back();
      else history.forward();
      requestAnimationFrame(() => {
        const next = target();
        if (!next) return;
        next.style.transition = 'none';
        next.style.transform = `translateX(${dir === -1 ? -40 : 40}px)`;
        next.style.opacity = '0.6';
        requestAnimationFrame(() => {
          next.style.transition = 'transform 0.22s ease-out, opacity 0.22s ease-out';
          next.style.transform = '';
          next.style.opacity = '';
          setTimeout(() => (next.style.transition = ''), 260);
        });
      });
    }
    el.style.transform = '';
  };
  setTimeout(done, 230);
}

/** Things you drag sideways yourself: a swipe that starts on them is theirs. */
const ownsSideways = (t: EventTarget | null) =>
  !!(t as HTMLElement | null)?.closest?.('input[type="range"], .search-tabs, .tiers, .fp-seek, .player-seek, .dv-handle, .modal');

export function startSwipeNav() {
  // Fingers: from the edges.
  window.addEventListener(
    'touchstart',
    (e) => {
      if (active || e.touches.length !== 1 || ownsSideways(e.target)) return;
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      if (x <= EDGE) begin(-1, x, y);
      else if (x >= window.innerWidth - EDGE) begin(1, x, y);
    },
    { passive: true },
  );
  window.addEventListener(
    'touchmove',
    (e) => {
      if (!active) return;
      const dx = e.touches[0].clientX - active.startX, dy = e.touches[0].clientY - active.startY;
      if (!active.decided) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) return end(true); // scrolling, not swiping
        if (Math.abs(dx) < 8) return;
        active.decided = true;
      }
      e.preventDefault();
      move(dx);
    },
    { passive: false },
  );
  window.addEventListener('touchend', () => end());
  window.addEventListener('touchcancel', () => end(true));

  // Trackpads: a two-finger sideways swipe arrives as sideways wheel movement.
  let wheelTimer = 0;
  let acc = 0;
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.5) return;
      // A sideways scroll that something on the page can still use belongs to it.
      for (let n = e.target as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
        if (n.scrollWidth > n.clientWidth + 2 && /(auto|scroll)/.test(getComputedStyle(n).overflowX)) {
          const atStart = n.scrollLeft <= 0, atEnd = n.scrollLeft + n.clientWidth >= n.scrollWidth - 1;
          if ((e.deltaX < 0 && !atStart) || (e.deltaX > 0 && !atEnd)) return;
        }
      }
      if (!active) {
        acc = 0;
        // Fingers moving right on a trackpad scroll left (negative deltaX): that's "back".
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
