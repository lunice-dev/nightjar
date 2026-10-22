import { useStore, type Route } from '../store';

/**
 * Back and forward between screens, like a website: the mouse's side buttons, Alt+←/→ and a phone's
 * back gesture all move through the screens you visited. Each screen is an entry in the page's own
 * history, so "back" never leaves the app (and the Nightjar window refuses to go back to its opening screen).
 */
let moving = false;

export function startNavHistory() {
  try {
    history.replaceState({ route: useStore.getState().route }, '');
  } catch {
    return;
  }
  useStore.subscribe((s, prev) => {
    if (s.route === prev.route || moving) return;
    try {
      history.pushState({ route: s.route }, '');
    } catch {
      /* some embedded views don't allow it; screens still work */
    }
  });
  window.addEventListener('popstate', (e) => {
    const route = (e.state as { route?: Route } | null)?.route;
    if (!route) return;
    moving = true;
    useStore.setState({ route });
    moving = false;
  });
}
