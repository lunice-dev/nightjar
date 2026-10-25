import { UpdateBanner } from './components/Updates';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DemoBackend } from './api/demo';
import { Icon } from './components/Icon';
import { WindowControls } from './components/WindowControls';
import { inApp, windowAction } from './lib/host';
import { Mark } from './components/Mark';
import { speed } from './lib/quality';
import { groupDownloads } from './lib/transfers';
import { BrowseScreen } from './screens/BrowseScreen';
import { ConnectScreen, probeSlskd } from './screens/ConnectScreen';
import { MessagesScreen } from './screens/MessagesScreen';
import { RoomsScreen } from './screens/RoomsScreen';
import { SearchScreen } from './screens/SearchScreen';
import { PeopleScreen } from './screens/PeopleScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SetupScreen } from './screens/SetupScreen';
import { AboutScreen } from './screens/AboutScreen';
import { WishlistScreen } from './screens/WishlistScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { TransfersScreen } from './screens/TransfersScreen';
import { useBackground } from './lib/background';
import { ProfileCard } from './components/ProfileCard';
import { useFriendsSync } from './lib/friends';
import { backfillFakes } from './lib/fakes';
import { sharePrefsThrough, usePrefs } from './prefs';
import { HELPER } from './api/slskd';
import { onThisComputer, remoteApi } from './api/remote';
import { Player } from './components/Player';
import { FolderBrowserHost } from './components/FolderBrowser';
import { PlaylistPicker } from './components/Playlists';
import { useStore, type Route } from './store';
import { neighbourTab } from './lib/swipeNav';

const PANES: Route[] = ['search', 'wishlist', 'downloads', 'library', 'uploads', 'messages', 'rooms', 'people', 'browse', 'settings', 'about'];

/** The window's width, kept up to date (the tab order differs on a phone). */
function useWidth() {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}
import type { IconName } from './components/Icon';

const NAV: { route: Route; label: string; short?: string; icon: IconName; primary?: boolean }[] = [
  { route: 'search', label: 'Search', icon: 'search', primary: true },
  { route: 'wishlist', label: 'Wishlist', icon: 'star' },
  { route: 'downloads', label: 'Downloads', icon: 'download', primary: true },
  { route: 'library', label: 'Library', icon: 'folder' },
  { route: 'uploads', label: 'Uploads', icon: 'upload' },
  { route: 'messages', label: 'Messages', icon: 'chat', primary: true },
  { route: 'rooms', label: 'Rooms', icon: 'rooms' },
  { route: 'people', label: 'People', icon: 'person', primary: true },
  { route: 'settings', label: 'Settings', icon: 'settings' },
];

declare const __DEMO__: boolean;

export function App() {
  const phase = useStore((s) => s.phase);
  const setBackend = useStore((s) => s.setBackend);
  const ready = useStore((s) => s.ready);
  const [error, setError] = useState<string>();
  const [connecting, setConnecting] = useState(true);
  // On a phone or another computer, the opening screen stays at least 2.5 s (the Windows app has its own splash).
  const [splash, setSplash] = useState(!inApp);
  useEffect(() => {
    if (!splash) return;
    const t = setTimeout(() => setSplash(false), 2500);
    return () => clearTimeout(t);
  }, [splash]);

  const connect = useCallback(async () => {
    setError(undefined);
    setConnecting(true);
    if (__DEMO__) {
      await usePrefs.persist.rehydrate();
      setBackend(new DemoBackend(), 'ready');
      ready('demo');
      return;
    }
    try {
      // A phone waking up its Tailscale connection can miss the first try or two: keep trying a few seconds.
      let r: Awaited<ReturnType<typeof probeSlskd>> | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          r = await probeSlskd();
          break;
        } catch (e) {
          if (attempt >= 4) throw e;
          await new Promise((res) => setTimeout(res, 1200));
        }
      }
      sharePrefsThrough(HELPER);
      await usePrefs.persist.rehydrate();
      // A new install has no Soulseek account yet: the setup steps come first.
      if (r.phase === 'ready') {
        const acct = await r.backend.account().catch(() => ({ username: 'unknown', hasPassword: true }));
        if (!acct.username || !acct.hasPassword) {
          setBackend(r.backend, 'setup');
          return;
        }
      }
      setBackend(r.backend, r.phase);
      if (r.phase === 'ready') ready(r.me);
    } catch {
      await usePrefs.persist.rehydrate();
      setError('slskd isn’t answering on this address.');
    } finally {
      setConnecting(false);
    }
  }, [setBackend, ready]);

  useEffect(() => {
    connect();
  }, [connect]);

  if (splash || (phase === 'connect' && connecting)) return <WithStrip><LoadingScreen /></WithStrip>;
  if (phase === 'closed') return <WithStrip><ClosedScreen /></WithStrip>;
  if (phase === 'setup')
    return (
      <WithStrip>
        <SetupScreen
          onDone={async () => {
            const b = useStore.getState().backend;
            const s = await b?.server().catch(() => undefined);
            ready(s?.username);
          }}
        />
      </WithStrip>
    );
  if (phase !== 'ready') return <WithStrip><ConnectScreen error={error} onRetry={connect} /></WithStrip>;
  return <Shell />;
}

/** Whether the engine is signed in to Soulseek, in words, with the reason when it isn't. */
function LinkStatus({ demo, me }: { demo: boolean; me?: string }) {
  const link = useStore((s) => s.link);
  if (demo) return <span className="status">Sample data, not connected</span>;
  const text =
    link.state === 'online'
      ? `Online as ${me ?? 'you'}`
      : link.problem === 'rejected'
        ? 'Soulseek refused your name or password'
        : link.problem === 'kicked'
          ? 'Signed out: your account is open somewhere else (SoulseekQt?)'
          : link.problem === 'no-account'
            ? 'No Soulseek account set up'
            : link.state === 'connecting'
        ? 'Signing in to Soulseek…'
        : link.state === 'offline'
          ? 'Not signed in to Soulseek'
          : 'The engine isn’t answering';
  return (
    <span className={`status link-${link.state}`} role="status">
      {text}
    </span>
  );
}

const THEMES = ['system', 'light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('ssk-lite.theme') as Theme) || 'system';
    } catch {
      return 'system';
    }
  });
  useEffect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('ssk-lite.theme', theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);
  return [theme, setTheme] as const;
}

/** What "Auto" means right now: Windows' own light or dark setting. */
function useSystemDark() {
  const query = '(prefers-color-scheme: dark)';
  const [dark, setDark] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return dark;
}

const THEME_LABEL: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'Auto' };

function ThemeSwitch({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const systemDark = useSystemDark();
  const icon = (t: Theme) =>
    t === 'light' ? (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="3.2" fill="currentColor" /><g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M3.2 12.8l1.1-1.1M11.7 4.3l1.1-1.1" /></g></svg>
    ) : t === 'dark' ? (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7z" fill="currentColor" /></svg>
    ) : (
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" /></svg>
    );
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {(['light', 'dark', 'system'] as const).map((t) => (
        <button
          key={t}
          role="radio"
          aria-checked={theme === t}
          title={t === 'system' ? `Auto: follows Windows, ${systemDark ? 'dark' : 'light'} right now` : THEME_LABEL[t]}
          onClick={() => onChange(t)}
        >
          {icon(t)}
          <span className="sr-only">{THEME_LABEL[t]}</span>
        </button>
      ))}
      <span className="theme-now">{theme === 'system' ? `Auto (${systemDark ? 'dark' : 'light'})` : THEME_LABEL[theme]}</span>
    </div>
  );
}

function Shell() {
  const route = useStore((s) => s.route);
  const go = useStore((s) => s.go);
  const tabs = useStore((s) => s.tabs);
  const activeTab = useStore((s) => s.activeTab);
  const selectTab = useStore((s) => s.selectTab);
  const closeTab = useStore((s) => s.closeTab);
  const search = useStore((s) => s.search);
  const downloads = useStore((s) => s.downloads);
  const uploads = useStore((s) => s.uploads);
  const conversations = useStore((s) => s.conversations);
  const refresh = useStore((s) => s.refreshTransfers);
  const refreshChat = useStore((s) => s.refreshConversations);
  const kind = useStore((s) => s.backend?.kind);
  const me = useStore((s) => s.me);
  const [theme, setTheme] = useTheme();

  // The open tab, plus the tabs either side kept ready (out of sight), so swiping shows the real page at once.
  const width = useWidth();
  const mounted = new Set<Route>([route, neighbourTab(-1, route, width), neighbourTab(1, route, width)].filter((r): r is Route => !!r));

  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tick = () => refresh();
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [refresh]);

  const watchLink = useStore((s) => s.watchLink);
  useEffect(() => (kind === 'demo' ? undefined : watchLink()), [watchLink, kind]);

  useEffect(() => {
    refreshChat();
    const t = setInterval(refreshChat, 3000);
    return () => clearInterval(t);
  }, [refreshChat]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if ((e.key === '/' && !typing) || (e.key === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const groups = groupDownloads(downloads, usePrefs.getState().plans);
  const active = groups.filter((g) => g.phase === 'active' || g.phase === 'queued');
  const totalSize = active.reduce((s, g) => s + g.size, 0);
  const totalDone = active.reduce((s, g) => s + g.transferred, 0);
  const totalSpeed = active.reduce((s, g) => s + g.speed, 0);
  const uploading = groupDownloads(uploads).filter((g) => g.phase === 'active' || g.phase === 'queued');
  const unread = conversations.reduce((n, c) => n + (c.unAcknowledgedMessageCount || 0), 0);
  const wishNew = usePrefs((s) => s.wishlist.reduce((n, w) => n + w.unseen, 0));
  const limits = useStore((s) => s.limits);
  const refreshLimits = useStore((s) => s.refreshLimits);
  useEffect(() => {
    refreshLimits();
    const t = setInterval(refreshLimits, 60_000);
    return () => clearInterval(t);
  }, [refreshLimits]);
  const [moreOpen, setMoreOpen] = useState(false);
  useBackground();
  useFriendsSync();
  useEffect(() => backfillFakes(), []);
  useEffect(() => {
    useStore.getState().loadLocal();
  }, []);

  const counts: Partial<Record<Route, number>> = {
    downloads: active.length,
    uploads: uploading.length,
    messages: unread,
    wishlist: wishNew,
  };
  const isCurrent = (r: Route) =>
    r === 'search' ? route === 'search' : r === 'people' ? route === 'people' || route === 'browse' : route === r;
  const open = (r: Route) => {
    if (r === 'search') useStore.setState({ activeTab: undefined });
    setMoreOpen(false);
    go(r);
  };
  const moreCount = NAV.filter((n) => !n.primary).reduce((t, n) => t + (counts[n.route] ?? 0), 0);
  const moreCurrent = NAV.some((n) => !n.primary && isCurrent(n.route));

  return (
    <div className="shell">
      <header className="topbar">
        <button className="brand" onClick={() => open('search')} aria-label="Nightjar home">
          <span className="brand-mark">
            <Mark size={24} />
          </span>
          <span className="brand-name">Nightjar</span>
        </button>
        <nav className="topnav" aria-label="Main">
          {NAV.map((n) => (
            <button key={n.route} className="topnav-item" aria-current={isCurrent(n.route) ? 'page' : undefined} onClick={() => open(n.route)} title={n.label}>
              <span className="topnav-icon" aria-hidden>
                <Icon name={n.icon} size={17} />
              </span>
              <span className="topnav-label">{n.label}</span>
              {counts[n.route] ? <span className={n.route === 'messages' || n.route === 'wishlist' ? 'pill-count hot' : 'pill-count'}>{counts[n.route]}</span> : null}
            </button>
          ))}
        </nav>
        <div className="topbar-search">
          <SearchBox inputRef={input} value={q} onChange={setQ} onSearch={(text) => { search(text); setQ(''); }} />
        </div>
        <WindowControls />
      </header>

      <UpdateBanner />
      <div className="main">
        {PANES.filter((r) => mounted.has(r)).map((r) => (
          <div key={r} className="tab-pane" data-route={r} aria-hidden={r !== route} {...(r !== route ? ({ inert: '' } as object) : {})}>
            {r === 'search' && tabs.length > 0 && (
              <div className="search-tabs" role="tablist" aria-label="Your searches">
                {tabs.map((t) => {
                  const live = t.search.state === 'InProgress' || t.search.state === 'Requested';
                  const current = activeTab === t.search.id;
                  return (
                    <span key={t.search.id} className={`search-tab ${current ? 'on' : ''}`}>
                      <button role="tab" aria-selected={current} onClick={() => selectTab(t.search.id)}>
                        {live && <span className="live-dot" aria-label="Searching" />}
                        {t.search.searchText}
                        <span className="n">{t.responses.length}</span>
                      </button>
                      <button className="search-tab-close" aria-label={`Close search for ${t.search.searchText}`} onClick={() => closeTab(t.search.id)}>
                        <Icon name="close" size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            {r === 'search' && <SearchScreen />}
            {r === 'downloads' && <TransfersScreen key="d" direction="download" />}
            {r === 'uploads' && <TransfersScreen key="u" direction="upload" />}
            {r === 'messages' && <MessagesScreen />}
            {r === 'rooms' && <RoomsScreen />}
            {r === 'browse' && <BrowseScreen />}
            {r === 'wishlist' && <WishlistScreen />}
            {r === 'library' && <LibraryScreen />}
            {r === 'people' && <PeopleScreen />}
            {r === 'settings' && <SettingsScreen />}
            {r === 'about' && <AboutScreen />}
          </div>
        ))}
      </div>
      <Player />

      <footer className="shell-foot">
        <span className="signature" aria-hidden>coded by lunice</span>
        <span className="foot-gap" />
        {active.length > 0 && (
          <button className="foot-item" onClick={() => go('downloads')}>
            <span className="meter" aria-hidden>
              <i style={{ width: `${totalSize ? (totalDone / totalSize) * 100 : 0}%` }} />
            </span>
            {active.length} {active.length === 1 ? 'album' : 'albums'} at {speed(totalSpeed)}
          </button>
        )}
        <button className="foot-item" onClick={() => open('settings')} title="Change speed limits">
          <Icon name="speed" size={14} />
          {!limits?.down && !limits?.up ? 'No speed limits' : `↓ ${fmtLimit(limits?.down)} · ↑ ${fmtLimit(limits?.up)}`}
        </button>
        <LinkStatus demo={kind === 'demo'} me={me} />
        {kind !== 'demo' && <RemoteFoot onOpen={() => open('settings')} />}
        <ThemeSwitch theme={theme} onChange={setTheme} />
        <EngineCredit />
        <button className="foot-item" aria-current={route === 'about' ? 'page' : undefined} onClick={() => open('about')}>
          About
        </button>
        {onThisComputer && <QuitButton busy={active.length} />}
      </footer>

      {/* On a phone the sidebar becomes this bar; the less used screens sit behind More. */}
      <nav className="tabbar" aria-label="Main">
        {NAV.filter((n) => n.primary).map((n) => (
          <button key={n.route} className="tab" aria-current={isCurrent(n.route) ? 'page' : undefined} onClick={() => open(n.route)}>
            <span className="tab-icon">
              <Icon name={n.icon} size={22} />
              {counts[n.route] ? <span className="dot-count">{counts[n.route]}</span> : null}
            </span>
            {n.short ?? n.label}
          </button>
        ))}
        <button className="tab" aria-expanded={moreOpen} aria-current={moreCurrent ? 'page' : undefined} onClick={() => setMoreOpen((o) => !o)}>
          <span className="tab-icon">
            <Icon name="more" size={22} />
            {moreCount ? <span className="dot-count">{moreCount}</span> : null}
          </span>
          More
        </button>
      </nav>
      {moreOpen && (
        <div className="sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="sheet" role="dialog" aria-label="More" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && setMoreOpen(false)}>
            {NAV.filter((n) => !n.primary).map((n) => (
              <button key={n.route} className="nav-item" aria-current={isCurrent(n.route) ? 'page' : undefined} onClick={() => open(n.route)}>
                <Icon name={n.icon} /> {n.label}
                {counts[n.route] ? <span className="count">{counts[n.route]}</span> : null}
              </button>
            ))}
            <div className="sheet-foot">
              <LinkStatus demo={kind === 'demo'} me={me} />
              <ThemeSwitch theme={theme} onChange={setTheme} />
              <button className="theme-toggle" onClick={() => open('about')}>
                About
              </button>
              {onThisComputer && <QuitButton busy={active.length} />}
            </div>
          </div>
        </div>
      )}
      <ProfileCard />
      <FolderBrowserHost helper={HELPER} />
      <PlaylistPicker />
      <Toasts />
    </div>
  );
}

/**
 * The search field, with the searches you made before. Arrow keys move through
 * them, Enter searches, Escape closes the list.
 */
function SearchBox({
  inputRef,
  value,
  onChange,
  onSearch,
}: {
  inputRef: React.RefObject<HTMLInputElement>;
  value: string;
  onChange: (v: string) => void;
  onSearch: (v: string) => void;
}) {
  const history = usePrefs((s) => s.searchHistory);
  const forget = usePrefs((s) => s.forgetSearches);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const t = value.trim().toLowerCase();
  const items = history.filter((h) => !t || (h.toLowerCase().includes(t) && h.toLowerCase() !== t)).slice(0, 8);
  const show = open && items.length > 0;

  const run = (text: string) => {
    if (!text.trim()) return;
    setOpen(false);
    setActive(-1);
    onSearch(text);
    inputRef.current?.blur();
  };

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        run(active >= 0 && show ? items[active] : value);
      }}
    >
      <div className="search-field">
        <Icon name="search" />
        <input
          ref={inputRef}
          className="input"
          placeholder="Artist, album or track"
          aria-label="Search the network"
          role="combobox"
          aria-expanded={show}
          aria-controls="search-history"
          aria-activedescendant={show && active >= 0 ? `sh-${active}` : undefined}
          autoComplete="off"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!show) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(items.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        <span className="kbd" aria-hidden>/</span>
        {show && (
          <div className="history" id="search-history" role="listbox" aria-label="Recent searches">
            <div className="history-head">
              <span>Recent searches</span>
              <button type="button" className="link" onMouseDown={(e) => e.preventDefault()} onClick={() => forget()}>
                Clear
              </button>
            </div>
            {items.map((h, i) => (
              <button
                type="button"
                key={h}
                id={`sh-${i}`}
                role="option"
                aria-selected={i === active}
                className="history-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(h)}
              >
                <Icon name="history" size={15} /> {h}
              </button>
            ))}
          </div>
        )}
      </div>
      <button className="btn" type="submit" disabled={!value.trim()}>
        Search
      </button>
    </form>
  );
}

const fmtLimit = (kib: number | null | undefined) =>
  !kib ? 'any' : kib >= 1024 ? `${+(kib / 1024).toFixed(1)} MB/s` : `${kib} KB/s`;

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <span>{t.text}</span>
          <button aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Quit: stops the engine, which closes the app around it too (the icon next to
 * the clock, the launcher window). Asks first when albums are still coming in.
 */
function QuitButton({ busy }: { busy: number }) {
  const [asking, setAsking] = useState(false);
  const quit = async () => {
    const { backend, toast } = useStore.getState();
    if (inApp) {
      // The app stops the engine cleanly and closes everything, the icon next to the clock included.
      windowAction('quit');
      return;
    }
    try {
      await backend?.quit();
    } catch (e) {
      // The engine closing can cut the answer short; anything else is worth saying.
      if ((e as { status?: number }).status) {
        toast(`Couldn’t quit: ${(e as Error).message}`, 'error');
        return;
      }
    }
    useStore.setState({ phase: 'closed' });
    // A window Nightjar opened itself can close itself.
    setTimeout(() => window.close(), 400);
  };
  if (asking)
    return (
      <span className="quit-confirm" role="alertdialog" aria-label="Quit Nightjar">
        {busy} {busy === 1 ? 'album is' : 'albums are'} still downloading. They continue next time.
        <button className="foot-item danger" onClick={quit}>Quit</button>
        <button className="foot-item" onClick={() => setAsking(false)}>Keep running</button>
      </span>
    );
  return (
    <button className="foot-item quit" onClick={() => (busy ? setAsking(true) : quit())} title="Stop Nightjar completely, including the icon next to the clock">
      <Icon name="power" size={14} /> Quit
    </button>
  );
}

/** Outside the main screens, the app window still needs somewhere to drag it and its buttons. */
function WithStrip({ children }: { children: React.ReactNode }) {
  if (!inApp) return <>{children}</>;
  return (
    <div className="with-strip">
      <div className="app-strip">
        <WindowControls />
      </div>
      {children}
    </div>
  );
}

function ClosedScreen() {
  return (
    <main className="connect">
      <div className="connect-card closed">
        <h1>
          <Mark size={34} /> Nightjar is closed
        </h1>
        <p>Downloads and sharing are stopped. Open Nightjar from the Start menu or the desktop to start it again.</p>
        <p className="hint-text small">You can close this window.</p>
      </div>
    </main>
  );
}

/** "Remote on" in the footer while your devices can reach Nightjar; a warning when they can't any more. */
/**
 * The engine's credit, as slskd shows it in its own interface (name, version, licence, link): Nightjar replaces
 * that interface, so it carries the credit instead, as slskd's licence asks.
 */
function EngineCredit() {
  const backend = useStore((s) => s.backend);
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    backend?.engineVersion().then((v) => alive && setVersion(v)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [backend]);
  return (
    <a
      className="foot-item engine-credit"
      href="https://github.com/slskd/slskd"
      target="_blank"
      rel="noreferrer"
      title="Nightjar runs slskd, an open source Soulseek engine, without changes. Nightjar isn’t made by or affiliated with the slskd project."
    >
      Engine: slskd{version ? ` ${version}` : ''} · AGPLv3
    </a>
  );
}

function RemoteFoot({ onOpen }: { onOpen: () => void }) {
  const [state, setState] = useState<'on' | 'broken' | null>(null);
  useEffect(() => {
    if (!onThisComputer) return;
    const api = remoteApi(HELPER);
    const look = () =>
      api
        .status()
        .then((st) => setState(st.address ? 'on' : st.devices.length > 0 ? 'broken' : null))
        .catch(() => setState(null));
    look();
    const t = setInterval(look, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!state) return null;
  return (
    <button className={`foot-item remote-foot ${state}`} onClick={onOpen} title={state === 'on' ? 'Your devices can reach Nightjar through Tailscale' : 'Tailscale isn’t connected: your devices can’t reach Nightjar'}>
      <Icon name="phone" size={14} /> {state === 'on' ? 'Remote on' : 'Remote off'}
    </button>
  );
}

/** While Nightjar reaches the engine: the bird, breathing. Words only if it takes a while. */
function LoadingScreen() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 3500);
    return () => clearTimeout(t);
  }, []);
  return (
    <main className="connect loading-screen" aria-busy="true">
      <div className="loading-mark">
        <Mark size={64} />
      </div>
      <h1 className="loading-name">Nightjar</h1>
      <p className={`loading-text ${slow ? 'in' : ''}`} role="status">
        {onThisComputer ? 'Starting Nightjar…' : 'Connecting to your computer…'}
      </p>
      <span className="signature loading-sig" aria-hidden>coded by lunice</span>
    </main>
  );
}
