import { useMemo } from 'react';
import { TIER_LABEL, bytes, speed, type Tier } from '../lib/quality';
import { groupDownloads } from '../lib/transfers';
import { uploadStats } from '../lib/uploadStats';
import { usePrefs } from '../prefs';
import { useStore } from '../store';

const WEEK = 7 * 24 * 3600_000;
const SHOWN: Tier[] = ['hires', 'lossless', 'high', 'mid', 'low'];

/**
 * The home page in numbers: your library and its quality, what came in this
 * week, who downloads from you, and how the connection is doing.
 */
export function Pulse() {
  const library = useStore((s) => s.library);
  const downloads = useStore((s) => s.downloads);
  const uploads = useStore((s) => s.uploads);
  const speeds = useStore((s) => s.speeds);
  const link = useStore((s) => s.link);
  const demo = useStore((s) => s.backend?.kind === 'demo');
  const plans = usePrefs((s) => s.plans);
  const go = useStore((s) => s.go);

  const history = usePrefs((s) => s.finished);
  const week = useMemo(() => {
    const since = Date.now() - WEEK;
    const live = groupDownloads(downloads, plans).filter((g) => g.phase === 'active' || g.phase === 'queued');
    // Finished albums come from the home page's history, so Clear finished in Downloads doesn't reset them.
    const done = history.filter((a) => a.at >= since);
    const got = done.reduce((n, a) => n + a.size, 0) + live.reduce((n, g) => n + g.transferred, 0);
    const now = live.filter((g) => g.phase === 'active').reduce((n, g) => n + g.speed, 0);
    return { done: done.length, active: live.length, got, now };
  }, [downloads, plans, history]);

  const sentFiles = usePrefs((s) => s.sent);
  const share = useMemo(() => uploadStats(uploads, sentFiles), [uploads, sentFiles]);
  const sharing = useMemo(() => {
    const since = Date.now() - WEEK;
    const people = new Set<string>();
    let sent = 0;
    let now = 0;
    for (const u of uploads)
      for (const d of u.directories)
        for (const f of d.files) {
          if (Date.parse(f.requestedAt) < since) continue;
          people.add(u.username);
          sent += f.bytesTransferred;
          if (f.state === 'InProgress') now += f.averageSpeed;
        }
    return { people: people.size, sent, now };
  }, [uploads]);

  const typical = useMemo(() => {
    const v = [...speeds.values()].filter((x) => x > 0).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : 0;
  }, [speeds]);

  const total = library ? SHOWN.reduce((n, t) => n + library.tiers[t], 0) : 0;
  const lossless = library && total ? Math.round(((library.tiers.hires + library.tiers.lossless) / total) * 100) : 0;

  return (
    <section className="pulse" aria-label="At a glance">
      <article className="pulse-tile wide">
        <h3>Your library</h3>
        {library ? (
          <>
            <p className="pulse-big">
              {library.albums.toLocaleString()} <small>albums</small>
            </p>
            <p className="pulse-sub">
              {library.tracks.toLocaleString()} tracks · {bytes(library.size)} · {lossless}% lossless or better
            </p>
            <div className="pulse-bar" role="img" aria-label={SHOWN.map((t) => `${TIER_LABEL[t]} ${library.tiers[t]}`).join(', ')}>
              {SHOWN.map((t) =>
                library.tiers[t] ? <i key={t} className={`t-${t}`} style={{ flexGrow: library.tiers[t] }} title={`${TIER_LABEL[t]}: ${library.tiers[t]}`} /> : null,
              )}
            </div>
          </>
        ) : (
          <p className="pulse-sub">Reading your shared folders…</p>
        )}
      </article>

      <button className="pulse-tile" onClick={() => go('downloads')}>
        <h3>This week</h3>
        <p className="pulse-big">
          {week.done} <small>{week.done === 1 ? 'album' : 'albums'}</small>
        </p>
        <p className="pulse-sub">
          {bytes(week.got)} received{week.active ? ` · ${week.active} in progress` : ''}
          {week.now > 0 ? ` · ${speed(week.now)}` : ''}
        </p>
      </button>

      <button className="pulse-tile" onClick={() => go('uploads')}>
        <h3>Sharing</h3>
        {share.now.people > 0 ? (
          <p className="pulse-big">{speed(share.now.speed)}</p>
        ) : (
          <p className="pulse-big">
            {Math.max(share.week.people, sharing.people)} <small>{Math.max(share.week.people, sharing.people) === 1 ? 'person' : 'people'}</small>
          </p>
        )}
        <p className="pulse-sub">
          {share.now.people > 0 ? `To ${share.now.people} ${share.now.people === 1 ? 'person' : 'people'} now · ` : ''}
          {bytes(Math.max(share.week.bytes, sharing.sent))} sent this week
          {share.week.avgSpeed ? ` · average ${speed(share.week.avgSpeed)}` : ''}
        </p>
      </button>

      <button className="pulse-tile" onClick={() => go('settings')}>
        <h3>Connection</h3>
        <p className={`pulse-big link-${demo ? 'online' : link.state}`}>
          <span className="pulse-dot" aria-hidden />
          {demo ? 'Sample' : link.state === 'online' ? 'Online' : link.state === 'connecting' ? 'Signing in' : 'Offline'}
        </p>
        <p className="pulse-sub">{typical ? `Your sources usually send at ${speed(typical)}` : 'Speeds show after your first downloads'}</p>
      </button>
    </section>
  );
}

