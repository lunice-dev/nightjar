import { useStore, type Route } from '../store';
import { usePlayer, type DrawerView } from './player';

/**
 * Back and forward, like a website: the mouse's side buttons, Alt+←/→ and a phone's back gesture move
 * through the screens you visited, and through the large player: back closes it (or goes from an album
 * back to what's playing), forward opens it again. Each step is an entry in the page's own history, so
 * "back" never leaves the app (and the Nightjar window refuses to go back to its opening screen).
 */
export interface Entry {
  route: Route;
  /** What the drawer showed, or null when it was closed. */
  drawer: DrawerView | null;
  /** How many drawer steps in a row lead here (closing it from the page goes back over all of them). */
  depth: number;
  /** Its place in the history, to know what back and forward lead to. */
  idx: number;
}

let moving = false;
let depth = 0;
/** A copy of the page's history entries (the browser doesn't let a page read them). */
let entries: Entry[] = [];
let idx = 0;

/** Where back and forward lead, for the swipe's hint; null when there's nothing that way. */
export const neighbour = (dir: -1 | 1): Entry | null => entries[idx + dir] ?? null;
export const currentEntry = (): Entry | null => entries[idx] ?? null;

const drawerOf = () => {
  const p = usePlayer.getState();
  return p.expanded ? p.view : null;
};
const same = (a: DrawerView | null, b: DrawerView | null) => JSON.stringify(a) === JSON.stringify(b);

function push(e: Omit<Entry, 'idx'>) {
  const entry = { ...e, idx: idx + 1 };
  entries = [...entries.slice(0, idx + 1), entry];
  idx = entry.idx;
  try {
    history.pushState(entry, '');
  } catch {
    /* some embedded views don't allow it; screens still work */
  }
}

export function startNavHistory() {
  try {
    const first: Entry = { route: useStore.getState().route, drawer: null, depth: 0, idx: 0 };
    entries = [first];
    idx = 0;
    history.replaceState(first, '');
  } catch {
    return;
  }

  // A new screen.
  useStore.subscribe((s, prev) => {
    if (s.route === prev.route || moving) return;
    push({ route: s.route, drawer: drawerOf(), depth });
  });

  // The drawer opened, changed what it shows, or closed.
  usePlayer.subscribe((s, prev) => {
    if (moving) return;
    const now = s.expanded ? s.view : null;
    const was = prev.expanded ? prev.view : null;
    if (same(now, was)) return;
    if (now) {
      depth += 1;
      push({ route: useStore.getState().route, drawer: now, depth });
    } else if (depth > 0) {
      // Closed from the page (arrow, Esc, swipe): step back over the drawer's entries, so "forward" can reopen it.
      const n = depth;
      depth = 0;
      moving = true;
      history.go(-n);
    }
  });

  window.addEventListener('popstate', (e) => {
    const st = e.state as Partial<Entry> | null;
    if (!st?.route) {
      moving = false;
      return;
    }
    moving = true;
    depth = st.depth ?? 0;
    idx = st.idx ?? 0;
    if (useStore.getState().route !== st.route) useStore.setState({ route: st.route });
    const want = st.drawer ?? null;
    const p = usePlayer.getState();
    if (!same(want, drawerOf())) {
      if (want) usePlayer.setState({ expanded: true, view: want });
      else if (p.expanded) p.requestClose(); // slides down, like closing it yourself
    }
    moving = false;
  });
}
