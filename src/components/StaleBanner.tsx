import { useEffect, useState } from 'react';

declare const __DEMO__: boolean;

/** The script this page was started from, e.g. "./assets/index-AbC123.js" (none in development). */
const running = () => document.querySelector('script[type="module"][src*="assets/index-"]')?.getAttribute('src')?.replace(/^\.?\//, '') ?? null;

/** The script the computer's copy of the page starts from now. */
async function current(): Promise<string | null> {
  try {
    const res = await fetch(new URL(`index.html?t=${Date.now()}`, document.baseURI), { cache: 'no-store', signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    return /assets\/index-[^"']+\.js/.exec(await res.text())?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * A phone or tablet keeps the page it last loaded, sometimes for days. This notices when the computer has a newer one
 * (when the page opens, when it comes back to the front, every few minutes) and reloads it once by itself right after it
 * opens; later it offers a Reload button, so music is never cut off without asking.
 */
export function StaleBanner() {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (__DEMO__) return;
    const mine = running();
    if (!mine) return;
    const started = Date.now();
    const check = async () => {
      const now = await current();
      if (!now || now === mine) return;
      const key = 'nightjar.autoReload';
      let last = 0;
      try {
        last = Number(sessionStorage.getItem(key)) || 0;
      } catch {
        /* storage unavailable */
      }
      // Just opened and out of date: take the new page now, once (a second try within a minute means the old one is being served from a cache).
      if (Date.now() - started < 20_000 && Date.now() - last > 60_000) {
        try {
          sessionStorage.setItem(key, String(Date.now()));
        } catch {
          /* storage unavailable */
        }
        location.reload();
        return;
      }
      setStale(true);
    };
    const first = setTimeout(check, 2500);
    const again = setInterval(check, 5 * 60_000);
    const onShow = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearTimeout(first);
      clearInterval(again);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, []);

  if (!stale) return null;
  return (
    <div className="stale-banner" role="status">
      <span>A newer nightjar is ready.</span>
      <button onClick={() => location.reload()}>Reload</button>
    </div>
  );
}
