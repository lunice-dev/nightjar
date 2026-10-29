/**
 * How this page sits on the device's screen. An installed iPhone or iPad app with the translucent status bar draws
 * under the status bar. Measuring the page's own height is unreliable there (it can come out shorter than the
 * screen, and anything anchored to its bottom edge stops short), so the stylesheet is given the screen's real
 * height instead.
 */

export interface ViewportInfo {
  /** Safe-area insets in px: what the status bar / Dynamic Island and the home indicator take. */
  top: number;
  bottom: number;
  innerWidth: number;
  innerHeight: number;
  /** The screen's height in the orientation the page is in. */
  screenHeight: number;
  standalone: boolean;
  portrait: boolean;
}

/** Whether the page should be given the screen's full height: an installed app, upright, drawing under the status bar. */
export const wantsFullScreen = (i: Pick<ViewportInfo, 'top' | 'standalone' | 'portrait'>) => i.standalone && i.portrait && i.top > 0;

export function viewportInfo(): ViewportInfo {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const top = parseFloat(cs.paddingTop) || 0;
  const bottom = parseFloat(cs.paddingBottom) || 0;
  probe.remove();

  const portrait = window.innerHeight >= window.innerWidth;
  // iOS reports the screen's size in its upright orientation whichever way it is held.
  const screenHeight = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const standalone = (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  return { top, bottom, innerWidth: window.innerWidth, innerHeight: window.innerHeight, screenHeight, standalone, portrait };
}

/** Keeps <html> marked ("safe-top", "full-screen" and --screen-h) so the stylesheet can use the whole screen. */
export function watchViewport() {
  const update = () => {
    const i = viewportInfo();
    const root = document.documentElement;
    root.classList.toggle('safe-top', i.top > 0);
    root.classList.toggle('full-screen', wantsFullScreen(i));
    root.style.setProperty('--screen-h', `${i.screenHeight}px`);
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
}
