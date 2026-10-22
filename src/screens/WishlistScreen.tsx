import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { WISH_EVERY, checkWishNow } from '../lib/background';
import { TIERS, TIER_LABEL, toReleases, type Tier } from '../lib/quality';
import { usePrefs, type WishItem } from '../prefs';
import { useStore } from '../store';
import { ReleaseRow } from './SearchScreen';

const ago = (t?: number) => {
  if (!t) return 'not checked yet';
  const m = Math.round((Date.now() - t) / 60_000);
  if (m < 1) return 'checked just now';
  if (m < 60) return `checked ${m} min ago`;
  return `checked ${Math.round(m / 60)} h ago`;
};

const until = (t?: number) => {
  if (!t) return 'soon';
  const m = Math.max(0, Math.round((t + WISH_EVERY - Date.now()) / 60_000));
  return m < 1 ? 'in under a minute' : `in about ${m} min`;
};

export function WishlistScreen() {
  const wishlist = usePrefs((s) => s.wishlist);
  const addWish = usePrefs((s) => s.addWish);
  const [query, setQuery] = useState('');
  const [minTier, setMinTier] = useState<Tier | ''>('');
  const [selected, setSelected] = useState<string>();
  const [, rerender] = useState(0);

  // Keep the "checked 3 min ago" lines fresh.
  useEffect(() => {
    const t = setInterval(() => rerender((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  const open = wishlist.find((w) => w.id === selected) ?? wishlist.find((w) => w.unseen > 0) ?? wishlist[0];

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1 className="page-title">Wishlist</h1>
            <p className="page-sub">
              Searches that run again on their own and tell you when someone shares a new copy. Each one is checked about every{' '}
              {Math.round(WISH_EVERY / 60_000)} minutes while Nightjar is open.
            </p>
          </div>
        </div>

        <form
          className="wish-form"
          onSubmit={(e) => {
            e.preventDefault();
            const item = addWish(query, minTier || undefined);
            if (item) {
              setSelected(item.id);
              checkWishNow(item.id);
            }
            setQuery('');
          }}
        >
          <label htmlFor="wish-query" className="sr-only">
            What to look for
          </label>
          <input id="wish-query" className="input" placeholder="Artist and album you’re waiting for" value={query} onChange={(e) => setQuery(e.target.value)} />
          <label htmlFor="wish-tier" className="sr-only">
            Lowest quality to report
          </label>
          <select id="wish-tier" className="input select" value={minTier} onChange={(e) => setMinTier(e.target.value as Tier | '')}>
            <option value="">Any quality</option>
            {TIERS.filter((t) => t !== 'unknown' && t !== 'low').map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]} or better
              </option>
            ))}
          </select>
          <button className="btn" type="submit" disabled={!query.trim()}>
            <Icon name="star" size={16} /> Add
          </button>
        </form>

        {wishlist.length === 0 ? (
          <div className="empty">
            <h2>Nothing on your wishlist</h2>
            <p>
              Add something nobody shares yet, or a better copy than the ones you found. You can also add any search from its
              results page.
            </p>
          </div>
        ) : (
          <div className="wish-layout">
            <ul className="wish-list" aria-label="Wishlist">
              {wishlist.map((w) => (
                <li key={w.id}>
                  <button className="wish" aria-current={open?.id === w.id} onClick={() => setSelected(w.id)}>
                    <span className="wish-q">{w.query}</span>
                    {w.unseen > 0 && <span className="badge">{w.unseen} new</span>}
                    <span className="wish-meta">
                      {w.running ? (
                        <>
                          <span className="spinner" aria-hidden /> Checking now
                        </>
                      ) : (
                        `${w.minTier ? `${TIER_LABEL[w.minTier]}+, ` : ''}${ago(w.lastRunAt)}`
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {open && <WishDetail key={open.id} item={open} />}
          </div>
        )}
      </div>
    </div>
  );
}

function WishDetail({ item }: { item: WishItem }) {
  const updateWish = usePrefs((s) => s.updateWish);
  const removeWish = usePrefs((s) => s.removeWish);
  const search = useStore((s) => s.search);
  const releases = useMemo(() => toReleases(item.matches), [item.matches]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = useCallback(
    (key: string) =>
      setExpanded((s) => {
        const n = new Set(s);
        if (n.has(key)) n.delete(key);
        else n.add(key);
        return n;
      }),
    [],
  );

  // Looking at the results counts as having seen them.
  useEffect(() => {
    if (item.unseen > 0) {
      const t = setTimeout(() => updateWish(item.id, { unseen: 0 }), 1500);
      return () => clearTimeout(t);
    }
  }, [item.id, item.unseen, updateWish]);

  return (
    <section className="wish-detail" aria-label={`Results for ${item.query}`}>
      <div className="wish-detail-head">
        <h2>{item.query}</h2>
        <div className="head-actions">
          <button className="btn quiet small" disabled={item.running} onClick={() => checkWishNow(item.id)}>
            <Icon name="retry" size={16} /> Check now
          </button>
          <button className="btn quiet small" onClick={() => search(item.query)}>
            <Icon name="search" size={16} /> Full search
          </button>
          <button className="btn quiet small" onClick={() => removeWish(item.id)}>
            Remove
          </button>
        </div>
      </div>
      <p className="hint-text">
        {item.running ? 'Checking the network now…' : `${ago(item.lastRunAt)[0].toUpperCase()}${ago(item.lastRunAt).slice(1)}, next check ${until(item.lastRunAt)}.`}{' '}
        {item.seen.length > 0 && `${item.seen.length} copies seen so far.`}
      </p>
      {releases.length === 0 ? (
        <p className="callout">{item.lastRunAt ? 'No one shares a match yet. You’ll get a notification when someone does.' : 'The first check starts in a moment.'}</p>
      ) : (
        <>
          <h3 className="subhead">Best copies first</h3>
          {releases.map((r) => (
            <ReleaseRow key={r.key} release={r} open={expanded.has(r.key)} onToggle={toggle} />
          ))}
        </>
      )}
    </section>
  );
}
