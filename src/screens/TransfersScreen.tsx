import { usePlayer } from '../lib/player';
import { AlbumPlay } from '../components/AlbumPlay';
import { onThisComputer } from '../api/remote';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Direction } from '../api/backend';
import { Icon } from '../components/Icon';
import { AUDIO_EXT, bytes, extOf, speed } from '../lib/quality';
import { clock, dayLabel, eta, fileName, groupDownloads, phaseOf, span, type DownloadGroup } from '../lib/transfers';
import type { LocalFiles, Transfer } from '../api/types';
import { failureReason } from '../lib/smart';
import { usePrefs, type ActivityEvent } from '../prefs';
import { useStore } from '../store';
import { useLocalFiles, groupCoverDir } from '../lib/useLocal';
import { Cover } from '../components/Cover';
import { dirOf, joinPath, localShareDir } from '../lib/covers';
import { uuid } from '../lib/uuid';
import { rescanSoon } from '../lib/shareVersion';
import { uploadStats } from '../lib/uploadStats';
import { OrganizeDialog } from '../components/Organize';
import { useFilesAvailable } from '../lib/files';
import type { RecentMove, WaitingAlbum } from '../api/library';
import { CheckButton, CheckResult, useQualityCheck } from '../components/QualityCheck';
import { blockAndStop, setBlocked, useBlocked } from '../lib/blocking';
import { keepDownloading } from '../lib/identityWatch';

const COPY = {
  download: {
    title: 'Downloads',
    verb: 'downloading',
    emptyTitle: 'No downloads yet',
    emptyText: 'Search for an album and choose Download. Everything you queue shows up here, grouped by album.',
    limitLabel: 'Download limit',
  },
  upload: {
    title: 'Uploads',
    verb: 'uploading',
    emptyTitle: 'Nobody is downloading from you right now',
    emptyText:
      'When people download from your shared folders, they show up here. Sharing is what keeps the network alive, and people with nothing shared often get put at the back of queues.',
    limitLabel: 'Upload limit',
  },
} as const;

export function TransfersScreen({ direction }: { direction: Direction }) {
  const list = useStore((s) => (direction === 'download' ? s.downloads : s.uploads));
  const plans = usePrefs((s) => s.plans);
  const groups = useMemo(() => groupDownloads(list, direction === 'download' ? plans : []), [list, plans, direction]);
  const backend = useStore((s) => s.backend);
  const refresh = useStore((s) => s.refreshTransfers);
  const go = useStore((s) => s.go);
  const copy = COPY[direction];
  const local = useLocalFiles(direction);

  const active = groups.filter((g) => g.phase === 'active');
  const queued = groups.filter((g) => g.phase === 'queued');
  // An album paused as the wrong one isn't finished: it waits for your answer.
  const ended = (g: DownloadGroup) => g.phase === 'done' || g.phase === 'cancelled';
  const failedGroups = groups.filter((g) => g.phase === 'failed' || (ended(g) && wrongAlbum(g)));
  // Finished: most recently ended first, so the newest is always at the top of its day.
  const done = groups
    .filter((g) => ended(g) && !wrongAlbum(g))
    .sort((a, b) => (b.endedAt || b.time) - (a.endedAt || a.time));
  const finished = [...failedGroups, ...done];
  const totalSpeed = active.reduce((s, g) => s + g.speed, 0);
  const where = useStore((s) => s.local);
  // Albums still arriving aren't offered for the library yet, and finished ones already have their own row above.
  const busyDirs = useMemo(
    () => new Set([...active, ...queued, ...done].map((g) => groupCoverDir(g, local, where.downloadDir)?.toLowerCase()).filter((d): d is string => !!d)),
    [active, queued, done, local, where.downloadDir],
  );

  const clear = async () => {
    await backend?.clearCompleted(direction);
    refresh(direction);
  };

  const summary = [
    active.length && (totalSpeed > 0 ? `${active.length} ${copy.verb} at ${speed(totalSpeed)}` : `${active.length} starting`),
    queued.length && `${queued.length} waiting`,
    failedGroups.length && `${failedGroups.length} with problems`,
    done.length && `${done.length} finished`,
  ].filter(Boolean);

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1 className="page-title">{copy.title}</h1>
            <p className="page-sub">{summary.length ? summary.join(', ') : 'Nothing yet'}</p>
          </div>
          <div className="head-actions">
            <SpeedLimit direction={direction} label={copy.limitLabel} />
            {finished.length > 0 && (
              <button className="btn quiet small" onClick={clear}>
                Clear finished
              </button>
            )}
          </div>
        </div>

        {direction === 'upload' && <UploadSummary />}

        {groups.length === 0 ? (
          <div className={direction === 'upload' ? 'empty compact' : 'empty'}>
            <h2>{copy.emptyTitle}</h2>
            <p>{copy.emptyText}</p>
            {direction === 'download' ? (
              <button className="btn small" onClick={() => go('search')}>
                <Icon name="search" size={16} /> Start a search
              </button>
            ) : (
              <button className="btn quiet small" onClick={() => go('settings')}>
                <Icon name="folder" size={16} /> Check what you share
              </button>
            )}
          </div>
        ) : (
          <>
            {(
              [
                [direction === 'upload' ? 'Uploading' : 'Downloading', active],
                ['Waiting', queued],
                ['Needs attention', failedGroups],
                ['Finished', done],
              ] as const
            ).map(([label, list]) =>
              list.length ? (
                <section key={label} className="dl-section" aria-label={label}>
                  <h2 className="dl-section-head">
                    {label} <span className="n">{list.length}</span>
                  </h2>
                  {label === 'Finished'
                    ? byDay(list).map(([day, items]) => (
                        <div key={day} className="dl-day-group">
                          <h3 className="dl-day">{day}</h3>
                          {items.map((g) => (
                            <TransferRow key={g.key} g={g} direction={direction} local={local} />
                          ))}
                        </div>
                      ))
                    : list.map((g) => <TransferRow key={g.key} g={g} direction={direction} local={local} />)}
                </section>
              ) : null,
            )}
          </>
        )}
        {direction === 'upload' && <UploadActivity />}
        {direction === 'download' && <NotInLibrary busy={busyDirs} />}
      </div>
    </div>
  );
}

/**
 * Your share in numbers: who is downloading from you now and how fast, the last week, and the speed Soulseek
 * shows others next to your name in their search results.
 */
function UploadSummary() {
  const uploads = useStore((s) => s.uploads);
  const sent = usePrefs((s) => s.sent);
  const backend = useStore((s) => s.backend);
  const [stats, setStats] = useState<{ averageSpeed: number; uploads: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => backend?.myStats().then((s) => alive && setStats(s)).catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [backend]);
  const s = useMemo(() => uploadStats(uploads, sent), [uploads, sent]);
  return (
    <section className="pulse uploads-pulse" aria-label="Your sharing in numbers">
      <article className="pulse-tile">
        <h3>Right now</h3>
        <p className="pulse-big">{s.now.people ? speed(s.now.speed) : 'Idle'}</p>
        <p className="pulse-sub">
          {s.now.people ? `${s.now.people} ${s.now.people === 1 ? 'person is' : 'people are'} downloading from you` : 'Nobody is downloading from you'}
          {s.now.waiting ? ` · ${s.now.waiting} ${s.now.waiting === 1 ? 'file' : 'files'} waiting` : ''}
        </p>
      </article>
      <article className="pulse-tile">
        <h3>This week</h3>
        <p className="pulse-big">
          {bytes(s.week.bytes)}
        </p>
        <p className="pulse-sub">
          {s.week.files} {s.week.files === 1 ? 'file' : 'files'} to {s.week.people} {s.week.people === 1 ? 'person' : 'people'}
        </p>
      </article>
      <article className="pulse-tile">
        <h3>Average speed</h3>
        <p className="pulse-big">{s.week.avgSpeed ? speed(s.week.avgSpeed) : '—'}</p>
        <p className="pulse-sub">How fast your uploads went this week</p>
      </article>
      <article className="pulse-tile" title="Soulseek measures this from your uploads and shows it next to your name in other people's search results. Faster sources get picked first.">
        <h3>What others see</h3>
        <p className="pulse-big">{stats?.averageSpeed ? speed(stats.averageSpeed) : '—'}</p>
        <p className="pulse-sub">Your speed in their search results{stats?.uploads ? ` · ${stats.uploads.toLocaleString()} uploads in total` : ''}</p>
      </article>
    </section>
  );
}

/**
 * Everything in your downloads folder that isn't in the library yet (the whole UNSORTED folder, including
 * albums downloaded before Nightjar), each with Put in library and Check quality, plus the latest moves to undo.
 */
function NotInLibrary({ busy }: { busy: Set<string> }) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const canFiles = useFilesAvailable();
  const [data, setData] = useState<{ albums: WaitingAlbum[]; recent: RecentMove[] } | null>(null);
  const [limit, setLimit] = useState(12);
  const load = useCallback(() => {
    backend?.library.waiting().then((d) => d && setData(d));
  }, [backend]);
  useEffect(() => {
    if (!canFiles) return;
    load();
    // An album put in the library from its row above changes this list too.
    window.addEventListener('nightjar-library-changed', load);
    return () => window.removeEventListener('nightjar-library-changed', load);
  }, [canFiles, load]);
  if (!canFiles || !data) return null;
  const albums = data.albums.filter((a) => !busy.has(a.dir.toLowerCase())).sort((a, b) => b.at - a.at);
  if (albums.length === 0 && data.recent.length === 0) return null;
  const undo = async (m: RecentMove) => {
    const r = await backend!.library.undo(m.id);
    if (r.ok) {
      usePrefs.getState().albumMoved(m.to, m.from);
      window.dispatchEvent(new Event('nightjar-library-undone'));
      rescanSoon(2000);
      toast(`Moved back to ${m.from}`);
    } else toast(r.error ?? 'Couldn’t undo it.', 'error');
    load();
  };
  return (
    <section className="dl-section library-section" aria-labelledby="unsorted-h">
      <h2 className="dl-section-head" id="unsorted-h">
        {albums.length ? (
          <>
            Also in your downloads folder, not in your library yet <span className="n">{albums.length}</span>
          </>
        ) : (
          'Your library'
        )}
      </h2>
      {albums.slice(0, limit).map((a) => (
        <WaitingRow key={a.dir} a={a} onMoved={load} />
      ))}
      {albums.length > limit && (
        <button className="btn quiet small" onClick={() => setLimit((l) => l + 24)}>
          Show more ({albums.length - limit})
        </button>
      )}
      {data.recent.length > 0 && (
        <details className="recent-moves">
          <summary>Recently put in your library ({data.recent.length})</summary>
          <ul>
            {data.recent.map((m) => (
              <li key={m.id}>
                <span className="path">{m.to}</span>
                <button className="link" onClick={() => undo(m)}>
                  Undo
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function WaitingRow({ a, onMoved }: { a: WaitingAlbum; onMoved: () => void }) {
  const [organizing, setOrganizing] = useState(false);
  const quality = useQualityCheck(a.dir);
  const searchFor = useStore((s) => s.search);
  return (
    <div className="waiting-row">
      <div className="waiting-head">
        <div className="waiting-title">
          <b>{a.name}</b>
          <small>
            {a.tracks} {a.tracks === 1 ? 'track' : 'tracks'} · {bytes(a.size)}
          </small>
        </div>
        <CheckButton check={quality} />
        <button className="btn quiet small" onClick={() => setOrganizing(true)}>
          Put in library
        </button>
      </div>
      <CheckResult check={quality} onFindAnother={() => searchFor(a.name.replace(/[\[(].*?[\])]/g, ' '))} />
      {organizing && <OrganizeDialog dir={a.dir} onClose={() => setOrganizing(false)} onMoved={onMoved} />}
    </div>
  );
}

/** Shows the current cap and lets you change it in place. */
function SpeedLimit({ direction, label }: { direction: Direction; label: string }) {
  const backend = useStore((s) => s.backend);
  const toast = useStore((s) => s.toast);
  const [limit, setLimit] = useState<number | null | undefined>(undefined);
  const [editable, setEditable] = useState(true);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const key = direction === 'upload' ? 'uploadLimit' : 'downloadLimit';

  useEffect(() => {
    backend
      ?.settings()
      .then((s) => {
        setLimit(s[key]);
        setEditable(s.editable);
      })
      .catch(() => setLimit(undefined));
  }, [backend, key]);

  if (limit === undefined) return null;

  const save = async (next: number | null) => {
    try {
      await backend?.saveSettings({ [key]: next });
      setLimit(next);
      setEditing(false);
      toast(next ? `${label} set to ${next} KB/s` : `${label} removed`);
    } catch (e) {
      toast(`Couldn't change the limit: ${(e as Error).message}`, 'error');
    }
  };

  if (!editing) {
    return (
      <button
        className="btn quiet small"
        onClick={() => {
          if (!editable) {
            toast('The engine is set to refuse changes from Nightjar. Turn on remote_configuration in data\\slskd.yml.', 'error');
            return;
          }
          setValue(limit ? String(limit) : '');
          setEditing(true);
        }}
      >
        {label}: {limit ? (limit >= 1024 ? `${+(limit / 1024).toFixed(1)} MB/s` : `${limit} KB/s`) : 'none'}
      </button>
    );
  }

  return (
    <form
      className="limit-form"
      onSubmit={(e) => {
        e.preventDefault();
        const n = parseInt(value, 10);
        save(Number.isFinite(n) && n > 0 ? n : null);
      }}
    >
      <label htmlFor={`limit-${direction}`} className="sr-only">
        {label} in KB/s
      </label>
      <input
        id={`limit-${direction}`}
        className="input small-input"
        inputMode="numeric"
        placeholder="No limit"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
        onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
      />
      <span className="unit">KB/s</span>
      <button className="btn small" type="submit">
        Save
      </button>
      <button className="btn quiet small" type="button" onClick={() => save(null)}>
        No limit
      </button>
    </form>
  );
}

/** Finished rows under Today / Yesterday / "Wed 22 Oct" headings, newest day first. */
function byDay(list: readonly DownloadGroup[]) {
  const days = new Map<string, DownloadGroup[]>();
  for (const g of list) {
    const d = dayLabel(g.endedAt || g.time);
    days.set(d, [...(days.get(d) ?? []), g]);
  }
  return [...days];
}

/** When it happened, in the words that matter for its state. The full date is in the tooltip. */
function whenLine(g: DownloadGroup, now: number): { text: string; at: number } | null {
  const asked = g.requestedAt || g.time;
  switch (g.phase) {
    case 'queued':
      return asked ? { text: `Asked ${clock(asked, now)} · waiting ${span(now - asked)}`, at: asked } : null;
    case 'active': {
      const t = g.startedAt || asked;
      if (!t) return null;
      const waited = g.startedAt && asked && g.startedAt - asked > 60_000 ? ` after waiting ${span(g.startedAt - asked)}` : '';
      return { text: `Started ${clock(t, now)}${waited}`, at: t };
    }
    case 'done': {
      const end = g.endedAt || asked;
      if (!end) return null;
      const took = g.startedAt && g.endedAt > g.startedAt ? ` · took ${span(g.endedAt - g.startedAt)}` : '';
      return { text: `${new Date(end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${took}`, at: end };
    }
    case 'failed':
    case 'cancelled': {
      const end = g.endedAt || asked;
      return end ? { text: `${g.phase === 'failed' ? 'Stopped' : 'Cancelled'} ${clock(end, now)}`, at: end } : null;
    }
  }
}

/** "FLAC · 14 tracks", "MP3 + FLAC · 3 tracks"; nothing for folders without music. */
function formatLine(g: DownloadGroup) {
  const exts = new Map<string, number>();
  for (const f of g.files) {
    const e = extOf(f.filename);
    if (AUDIO_EXT.has(e)) exts.set(e, (exts.get(e) ?? 0) + 1);
  }
  const tracks = [...exts.values()].reduce((a, b) => a + b, 0);
  if (!tracks) return '';
  const kinds = [...exts].sort((a, b) => b[1] - a[1]).map(([e]) => e.replace(/^\./, '').toUpperCase());
  return `${kinds.join(' + ')} · ${tracks} ${tracks === 1 ? 'track' : 'tracks'}`;
}

/** Re-renders every 30 s so "waiting 12 min" keeps counting. */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Paused because its files are another album: waiting for Delete it or Keep downloading. */
const wrongAlbum = (g: DownloadGroup) => g.plan?.identity?.state === 'mismatch';

function stateLine(g: DownloadGroup, direction: Direction) {
  if (direction === 'download' && wrongAlbum(g)) return 'Paused: waiting for your choice';
  const n = g.files.length;
  switch (g.phase) {
    case 'active':
      return `${g.counts.done} of ${n - g.counts.cancelled} files, ${g.speed > 0 ? speed(g.speed) : 'connecting…'}`;
    case 'queued':
      if (direction === 'upload') return g.placeInQueue ? `Waiting for a free upload slot, #${g.placeInQueue} in line` : 'Waiting for a free upload slot';
      if (g.usernames.length > 1) return g.placeInQueue ? `Waiting in ${g.usernames.length} queues, best position ${g.placeInQueue}` : 'Waiting to start';
      return g.placeInQueue ? `Waiting in ${g.username}'s queue, position ${g.placeInQueue}` : 'Waiting to start';
    case 'failed':
      return `${g.counts.failed} of ${n} files failed`;
    case 'done': {
      // How fast it went, weighted by size (most of an album is its tracks, not its cover).
      const sent = g.files.filter((f) => f.averageSpeed > 0 && f.bytesTransferred > 0);
      const weight = sent.reduce((n, f) => n + f.bytesTransferred, 0);
      const avg = weight ? sent.reduce((n, f) => n + f.averageSpeed * f.bytesTransferred, 0) / weight : 0;
      return avg ? `Finished at ${speed(avg)}` : 'Finished';
    }
    case 'cancelled':
      return 'Cancelled';
  }
}

function TransferRow({ g, direction, local }: { g: DownloadGroup; direction: Direction; local: LocalFiles }) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const backend = useStore((s) => s.backend);
  const refresh = useStore((s) => s.refreshTransfers);
  const enqueue = useStore((s) => s.enqueue);
  const openProfile = useStore((s) => s.openProfile);
  const message = useStore((s) => s.message);
  const toast = useStore((s) => s.toast);
  const notes = g.plan?.notes ?? NO_NOTES;
  const blockedList = useBlocked().list;
  const isBlocked = direction === 'upload' && !!blockedList?.includes(g.username);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const addBatch = usePrefs((s) => s.updatePlan);
  const canFiles = useFilesAvailable();
  const where = useStore((s) => s.local);
  const searchFor = useStore((s) => s.search);
  const [organizing, setOrganizing] = useState(false);
  const [movedTo, setMovedTo] = useState<string>();
  // An undo below puts the album back: forget where this row thought it went (the history has the new place).
  useEffect(() => {
    const reset = () => setMovedTo(undefined);
    window.addEventListener('nightjar-library-undone', reset);
    return () => window.removeEventListener('nightjar-library-undone', reset);
  }, []);
  const finishedEntry = usePrefs((s) => s.finished.find((a) => a.key === g.key));
  const now = useNow();
  const when = whenLine(g, now);
  const format = formatLine(g);
  // Uploads: what this person has had from you before (as far as Nightjar has kept count), not counting this album.
  const sentBefore = usePrefs((s) => s.sent);
  const before = useMemo(() => {
    if (direction !== 'upload') return null;
    const ids = new Set(g.files.map((f) => f.id));
    const mine = sentBefore.filter((f) => f.user === g.username && !ids.has(f.id));
    return mine.length ? { files: mine.length, bytes: mine.reduce((n, f) => n + f.bytes, 0), since: Math.min(...mine.map((f) => f.at)) } : null;
  }, [direction, g.files, g.username, sentBefore]);

  const pct = g.size ? Math.min(100, (g.transferred / g.size) * 100) : 0;
  const unfinished = g.files.filter((f) => ['active', 'queued'].includes(phaseOf(f.state)));
  const failed = g.files.filter((f) => phaseOf(f.state) === 'failed' || phaseOf(f.state) === 'cancelled');
  const saved = g.files.map((f) => local.get(f.id)).filter((p): p is string => !!p);
  // Where the album is now: its saved files' folder, or where it went in the library.
  const savedDir = saved.length ? dirOf(saved[0]) : undefined;

  // Group the reasons so "11 files: They no longer share this file" reads as one line.
  const reasons = new Map<string, number>();
  failed.forEach((f) => {
    const r = failureReason(f);
    if (r) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  });

  const cancelAll = async () => {
    await Promise.all(unfinished.map((f) => backend?.cancel(direction, f.username, f.id, false)));
    refresh(direction);
  };
  const retry = async () => {
    // Remove the dead entries first so the retried files don't appear twice.
    await Promise.all(failed.map((f) => backend?.cancel(direction, f.username, f.id, true)));
    const byUser = new Map<string, Transfer[]>();
    failed.forEach((f) => byUser.set(f.username, [...(byUser.get(f.username) ?? []), f]));
    for (const [user, files] of byUser) {
      const list = files.map((f) => ({ filename: f.filename, size: f.size }));
      if (g.plan && backend) await requeue(user, list);
      else enqueue(user, list, g.title);
    }
  };
  /** Back into the album's folder (or its disc folder), still looked after by the download manager. */
  const requeue = async (user: string, list: { filename: string; size: number }[]) => {
    const plan = g.plan!;
    const destOf = (filename: string) => plan.tracks.find((k) => k.username === user && k.filename === filename)?.dest ?? plan.destination;
    const batches = [...plan.batches];
    for (const dest of new Set(list.map((f) => destOf(f.filename)))) {
      const batchId = uuid();
      const ok = await backend!
        .enqueue(user, list.filter((f) => destOf(f.filename) === dest), { batchId, destination: dest })
        .then(() => true)
        .catch(() => false);
      if (!ok) {
        toast(`${user} is offline. Try another source.`, 'error');
        break;
      }
      batches.push(batchId);
    }
    addBatch(plan.id, { batches, finishedAt: undefined });
    refresh(direction);
  };
  // Tracks of the album that never arrived and aren't in the list any more (removed, or lost when the engine stopped).
  const planTracks = g.plan ? g.plan.tracks.filter((k) => !k.dropped) : [];
  const missing =
    direction === 'download' && g.plan
      ? planTracks.filter((k) => !g.files.some((f) => f.username === k.username && f.filename === k.filename))
      : [];
  const audioDone = g.files.filter((f) => AUDIO_EXT.has(extOf(f.filename)) && phaseOf(f.state) === 'done').length;
  // The copy itself is short: the person shares only part of the album.
  const shortCopy = direction === 'download' && !!g.plan?.expected && planTracks.length < g.plan.expected * 0.75;
  const getMissing = async () => {
    const byUser = new Map<string, { filename: string; size: number }[]>();
    missing.forEach((k) => byUser.set(k.username, [...(byUser.get(k.username) ?? []), { filename: k.filename, size: k.size }]));
    for (const [user, list] of byUser) await requeue(user, list);
  };
  const removeFromList = async (files: Transfer[]) => {
    await Promise.all(files.map((f) => backend?.cancel(direction, f.username, f.id, true)));
    refresh(direction);
  };
  const reveal = async (path: string) => {
    if (!(await backend?.files.reveal(path))) toast('Couldn’t open Explorer. The file may have been moved or deleted.', 'error');
  };
  // Everything this album left on disk: its folder (or the files it saved), and unfinished parts of the rest.
  const leftovers = useMemo(() => {
    const folders = new Set<string>();
    const dl = where.downloadDir;
    if (g.plan?.destination && dl) folders.add(joinPath(dl, g.plan.destination));
    else saved.forEach((p) => folders.add(dirOf(p)));
    const partials = g.files.filter((f) => phaseOf(f.state) !== 'done').map((f) => ({ user: f.username, file: f.filename }));
    return { folders: [...folders], files: saved, partials };
  }, [g, saved, where.downloadDir]);
  const trashAll = async () => {
    setConfirmDelete(false);
    const removed = await backend?.files.trashDownload(leftovers);
    if (removed == null) toast('Couldn’t reach the Nightjar app to delete files.', 'error');
    else toast(removed ? `Moved ${g.title} to the Recycle Bin` : 'Nothing was left on disk to delete', 'info');
    if (removed) {
      rescanSoon(3000); // stop offering deleted files to others
      usePrefs.getState().forgetFinished(g.key); // and it no longer counts as downloaded on the home page
    }
    await removeFromList(g.files.filter((f) => ['done', 'failed', 'cancelled'].includes(phaseOf(f.state))));
  };

  const albumDir = movedTo ?? (finishedEntry?.dir && savedDir && finishedEntry.dir.toLowerCase() !== savedDir.toLowerCase() ? finishedEntry.dir : savedDir);
  const inLibrary = !!movedTo || (!!albumDir && !!savedDir && albumDir.toLowerCase() !== savedDir.toLowerCase());
  const quality = useQualityCheck(albumDir);

  const barClass = g.phase === 'failed' ? 'bar failed' : g.phase === 'queued' && pct === 0 ? 'bar queued' : 'bar';
  const finished = unfinished.length === 0;
  // While the banner asks about a wrong album, its two buttons are the only way on: Retry would fetch the rest unasked.
  const asking = direction === 'download' && wrongAlbum(g);
  // Finished albums you moved or deleted outside Nightjar: say so instead of offering buttons that can't work.
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (direction !== 'download' || !finished || !albumDir || !backend) return;
    let alive = true;
    backend.folders.exists(albumDir).then((e) => alive && setGone(e === false));
    return () => {
      alive = false;
    };
  }, [direction, finished, albumDir, backend]);

  const coverDir = direction === 'download' ? groupCoverDir(g, local, where.downloadDir) : localShareDir(g.directory, where.roots);

  return (
    <section className="dl with-cover" aria-label={g.title}>
      {direction === 'download' && finished && albumDir && canFiles && !gone ? (
        <button className="cover-open" onClick={() => usePlayer.getState().openAlbum(albumDir)} aria-label={`Open ${g.title}`}>
          <Cover className="dl-cover" dir={coverDir} artist={g.parent} album={g.title} seed={g.key} />
        </button>
      ) : (
        <Cover className="dl-cover" dir={coverDir} artist={g.parent} album={g.title} seed={g.key} />
      )}
      <div className="dl-body">
      <div className="dl-head">
        <div>
          <h2 className="dl-title">{g.title}</h2>
          {g.parent && <div className="release-artist">{g.parent}</div>}
          {format && <div className="dl-format">{format}</div>}
        </div>
        <div className="dl-actions">
          {direction === 'download' && finished && albumDir && canFiles && !gone && (
            <AlbumPlay dir={albumDir} title={g.title} />
          )}
          {direction === 'upload' && coverDir && canFiles && onThisComputer && (
            <button className="btn quiet small" onClick={() => reveal(coverDir)} title={coverDir}>
              <Icon name="reveal" size={16} /> Show in folder
            </button>
          )}
          {direction === 'download' && saved.length > 0 && canFiles && !gone && onThisComputer && (
            <button className="btn quiet small" onClick={() => reveal(inLibrary && albumDir ? albumDir : saved[0])}>
              <Icon name="reveal" size={16} /> Show in folder
            </button>
          )}
          {direction === 'download' && finished && albumDir && canFiles && !gone && <CheckButton check={quality} />}
          {direction === 'download' && finished && albumDir && canFiles && !inLibrary && !gone && !asking && (
            <button className="btn quiet small" onClick={() => setOrganizing(true)}>
              Put in library
            </button>
          )}
          {direction === 'download' && failed.length > 0 && !asking && (
            <button className="btn quiet small" onClick={retry}>
              <Icon name="retry" size={16} /> Retry {failed.length === 1 ? 'file' : `${failed.length} files`}
            </button>
          )}
          {unfinished.length > 0 && (
            <button className="btn quiet small" onClick={cancelAll}>
              {direction === 'upload' ? 'Stop upload' : 'Cancel'}
            </button>
          )}
          {direction === 'download' && finished && (saved.length > 0 || failed.length > 0) && canFiles && !confirmDelete && !gone && !asking && (
            <button className="btn quiet small" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" size={16} /> Delete
            </button>
          )}
          {finished && saved.length === 0 && (direction === 'upload' || !canFiles) && (
            <button className="btn quiet small" onClick={() => removeFromList(g.files)}>
              Remove from list
            </button>
          )}
        </div>
      </div>
      {confirmBlock && (
        <div className="confirm" role="alertdialog" aria-label={`Block ${g.username}`}>
          <span>
            Block {g.username}? They won’t be able to download anything from you
            {unfinished.length ? `, and the ${unfinished.length} ${unfinished.length === 1 ? 'file' : 'files'} still going to them stop now` : ''}. You can undo
            this later.
          </span>
          <button
            className="btn small danger"
            onClick={async () => {
              setConfirmBlock(false);
              await blockAndStop(g.username);
            }}
          >
            Block
          </button>
          <button className="btn quiet small" onClick={() => setConfirmBlock(false)}>
            Keep sharing
          </button>
        </div>
      )}
      {isBlocked && (
        <p className="hint-text moved-line">
          {g.username} is blocked: they can’t download from you.{' '}
          <button className="link" onClick={() => setBlocked(g.username, false)}>
            Unblock
          </button>
        </p>
      )}
      {confirmDelete && (
        <div className="confirm" role="alertdialog" aria-label="Confirm delete">
          <span>
            {saved.length > 0
              ? `Move ${g.title} (${saved.length} downloaded ${saved.length === 1 ? 'file' : 'files'}${failed.length ? ' and the unfinished parts' : ''}) to the Recycle Bin?`
              : `Move the unfinished parts of ${g.title} to the Recycle Bin and remove it from the list?`}
          </span>
          <button className="btn small danger" onClick={trashAll}>
            Move to Recycle Bin
          </button>
          <button className="btn quiet small" onClick={() => setConfirmDelete(false)}>
            Keep
          </button>
        </div>
      )}
      {direction === 'download' && g.plan?.identity?.state === 'mismatch' && (
        <div className="confirm wrong-album" role="alert">
          <span>
            {g.plan.identity.test && (
              <>
                <b>Fake-album test:</b> nothing is wrong with this album; Nightjar acted as if it were. Keep downloading carries on and clears the
                mark.{' '}
              </>
            )}
            <b>This isn’t {g.plan.artist ? `${g.plan.artist} – ` : ''}{g.plan.title}.</b> The files’ own tags say{' '}
            <b>{[g.plan.identity.artist, g.plan.identity.album].filter(Boolean).join(' – ')}</b>. Nightjar paused it
            {g.plan.identity.user ? ` and will rank ${g.plan.identity.user}’s copies last in searches` : ''}.
          </span>
          <button
            className="btn small danger"
            onClick={async () => {
              const paused = g.plan?.identity?.paused ?? [];
              const removed = await backend?.files.trashDownload({
                ...leftovers,
                partials: [...leftovers.partials, ...paused.map((p) => ({ user: p.username, file: p.filename }))],
              });
              if (removed == null) toast('Couldn’t reach the Nightjar app to delete files.', 'error');
              else toast(`Moved ${g.title} to the Recycle Bin`, 'info');
              if (g.plan) usePrefs.getState().updatePlan(g.plan.id, { finishedAt: Date.now() });
              usePrefs.getState().forgetFinished(g.key);
              rescanSoon(3000);
              await removeFromList(g.files);
            }}
          >
            Delete it
          </button>
          <button className="btn quiet small" onClick={() => g.plan && keepDownloading(g.plan)}>
            Keep downloading
          </button>
        </div>
      )}
      <div
        className={barClass}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${g.title} progress`}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="dl-meta">
        {when && (
          <time className="dl-when" dateTime={new Date(when.at).toISOString()} title={new Date(when.at).toLocaleString()}>
            {when.text}
          </time>
        )}
        <span className={g.phase === 'failed' || (direction === 'download' && wrongAlbum(g)) ? 'state-failed' : g.phase === 'done' ? 'state-done' : ''}>
          {stateLine(g, direction)}
        </span>
        <span>
          {bytes(g.transferred)} of {bytes(g.size)}
        </span>
        {g.phase === 'active' && <span>{eta(g.size - g.transferred, g.speed)}</span>}
        <span>
          {direction === 'upload' ? 'to ' : 'from '}
          {g.usernames.map((u, i) => (
            <span key={u}>
              {i > 0 && (i === g.usernames.length - 1 ? ' and ' : ', ')}
              <button className="user-link" onClick={() => openProfile(u)}>
                {u}
              </button>
            </span>
          ))}
        </span>
        {direction === 'upload' && (
          <button className="link" onClick={() => message(g.username)}>
            Message
          </button>
        )}
        {direction === 'upload' && blockedList && !isBlocked && (
          <button className="link" onClick={() => setConfirmBlock(true)}>
            Block
          </button>
        )}
        {before && (
          <span className="dim" title={`Since ${new Date(before.since).toLocaleDateString()}, as far as Nightjar has kept count`}>
            {bytes(before.bytes)} from you before ({before.files} {before.files === 1 ? 'file' : 'files'})
          </span>
        )}
        <button className="link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide files' : `Show ${g.files.length} ${g.files.length === 1 ? 'file' : 'files'}`}
        </button>
      </div>
      {reasons.size > 0 && (
        <ul className="reasons">
          {[...reasons].map(([r, n]) => (
            <li key={r} className="state-failed">
              {n === g.files.length ? 'All files' : `${n} ${n === 1 ? 'file' : 'files'}`}: {r}
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && unfinished.length === 0 && g.plan?.identity?.state !== 'mismatch' && (
        <p className="incomplete-line">
          <b>Incomplete:</b> {audioDone} of {planTracks.length} tracks arrived.{' '}
          <button className="link" onClick={getMissing}>
            Get the {missing.length} missing {missing.length === 1 ? 'track' : 'tracks'}
          </button>
        </p>
      )}
      {shortCopy && (
        <p className="incomplete-line">
          <b>Not the whole album:</b> {g.usernames.join(', ')} shares only {planTracks.length} of its {g.plan!.expected} tracks.{' '}
          <button className="link" onClick={() => searchFor(`${g.parent} ${g.title}`)}>
            Find a complete copy
          </button>
        </p>
      )}
      {direction === 'download' && gone && <p className="hint-text moved-line">No longer in your downloads folder (moved or deleted outside Nightjar).</p>}
      {direction === 'download' && <CheckResult check={quality} onFindAnother={() => searchFor(`${g.parent} ${g.title}`)} />}
      {organizing && albumDir && <OrganizeDialog dir={albumDir} onClose={() => setOrganizing(false)} onMoved={(to) => setMovedTo(to)} />}
      {direction === 'download' && inLibrary && albumDir && !gone && <p className="hint-text moved-line">In your library: {albumDir}</p>}
      {notes.length > 0 && (
        <ul className="plan-notes">
          {notes.slice(-3).map((n) => (
            <li key={n.at}>{n.text}</li>
          ))}
        </ul>
      )}
      {open && (
        <ul className="dl-files">
          {g.files.map((f) => {
            const p = phaseOf(f.state);
            const pc = p === 'done' ? 100 : Math.round(f.percentComplete);
            const path = local.get(f.id);
            const reason = failureReason(f);
            return (
              <li key={f.id}>
                <span className="name" title={fileName(f)}>
                  {fileName(f)}
                  {g.usernames.length > 1 && <small className="from">{f.username}</small>}
                </span>
                <span className="dim">{bytes(f.size)}</span>
                <span>
                  {p === 'active' || p === 'done' ? (
                    <span className="mini" aria-label={`${pc}%`}>
                      <i style={{ width: `${pc}%` }} />
                    </span>
                  ) : (
                    <span className={p === 'failed' ? 'state-failed' : 'wait'} title={f.exception ?? undefined}>
                      {p === 'queued' ? (f.placeInQueue ? `#${f.placeInQueue} in queue` : 'Waiting') : reason ?? f.state.replace('Completed, ', '')}
                    </span>
                  )}
                </span>
                <span className="file-actions">
                  {p === 'active' || p === 'queued' ? (
                    <button
                      className="icon-btn"
                      aria-label={`Cancel ${fileName(f)}`}
                      onClick={async () => {
                        await backend?.cancel(direction, f.username, f.id, false);
                        refresh(direction);
                      }}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  ) : null}
                  {path && canFiles && (
                    <>
                      {onThisComputer && (
                        <button className="icon-btn" aria-label={`Show ${fileName(f)} in Explorer`} title="Show in Explorer" onClick={() => reveal(path)}>
                          <Icon name="reveal" size={16} />
                        </button>
                      )}
                      <button
                        className="icon-btn"
                        aria-label={`Move ${fileName(f)} to the Recycle Bin`}
                        title="Move to the Recycle Bin"
                        onClick={async () => {
                          if (await backend?.files.trash(path)) {
                            toast(`Moved ${fileName(f)} to the Recycle Bin`);
                            rescanSoon(3000);
                            removeFromList([f]);
                          } else toast('Couldn’t delete that file', 'error');
                        }}
                      >
                        <Icon name="trash" size={16} />
                      </button>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      </div>
    </section>
  );
}

const NO_NOTES: { at: number; text: string }[] = [];


/** Local paths of finished downloads, refreshed while the screen is open. */
const KIND_LABEL: Record<ActivityEvent['kind'], string> = {
  browse: 'Browsed',
  folder: 'Opened a folder',
  requested: 'Asked for files',
  uploaded: 'Downloaded',
  refused: 'Refused',
};

const FILTERS = [
  { id: 'all', label: 'Everything' },
  { id: 'downloads', label: 'Downloads' },
  { id: 'looking', label: 'Browsing' },
  { id: 'refused', label: 'Refused' },
] as const;

const humanRefusal = (d: string) =>
  d
    .replace('Queued limits exceeded', 'they reached your queue limit')
    .replace(/Weekly limits exceeded|Daily limits exceeded/, 'they reached your download limit for now')
    .replace(/(Weekly|Daily) failure limit met or exceeded/, 'too many of their downloads failed recently');

/** Just the time: the day is in the heading above it. */
const when = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Activity under Today / Yesterday / "Wed 22 Oct" headings, newest first. */
function feedByDay(list: ActivityEvent[]) {
  const days = new Map<string, ActivityEvent[]>();
  for (const e of list) {
    const d = dayLabel(e.at);
    days.set(d, [...(days.get(d) ?? []), e]);
  }
  return [...days];
}

/**
 * Everything other people do with your share, not just the uploads that are
 * running: who browsed, which folders they opened, what they asked for, what
 * they got, and who was refused.
 */
function UploadActivity() {
  const all = usePrefs((s) => s.activity);
  const clear = usePrefs((s) => s.clearActivity);
  const me = useStore((s) => s.me);
  const openProfile = useStore((s) => s.openProfile);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [limit, setLimit] = useState(30);

  const events = all.filter((e) => e.user !== me);
  const dayAgo = Date.now() - 86_400_000;
  const recent = events.filter((e) => e.at > dayAgo);
  const people = new Set(recent.map((e) => e.user)).size;
  const files = recent.filter((e) => e.kind === 'uploaded').length;
  const downloaders = new Set(recent.filter((e) => e.kind === 'uploaded').map((e) => e.user)).size;

  const shown = events.filter((e) =>
    filter === 'all'
      ? true
      : filter === 'downloads'
        ? e.kind === 'requested' || e.kind === 'uploaded'
        : filter === 'looking'
          ? e.kind === 'browse' || e.kind === 'folder'
          : e.kind === 'refused',
  );

  // How much happened each day in total, even when only part of the day is showing yet.
  const dayCounts = new Map<string, number>();
  for (const e of shown) dayCounts.set(dayLabel(e.at), (dayCounts.get(dayLabel(e.at)) ?? 0) + 1);

  return (
    <section className="activity" aria-labelledby="activity-h">
      <div className="activity-head">
        <div>
          <h2 id="activity-h">Activity on your share</h2>
          <p className="hint-text">
            {recent.length === 0
              ? 'Nobody has looked at your share yet in the last 24 hours.'
              : `Last 24 hours: ${people} ${people === 1 ? 'person' : 'people'} looked around, ${downloaders} downloaded ${files} ${files === 1 ? 'file' : 'files'}.`}
          </p>
        </div>
        {events.length > 0 && (
          <button className="link" onClick={clear}>
            Clear history
          </button>
        )}
      </div>
      <div className="tiers" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button key={f.id} className="chip plain" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="hint-text" style={{ marginTop: 12 }}>
          Nothing here yet. Nightjar records this while it’s open.
        </p>
      ) : (
        feedByDay(shown.slice(0, limit)).map(([day, items]) => (
        <div key={day} className="feed-day-group">
        <h3 className="dl-day">
          {day} <span className="n">{dayCounts.get(day)}</span>
        </h3>
        <ol className="feed">
          {items.map((e) => (
            <li key={e.id} className={`feed-item k-${e.kind}`}>
              <time dateTime={new Date(e.at).toISOString()} title={new Date(e.at).toLocaleString()}>
                {when(e.at)}
              </time>
              <button className="user-link" onClick={() => openProfile(e.user)}>
                {e.user}
              </button>
              <span className="feed-kind">{KIND_LABEL[e.kind]}</span>
              <span className="feed-detail" title={e.detail}>
                {e.kind === 'refused' ? humanRefusal(e.detail) : e.detail.replace(/^(Browsed|Opened|Asked for|Downloaded)\s*/, '')}
              </span>
            </li>
          ))}
        </ol>
        </div>
        ))
      )}
      {shown.length > limit && (
        <button className="btn quiet small" onClick={() => setLimit((l) => l + 50)}>
          Show more ({shown.length - limit} older)
        </button>
      )}
    </section>
  );
}
