/**
 * How this page sits on the device's screen. On an installed iPhone or iPad app with the translucent status bar,
 * the page draws under the status bar, and iOS can leave the page about one status-bar height shorter than the
 * screen, with an empty band at the bottom. These helpers measure that and tell the stylesheet.
 */

export interface ViewportInfo {
  /** Safe-area insets in px: what the status bar / Dynamic Island and the home indicator take. */
  top: number;
  bottom: number;
  /** Size of the page and of the screen (the screen's height in the orientation the page is in). */
  innerWidth: number;
  innerHeight: number;
  screenHeight: number;
  standalone: boolean;
  /** How much shorter the page is than the screen, when it looks like the status-bar quirk (else 0). */
  gap: number;
}

/**
 * How much shorter the page is than the screen, if that looks like the status-bar quirk: an installed app under a
 * status bar of height `top`, short by about that much. Anything else (a keyboard, a split view) counts as 0.
 */
export const quirkGap = (screenHeight: number, innerHeight: number, top: number, standalone: boolean) => {
  const raw = screenHeight - innerHeight;
  return standalone && top > 0 && raw >= 20 && raw <= top + 10 ? raw : 0;
};

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
  const screenHeight = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  const standalone = (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  const gap = quirkGap(screenHeight, window.innerHeight, top, standalone);
  return { top, bottom, innerWidth: window.innerWidth, innerHeight: window.innerHeight, screenHeight, standalone, gap };
}

/** Keeps <html> marked ("safe-top", "vp-gap" and --vp-gap) so the stylesheet can use the whole screen. */
export function watchViewport() {
  const update = () => {
    const i = viewportInfo();
    const root = document.documentElement;
    root.classList.toggle('safe-top', i.top > 0);
    root.classList.toggle('vp-gap', i.gap > 0);
    root.style.setProperty('--vp-gap', `${i.gap}px`);
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
}
