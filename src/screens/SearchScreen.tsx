import type { LibAlbum } from '../api/library';
import { betterThanYours, inLibrary, libraryLabel, useLibraryIndex } from '../lib/libraryIndex';
import { useVirtualizer } from '@tanstack/react-virtual';
import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { rescanAndWait, scanOnce, useShareVersion } from '../lib/shareVersion';
import { Icon } from '../components/Icon';
import { Pulse } from '../components/Pulse';
import { Cover } from '../components/Cover';
import { groupCoverDir, useLocalFiles } from '../lib/useLocal';
import { groupDownloads } from '../lib/transfers';
import { localShareDir } from '../lib/covers';
import {
  TIERS,
  TIER_LABEL,
  basename,
  bytes,
  duration,
  formatLabel,
  speed,
  tierOf,
  toFolders,
  releaseScore,
  toReleases,
  type FolderResult,
  type Release,
  type Tier,
} from '../lib/quality';
import { bestStart, sameFiles, smartDownload } from '../lib/smart';
import { usePrefs } from '../prefs';
import { fakeCounts } from '../lib/fakes';
import { defaultFilters, useStore, type Filters } from '../store';

export function SearchScreen() {
  const tab = useStore((s) => s.tabs.find((t) => t.search.id === s.activeTab));
  if (!tab) return <Landing />;
  return <Results key={tab.search.id} id={tab.search.id} />;
}

const EXAMPLES = ['halvard moss', 'signal path', 'alfama tapes', 'kestrel park'];

const focusSearch = () => {
  const el = document.querySelector<HTMLInputElement>('input[aria-label="Search the network"]');
  el?.focus();
};

const shortDate = (t: number) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

/** The home page: what you're downloading, what arrived lately, and your own library. */
function Landing() {
  const search = useStore((s) => s.search);
  const go = useStore((s) => s.go);
  const demo = useStore((s) => s.backend?.kind === 'demo');
  const downloads = useStore((s) => s.downloads);
  const plans = usePrefs((s) => s.plans);
  const where = useStore((s) => s.local);
  const files = useLocalFiles();
  const groups = useMemo(() => groupDownloads(downloads, plans), [downloads, plans]);
  const history = usePrefs((s) => s.finished);
  // What's on the way comes first, then everything that finished (kept even after Clear finished).
  const items = useMemo(() => {
    const live = groups
      .filter((g) => g.phase !== 'done')
      .map((g) => ({
        key: g.key,
        title: g.title,
        parent: g.parent,
        time: g.time,
        phase: g.phase,
        pct: g.size ? Math.round((g.transferred / g.size) * 100) : 0,
        dir: groupCoverDir(g, files, where.downloadDir),
      }));
    const liveKeys = new Set(live.map((x) => x.key));
    const done = history
      .filter((a) => !liveKeys.has(a.key))
      .map((a) => ({ key: a.key, title: a.title, parent: a.artist ?? '', time: a.at, phase: 'done' as const, pct: 100, dir: a.dir }));
    return [...live, ...done];
  }, [groups, history, files, where.downloadDir]);
  const featured = items.find((g) => g.phase === 'active') ?? items.find((g) => g.phase === 'queued') ?? items[0];
  const latest = items.slice(0, 4);

  const featuredLabel = !featured
    ? null
    : featured.phase === 'active'
      ? `Downloading, ${featured.pct}%`
      : featured.phase === 'queued'
        ? 'Waiting to start'
        : featured.phase === 'done'
          ? 'Latest download'
          : 'Needs attention';

  return (
    <div className="results home">
      <div className="home-inner">
        <section className="hero" aria-label="Start">
          <div className="hero-copy">
            <h1 className="hero-title">Dig at night. Keep the best copy.</h1>
            <p className="hero-sub">
              Nightjar searches Soulseek, where people share their own record collections. Every copy of an album is stacked
              together and ranked by quality and speed, so the best one you can get is on top.
            </p>
            <div className="hero-actions">
              <button className="btn" onClick={focusSearch}>
                <Icon name="search" size={16} /> Start a search
              </button>
              {demo && (
                <button className="btn quiet" onClick={() => search(EXAMPLES[0])}>
                  Try “{EXAMPLES[0]}”
                </button>
              )}
            </div>
            <ul className="scale compact" aria-label="How quality is shown">
              <li className="t-hires"><b>Hi-res</b></li>
              <li className="t-lossless"><b>Lossless</b></li>
              <li className="t-high"><b>320</b></li>
              <li className="t-mid"><b>VBR</b></li>
              <li className="t-low"><b>Low</b></li>
            </ul>
          </div>

          <button className="hero-art" onClick={() => go('downloads')} disabled={!featured} aria-label={featured ? `${featured.title}: ${featuredLabel}` : 'No downloads yet'}>
            {featured ? (
              <>
                <Cover className="hero-cover" dir={featured.dir} artist={featured.parent} album={featured.title} seed={featured.key} />
                <span className="hero-caption">
                  <span className="hero-chip">{featuredLabel}</span>
                  <b>{featured.title}</b>
                  {featured.parent && <span>{featured.parent}</span>}
                </span>
              </>
            ) : (
              <>
                <Cover className="hero-cover" seed="ssk-lite-empty" online={false} />
                <span className="hero-caption">
                  <span className="hero-chip">Nothing downloading</span>
                  <b>Your next album shows up here</b>
                </span>
              </>
            )}
          </button>

          <aside className="hero-list" aria-labelledby="latest-h">
            <div className="hero-list-head">
              <h2 id="latest-h">Latest downloads</h2>
              <button className="pill-btn" onClick={() => go('downloads')}>View all</button>
            </div>
            {latest.length === 0 ? (
              <p className="hint-text">Albums you download appear here with their cover art.</p>
            ) : (
              <ul>
                {latest.map((g) => (
                  <li key={g.key}>
                    <button onClick={() => go('downloads')}>
                      <Cover className="hl-cover" dir={g.dir} artist={g.parent} album={g.title} seed={g.key} />
                      <span className="hl-text">
                        <b>{g.title}</b>
                        {g.phase === 'active' && <span className="hl-chip">{g.pct}%</span>}
                        {g.phase === 'failed' && <span className="hl-chip bad">Problem</span>}
                        <small>{[g.parent, shortDate(g.time)].filter(Boolean).join(', ')}</small>
                      </span>
                      <Icon name="chevron" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </section>
        <Pulse />
        <YourShares />
      </div>
    </div>
  );
}

let sharesCache: { at: number; folders: FolderResult[] } | undefined;

function libraryStats(folders: FolderResult[]) {
  const counts = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
  folders.forEach((f) => counts[f.tier]++);
  const files = folders.reduce((n, f) => n + f.audio.length, 0);
  const size = folders.reduce((n, f) => n + f.size, 0);
  return { counts, files, size };
}

/**
 * Your own library the way the network sees it: grouped into albums and sorted
 * by audio quality, with the folder tree one click away.
 */
function YourShares() {
  const backend = useStore((s) => s.backend);
  const me = useStore((s) => s.me);
  const browse = useStore((s) => s.browse);
  const [folders, setFolders] = useState<FolderResult[] | undefined>(sharesCache?.folders);
  const [error, setError] = useState<string>();
  const [tier, setTier] = useState<Tier | 'all'>('all');
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(24);
  const [checking, setChecking] = useState(false);
  const roots = useStore((s) => s.local.roots);

  const load = useCallback(async () => {
    if (!backend || !me) return;
    setError(undefined);
    try {
      const res = await backend.browse(me);
      const files = res.directories.flatMap((d) => d.files.map((f) => ({ ...f, filename: `${d.name}\\${f.filename}` })));
      const list = toFolders([
        { username: me, files, lockedFiles: [], fileCount: files.length, lockedFileCount: 0, hasFreeUploadSlot: true, queueLength: 0, uploadSpeed: 0 },
      ]).sort((a, b) => `${a.parent} ${a.title}`.localeCompare(`${b.parent} ${b.title}`));
      sharesCache = { at: Date.now(), folders: list };
      setFolders(list);
      const st = libraryStats(list);
      useStore.setState({ library: { albums: list.length, tracks: st.files, size: st.size, tiers: st.counts } });
    } catch (e) {
      setError((e as Error).message);
    }
  }, [backend, me]);

  // Always read it fresh (the last copy shows meanwhile), and again whenever the share changes.
  const version = useShareVersion();
  useEffect(() => {
    load();
  }, [load, version]);
  // The first time this session: scan, so deleted files disappear, then read again.
  useEffect(() => {
    if (!backend || !me) return;
    setChecking(true);
    scanOnce()
      .then(load)
      .finally(() => setChecking(false));
  }, [backend, me, load]);
  const scanNow = async () => {
    setChecking(true);
    try {
      await rescanAndWait();
      await load();
    } finally {
      setChecking(false);
    }
  };

  if (error && !folders)
    return (
      <section className="your-shares">
        <h2>Your shares</h2>
        <p className="error">Couldn’t read your share: {error}</p>
        <button className="btn quiet small" onClick={load}>
          Try again
        </button>
      </section>
    );
  if (!folders)
    return (
      <section className="your-shares">
        <h2>Your shares</h2>
        <p className="hint-text">
          <span className="spinner" aria-hidden /> {me ? 'Reading your shared folders…' : 'Waiting for the engine to sign in to Soulseek…'}
        </p>
      </section>
    );

  const { counts, files, size } = libraryStats(folders);
  const words = text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = folders.filter(
    (f) => (tier === 'all' || f.tier === tier) && words.every((w) => `${f.parent} ${f.title}`.toLowerCase().includes(w)),
  );

  return (
    <section className="your-shares" aria-labelledby="shares-h">
      <div className="activity-head">
        <div>
          <h2 id="shares-h">From your share</h2>
          <p className="hint-text">
            {folders.length} albums, {files.toLocaleString()} tracks, {bytes(size)}. This is what others find when they search or browse you.
          </p>
        </div>
        <div className="head-actions">
          {me && (
            <button className="btn quiet small" onClick={() => browse(me)}>
              <Icon name="folder" size={16} /> See the folder tree as others do
            </button>
          )}
          <button className="btn quiet small" onClick={scanNow} disabled={checking} title="Look through your shared folders again, so moved and deleted files disappear">
            {checking ? <span className="spinner" aria-hidden /> : <Icon name="retry" size={16} />} {checking ? 'Checking your folders…' : 'Scan again'}
          </button>
        </div>
      </div>
      <div className="filters">
        <div className="tiers">
          <button className="chip plain" aria-pressed={tier === 'all'} onClick={() => setTier('all')}>
            All <span className="n">{folders.length}</span>
          </button>
          {TIERS.filter((t) => counts[t] > 0).map((t) => (
            <button key={t} className={`chip t-${t}`} aria-pressed={tier === t || tier === 'all'} onClick={() => setTier(tier === t ? 'all' : t)}>
              {TIER_LABEL[t]} <span className="n">{counts[t]}</span>
            </button>
          ))}
        </div>
        <input className="input filter-text" placeholder="Find in your share" aria-label="Find in your share" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <ul className="shelf">
        {shown.slice(0, limit).map((f) => (
          <li key={f.key} className={`shelf-item t-${f.tier}`}>
            <Cover className="shelf-cover" dir={localShareDir(f.folder, roots)} artist={f.parent} album={f.title} seed={f.key} />
            <span className="shelf-title" title={f.title}>{f.title}</span>
            <span className="shelf-artist">{[f.parent, f.year].filter(Boolean).join(', ')}</span>
            <span className="shelf-meta">
              <span className="format">{f.format}</span>
              <span className="dim">{f.audio.length} tracks</span>
            </span>
          </li>
        ))}
      </ul>
      {shown.length > limit && (
        <button className="btn quiet small" onClick={() => setLimit((l) => l + 48)}>
          Show {Math.min(48, shown.length - limit)} more
        </button>
      )}
      {shown.length === 0 && <p className="hint-text">Nothing matches.</p>}
    </section>
  );
}

/** Keeps the sources that pass the filters; a release shows its best remaining copy. */
function applyFilters(releases: Release[], f: Filters, query: string): Release[] {
  const words = f.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out: Release[] = [];
  for (const rel of releases) {
    const sources = rel.sources.filter((s) => {
      if (!f.tiers.has(s.tier)) return false;
      if (f.freeSlotOnly && !s.hasFreeUploadSlot) return false;
      if (s.audio.length < f.minTracks) return false;
      if (words.length) {
        const hay = `${s.parent} ${s.title} ${s.folder}`.toLowerCase();
        if (!words.every((t) => (t.startsWith('-') ? !hay.includes(t.slice(1)) : hay.includes(t)))) return false;
      }
      return true;
    });
    if (sources.length) out.push(sources.length === rel.sources.length ? rel : { ...rel, best: sources[0], sources, score: releaseScore(sources[0], sources, query) });
  }
  return out.sort((a, b) => b.score - a.score);
}

function Results({ id }: { id: string }) {
  const libIndex = useLibraryIndex();
  const tab = useStore((s) => s.tabs.find((t) => t.search.id === id))!;
  const filters = useStore((s) => s.filters[id]) ?? defaultFilters();
  const setFilters = useStore((s) => s.setFilters);
  const stopSearch = useStore((s) => s.stopSearch);

  const ignored = usePrefs((s) => s.ignored);
  const addWish = usePrefs((s) => s.addWish);
  const wished = usePrefs((s) => s.wishlist.some((w) => w.query.toLowerCase() === tab.search.searchText.toLowerCase()));
  const go = useStore((s) => s.go);
  const scroller = useRef<HTMLDivElement>(null);
  const speeds = useStore((s) => s.speeds);
  const fakes = usePrefs((s) => s.fakes);
  const query = tab.search.searchText;
  // Grouping thousands of files takes a moment: the screen keeps responding while it catches up.
  const responses = useDeferredValue(tab.responses);
  const earlier = useDeferredValue(tab.earlier);
  const releases = useMemo(() => {
    // People who answered an earlier search for the same words but not this one still count, ranked lower.
    const now = new Set(responses.map((r) => r.username));
    const all = [...responses, ...(earlier ?? []).filter((r) => !now.has(r.username))];
    return toReleases(toFolders(all.filter((r) => !ignored.includes(r.username)), speeds, fakeCounts(fakes)), query);
  }, [responses, earlier, ignored, speeds, query, fakes]);
  const ranked = useMemo(() => applyFilters(releases, filters, query), [releases, filters, query]);

  // Results keep their place once you start reading them; newcomers wait behind a button.
  const [frozen, setFrozen] = useState<string[] | null>(null);
  const live0 = tab.search.state === 'InProgress' || tab.search.state === 'Requested';
  const visible = useMemo(() => {
    if (!frozen) return ranked;
    const byKey = new Map(ranked.map((r) => [r.key, r]));
    const kept = frozen.map((k) => byKey.get(k)).filter((r): r is Release => !!r);
    const seen = new Set(frozen);
    return [...kept, ...ranked.filter((r) => !seen.has(r.key))];
  }, [ranked, frozen]);
  const newCount = frozen ? ranked.filter((r) => !frozen.includes(r.key)).length : 0;
  const freeze = useCallback(() => setFrozen((f) => f ?? ranked.map((r) => r.key)), [ranked]);
  useEffect(() => setFrozen(null), [filters]);
  // When the search ends and you haven't scrolled down, show the final best order.
  useEffect(() => {
    if (!live0 && (scroller.current?.scrollTop ?? 0) < 80) setFrozen(null);
  }, [live0]);
  const tierCounts = useMemo(() => {
    const c = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<Tier, number>;
    // A release counts once for every quality it's available in.
    releases.forEach((r) => new Set(r.sources.map((x) => x.tier)).forEach((t) => c[t]++));
    return c;
  }, [releases]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (key: string) => {
      freeze();
      setExpanded((s) => {
        const n = new Set(s);
        if (n.has(key)) n.delete(key);
        else n.add(key);
        return n;
      });
    },
    [freeze],
  );

  const header = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useLayoutEffect(() => {
    const el = header.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeaderHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const v = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => 104,
    overscan: 6,
    getItemKey: (i) => visible[i].key,
    scrollMargin: headerHeight,
  });

  const live = tab.search.state === 'InProgress' || tab.search.state === 'Requested';
  const users = tab.responses.length;

  const toggleTier = (t: Tier) => {
    const next = new Set(filters.tiers);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setFilters(id, { tiers: next });
  };

  return (
    <div className="results" ref={scroller} onScroll={(e) => (live || frozen) && e.currentTarget.scrollTop > 120 && freeze()}>
      <div className="results-inner">
        <div ref={header}>
          <div className="query-row">
            <h1 className="query">{tab.search.searchText}</h1>
            {wished ? (
              <button className="btn quiet small" onClick={() => go('wishlist')}>
                <Icon name="check" size={16} /> On your wishlist
              </button>
            ) : (
              <button
                className="btn quiet small"
                title="Search again every now and then and tell me when new copies appear"
                onClick={() => {
                  addWish(tab.search.searchText);
                  useStore.getState().toast(`Added “${tab.search.searchText}” to your wishlist`);
                }}
              >
                <Icon name="star" size={16} /> Add to wishlist
              </button>
            )}
          </div>
          <div className="query-meta" aria-live="polite">
            {live ? (
              <>
                <span className="spinner" aria-hidden />
                <span>
                  Searching, {users} {users === 1 ? 'person has' : 'people have'} answered
                </span>
                <button className="link" onClick={() => stopSearch(id)}>
                  Stop searching
                </button>
              </>
            ) : (
              <span>
                {releases.length} {releases.length === 1 ? 'release' : 'releases'} from {users} {users === 1 ? 'person' : 'people'}
                {tab.search.state === 'Completed, Cancelled' ? ', stopped early' : ''}
              </span>
            )}
          </div>

          <div className="filters" role="group" aria-label="Filter results">
            <div className="tiers">
              {TIERS.filter((t) => t !== 'unknown' || tierCounts.unknown > 0).map((t) => (
                <button
                  key={t}
                  className={`chip t-${t}`}
                  aria-pressed={filters.tiers.has(t)}
                  onClick={() => toggleTier(t)}
                  disabled={tierCounts[t] === 0 && filters.tiers.has(t)}
                >
                  {TIER_LABEL[t]} <span className="n">{tierCounts[t]}</span>
                </button>
              ))}
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={filters.freeSlotOnly}
                onChange={(e) => setFilters(id, { freeSlotOnly: e.target.checked })}
              />
              Free slot only
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={filters.minTracks >= 4}
                onChange={(e) => setFilters(id, { minTracks: e.target.checked ? 4 : 0 })}
              />
              Full albums only
            </label>
            <input
              className="input filter-text"
              placeholder="Narrow results, -word to exclude"
              aria-label="Narrow results"
              value={filters.text}
              onChange={(e) => setFilters(id, { text: e.target.value })}
            />
          </div>
        </div>

        {newCount > 0 && (
          <button className="new-results" onClick={() => setFrozen(null)}>
            {newCount} new {newCount === 1 ? 'release' : 'releases'} arrived. Show everything in order
          </button>
        )}
        {visible.length === 0 ? (
          <div className="empty">
            {live ? (
              <p>Waiting for answers from the network…</p>
            ) : releases.length === 0 ? (
              <>
                <h2>Nobody shared a match</h2>
                <p>Try fewer words, or the artist name on its own. Soulseek matches every word you type.</p>
                {tab.search.responseCount === 0 && (
                  <p className="hint-text">
                    Not a single person answered. That usually means the Soulseek server blocks this name: some artists and
                    labels have asked for it, and every client then returns nothing for them.
                  </p>
                )}
              </>
            ) : (
              <>
                <h2>Filters hide all {releases.length} releases</h2>
                <button className="btn quiet small" onClick={() => setFilters(id, defaultFilters())}>
                  Clear filters
                </button>
              </>
            )}
          </div>
        ) : (
          <div style={{ height: v.getTotalSize(), position: 'relative' }}>
            {v.getVirtualItems().map((item) => {
              const r = visible[item.index];
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  ref={v.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${item.start - v.options.scrollMargin}px)`,
                  }}
                >
                  <ReleaseRow release={r} open={expanded.has(r.key)} onToggle={toggle} have={inLibrary(libIndex, r)} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What Download will do for this album: several people sending at once (fast), or a copy only one person
 * has. Download picks the group of identical copies that sends fastest together.
 */
/** "Sent a fake copy before": Check quality caught this person's files claiming more than they are. */
function FakeNote({ n }: { n: number }) {
  return (
    <span className="fake-note" title="Check quality found that an album you got from them wasn’t what it claimed (for example a FLAC made from an MP3). Their copies are ranked lower.">
      ⚠ sent {n === 1 ? 'a fake copy' : `${n} fake copies`} before
    </span>
  );
}

function TeamChip({ release }: { release: Release }) {
  const speeds = useStore((s) => s.speeds);
  const { copies, atOnce } = useMemo(() => sameFiles(release, bestStart(release)), [release, speeds]);
  if (atOnce >= 2)
    return (
      <span className="team-chip many" title={`${copies} people have exactly the same files. Download takes different tracks from ${atOnce} of them at once.`}>
        {atOnce} at once
      </span>
    );
  return (
    <span
      className="team-chip one"
      title={
        copies > 1
          ? `${copies} people have exactly these files, but only one can send right now. Others step in if it slows down.`
          : 'Nobody else has exactly these files, so it comes from one person. Speed depends on them.'
      }
    >
      {copies > 1 ? `${copies} identical, one at a time` : 'One source'}
    </span>
  );
}

function SameFilesCell({ release, r }: { release: Release; r: FolderResult }) {
  const { copies, atOnce } = sameFiles(release, r);
  if (copies <= 1) return <span className="dim" title="Nobody else has exactly these files">Only this one</span>;
  return (
    <span title={`${copies} people have exactly these files${atOnce >= 2 ? `; ${atOnce} could send at once` : ''}`}>
      {copies} people{atOnce >= 2 ? <span className="team-chip many small">{atOnce} at once</span> : null}
    </span>
  );
}

function useQueued(r: FolderResult) {
  return useStore((s) => r.files.every((f) => s.queuedKeys.has(`${r.username}\u0000${f.filename}`)));
}

function DownloadButton({ r, release, quiet, auto }: { r: FolderResult; release: Release; quiet?: boolean; auto?: boolean }) {
  const mine = useQueued(r);
  // The album's own button may start from another copy (the fastest identical group), so any copy queued counts.
  const any = useStore((s) => auto && release.sources.some((x) => x.files.every((f) => s.queuedKeys.has(`${x.username}\u0000${f.filename}`))));
  const queued = mine || any;
  // Asking the person for their whole folder takes a few seconds.
  const [asking, setAsking] = useState(false);
  return (
    <button
      className={`btn small ${quiet ? 'quiet' : ''} ${queued ? 'done' : ''}`}
      disabled={queued || asking}
      title={
        queued
          ? undefined
          : auto
            ? 'Download the fastest way: from up to three people with exactly the same files at once'
            : 'Download this copy, with help from people who have exactly the same files'
      }
      onClick={async () => {
        setAsking(true);
        try {
          await smartDownload(release, auto ? bestStart(release) : r);
        } finally {
          setAsking(false);
        }
      }}
    >
      {asking ? <span className="spinner" aria-hidden /> : <Icon name={queued ? 'check' : 'download'} size={16} />}
      {queued ? 'Queued' : asking ? 'Starting…' : 'Download'}
    </button>
  );
}

const NO_ALBUMS: LibAlbum[] = [];

export const ReleaseRow = memo(function ReleaseRow({
  release,
  open,
  onToggle,
  have = NO_ALBUMS,
}: {
  release: Release;
  open: boolean;
  onToggle: (key: string) => void;
  /** Copies of this album already in your library. */
  have?: LibAlbum[];
}) {
  const r = release.best;
  const better = betterThanYours(release, have);
  const others = release.sources.length - 1;
  const openProfile = useStore((s) => s.openProfile);
  const enqueue = useStore((s) => s.enqueue);
  const queuedKeys = useStore((s) => s.queuedKeys);
  const panelId = `rel-${r.key.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <article className={`release with-cover t-${r.tier}`}>
      <Cover className="release-cover" artist={r.parent} album={r.title} seed={release.key} />
      <div className="release-body">
      <div className="release-head">
        <div>
          <h2 className="release-title">
            <button aria-expanded={open} aria-controls={panelId} onClick={() => onToggle(release.key)}>
              {r.title}
            </button>
            {r.year && <span className="year">{r.year}</span>}
          </h2>
          {r.parent && <div className="release-artist">{r.parent}</div>}
          {have.length > 0 && (
            <div className={`in-library ${better ? 'better' : ''}`} title={have.map((a) => a.rel).join('\n')}>
              {better ? '↑ Better than yours: ' : '✓ In your library: '}
              {[...new Set(have.map(libraryLabel))].join(', ')}
            </div>
          )}
        </div>
        <div className="release-side">
          <span className="format">{r.format}</span>
          <DownloadButton r={r} release={release} auto />
        </div>
        <div className="meta">
          <button className="user-link" onClick={() => openProfile(r.username)} title={`About ${r.username}`}>
            {r.username}
          </button>
          {r.fakes ? <FakeNote n={r.fakes} /> : null}
          {r.partial ? (
            <span className="fake-note" title="Other people share more of this album. This copy sits below every complete one.">
              ⚠ only {r.partial.have} of {r.partial.of} tracks
            </span>
          ) : (
            <span>{r.audio.length} tracks</span>
          )}
          <span>{bytes(r.size)}</span>
          {r.length > 0 && <span>{duration(r.length)}</span>}
          <TeamChip release={release} />
          {r.hasFreeUploadSlot ? (
            <span className="slot-free">Free slot</span>
          ) : (
            <span className="slot-busy">{r.queueLength} in queue</span>
          )}
          <span className="muted">{speed(r.uploadSpeed)}</span>
          {r.locked > 0 && <span className="muted">{r.locked} locked</span>}
          {others > 0 && (
            <button className="link" onClick={() => onToggle(release.key)} aria-expanded={open} aria-controls={panelId}>
              {others} more {others === 1 ? 'source' : 'sources'}
            </button>
          )}
          {others === 0 && (
            <button className="link" onClick={() => onToggle(release.key)} aria-expanded={open} aria-controls={panelId}>
              {open ? 'Hide tracks' : 'Show tracks'}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="expand" id={panelId}>
          {others > 0 && (
            <div>
              <h3 className="subhead">Same release from other people</h3>
              <table className="sources">
                <thead>
                  <tr>
                    <th>From</th>
                    <th>Quality</th>
                    <th className="hide-sm">Size</th>
                    <th>Same files</th>
                    <th>Availability</th>
                    <th className="hide-sm">Speed</th>
                    <th><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody>
                  {release.sources.map((s) => (
                    <tr key={s.key} className={`t-${s.tier}`}>
                      <td>
                        <button className="user-link" onClick={() => openProfile(s.username)}>{s.username}</button>
                        {s.fakes ? <FakeNote n={s.fakes} /> : null}
                        {s.partial ? <span className="fake-note"> only {s.partial.have} of {s.partial.of} tracks</span> : null}
                      </td>
                      <td><span className="tier-cell">{s.format}</span></td>
                      <td className="hide-sm">{bytes(s.size)}</td>
                      <td><SameFilesCell release={release} r={s} /></td>
                      <td>{s.hasFreeUploadSlot ? 'Free slot' : `${s.queueLength} in queue`}</td>
                      <td className="hide-sm">{speed(s.uploadSpeed)}</td>
                      <td><DownloadButton r={s} release={release} quiet /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div>
            <h3 className="subhead">Tracks from {r.username}</h3>
            <ol className="tracks">
              {r.audio.map((f, i) => {
                const queued = queuedKeys.has(`${r.username}\u0000${f.filename}`);
                return (
                  <li key={f.filename} className={`track t-${tierOf(f)}`}>
                    <span className="no">{i + 1}</span>
                    <span className="name" title={basename(f.filename)}>{basename(f.filename).replace(/\.[^.]+$/, '')}</span>
                    <span className="dim">{f.length ? duration(f.length) : ''}</span>
                    <span className="dim size">{formatLabel(f)}, {bytes(f.size)}</span>
                    <button
                      className="icon-btn"
                      disabled={queued}
                      onClick={() => enqueue(r.username, [{ filename: f.filename, size: f.size }], basename(f.filename))}
                      aria-label={queued ? 'Queued' : `Download ${basename(f.filename)}`}
                    >
                      <Icon name={queued ? 'check' : 'download'} size={16} />
                    </button>
                  </li>
                );
              })}
            </ol>
            {r.extras > 0 && (
              <p className="subhead" style={{ marginTop: 8 }}>
                Also in the folder: {r.files.filter((f) => !r.audio.includes(f)).map((f) => basename(f.filename)).join(', ')}
              </p>
            )}
          </div>
        </div>
      )}
      </div>
    </article>
  );
});
