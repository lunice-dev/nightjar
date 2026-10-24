/**
 * The Nightjar app on Windows shows this page in a WebView2 window with no
 * Windows title bar: the page draws its own (drag area plus minimise, maximise
 * and close) and talks to the app through WebView2's message channel.
 *
 * Messages to the app: { type: 'window', action: 'drag' | 'minimize' | 'maximize' | 'close' | 'quit' }.
 * Messages from it:    { type: 'window', maximized: boolean }.
 */
interface WebView {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
}

const webview = (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview;

/** True inside the Nightjar app's own window. */
export const inApp = !!webview;

export function windowAction(action: 'minimize' | 'maximize' | 'close' | 'quit') {
  webview?.postMessage({ type: 'window', action });
}

export function onWindowState(fn: (s: { maximized: boolean }) => void) {
  if (!webview) return () => {};
  const listener = (e: { data: unknown }) => {
    const d = e.data as { type?: string; maximized?: boolean };
    if (d?.type === 'window' && typeof d.maximized === 'boolean') fn({ maximized: d.maximized });
  };
  webview.addEventListener('message', listener);
  return () => webview.removeEventListener('message', listener);
}

if (inApp) {
  document.documentElement.classList.add('in-app');
  // The top bar is the title bar: press and drag on an empty part of it to move the window, double-click to maximise.
  const onBar = (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    return !!t?.closest('.topbar, .app-strip, .fp-top') && !t.closest('button, input, a, select, textarea, [role="tab"], form, .win-controls');
  };
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0 && e.detail === 1 && onBar(e)) webview!.postMessage({ type: 'window', action: 'drag' });
  });
  document.addEventListener('dblclick', (e) => {
    if (onBar(e)) windowAction('maximize');
  });
}
