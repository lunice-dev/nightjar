import { useEffect, useMemo, useRef, useState } from 'react';
import type { UserInfo, UserStatus } from '../api/types';
import { Icon } from './Icon';
import { bytes, speed } from '../lib/quality';
import { clock } from '../lib/transfers';
import { blockAndStop, setBlocked, useBlocked } from '../lib/blocking';
import { usePrefs } from '../prefs';
import { useStore } from '../store';

const DAY = 86_400_000;

/**
 * Everything about one person in one place, opened by clicking their name anywhere: what they say about
 * themselves, whether you'd get a slot, what has gone between you, and what you can do about them.
 */
export function ProfileCard() {
  const user = useStore((s) => s.profileUser);
  const close = useStore((s) => s.openProfile);
  useEffect(() => {
    if (!user) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(undefined);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, close]);
  if (!user) return null;
  return (
    <div className="modal-backdrop" onClick={() => close(undefined)}>
      <div className="modal profile-card" role="dialog" aria-label={`About ${user}`} onClick={(e) => e.stopPropagation()}>
        <Card key={user} user={user} onClose={() => close(undefined)} />
      </div>
    </div>
  );
}

function Card({ user, onClose }: { user: string; onClose: () => void }) {
  const backend = useStore((s) => s.backend);
  const me = useStore((s) => s.me);
  const browse = useStore((s) => s.browse);
  const message = useStore((s) => s.message);
  const measured = useStore((s) => s.speeds.get(user));
  const buddy = usePrefs((s) => s.buddies.find((b) => b.username === user));
  const isIgnored = usePrefs((s) => s.ignored.includes(user));
  const { addBuddy, removeBuddy, ignore, unignore, forgetFakes } = usePrefs.getState();
  const sent = usePrefs((s) => s.sent);
  const finished = usePrefs((s) => s.finished);
  const activity = usePrefs((s) => s.activity);
  const allFakes = usePrefs((s) => s.fakes);
  const blocked = useBlocked();
  const isBlocked = !!blocked.list?.includes(user);
  const [info, setInfo] = useState<UserInfo>();
  const [status, setStatus] = useState<UserStatus>();
  const [failed, setFailed] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const isMe = user === me;

  useEffect(() => {
    closeBtn.current?.focus();
    if (!backend) return;
    let alive = true;
    backend
      .userStatus(user)
      .then((s) => alive && setStatus(s))
      .catch(() => undefined);
    backend
      .userInfo(user)
      .then((i) => alive && setInfo(i))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [backend, user]);

  const history = useMemo(() => {
    const toThem = sent.filter((f) => f.user === user);
    const fromThem = finished.filter((a) => a.from.includes(user));
    const monthAgo = Date.now() - 30 * DAY;
    const theirs = activity.filter((e) => e.user === user && e.at > monthAgo);
    return {
      toThem: { files: toThem.length, bytes: toThem.reduce((n, f) => n + f.bytes, 0), last: toThem[0]?.at },
      fromThem: { albums: fromThem.length, last: fromThem[0] },
      looked: theirs.filter((e) => e.kind === 'browse' || e.kind === 'folder').length,
      refused: theirs.filter((e) => e.kind === 'refused').length,
    };
  }, [sent, finished, activity, user]);
  const fakes = allFakes.filter((f) => f.user === user);

  const presence = status?.presence;
  const picture = info?.picture ? `data:image/*;base64,${info.picture}` : undefined;
  const nothingBetween = !history.toThem.files && !history.fromThem.albums && !history.looked && !measured;

  return (
    <>
      <div className="pc-head">
        {picture ? <img className="avatar" src={picture} alt="" /> : <div className="avatar placeholder" aria-hidden>{user.slice(0, 1).toUpperCase()}</div>}
        <div className="pc-title">
          <h2>{user}</h2>
          <div className="profile-facts">
            {presence && (
              <span className="fact">
                <span className={`presence ${presence.toLowerCase()}`} aria-hidden /> {presence}
              </span>
            )}
            {status?.isPrivileged && <span className="fact">Privileged: jumps queues</span>}
            {buddy && <span className="pc-tag">In your people</span>}
            {isBlocked && <span className="pc-tag bad">Blocked</span>}
            {isIgnored && <span className="pc-tag">Ignored</span>}
          </div>
          {!isMe && info && (
            <div className="profile-facts dim">
              <span className="fact">{info.hasFreeUploadSlot ? 'Free upload slot now' : `${info.queueLength ?? 0} waiting in their queue`}</span>
              {info.uploadSlots !== undefined && <span className="fact">{info.uploadSlots} upload slots</span>}
            </div>
          )}
        </div>
        <button ref={closeBtn} className="icon-btn pc-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </div>

      {info?.description ? (
        <p className="bio pc-bio">{info.description}</p>
      ) : (
        <p className="bio pc-bio dim">{failed ? 'Couldn’t load their profile. They may be offline.' : info ? 'No description.' : 'Loading profile…'}</p>
      )}
      {buddy?.note && <p className="pc-note">Your note: {buddy.note}</p>}

      {!isMe && (
        <section className="pc-section" aria-label="Between you">
          <h3>Between you</h3>
          {nothingBetween ? (
            <p className="dim">Nothing yet, as far as Nightjar has kept count.</p>
          ) : (
            <ul className="pc-facts">
              {history.toThem.files > 0 && (
                <li>
                  Got <b>{bytes(history.toThem.bytes)}</b> from you ({history.toThem.files} {history.toThem.files === 1 ? 'file' : 'files'})
                  {history.toThem.last ? `, last ${clock(history.toThem.last)}` : ''}
                </li>
              )}
              {history.fromThem.albums > 0 && (
                <li>
                  You got <b>{history.fromThem.albums}</b> {history.fromThem.albums === 1 ? 'album' : 'albums'} from them
                  {history.fromThem.last ? `, last ${history.fromThem.last.title}` : ''}
                </li>
              )}
              {measured ? (
                <li>
                  Your downloads from them ran at <b>{speed(measured)}</b>
                </li>
              ) : null}
              {history.looked > 0 && (
                <li>
                  Looked around your share {history.looked} {history.looked === 1 ? 'time' : 'times'} in the last 30 days
                  {history.refused ? `, refused ${history.refused} ${history.refused === 1 ? 'time' : 'times'}` : ''}
                </li>
              )}
            </ul>
          )}
        </section>
      )}

      {fakes.length > 0 && (
        <section className="pc-section pc-fakes" aria-label="Fake copies">
          <h3>⚠ Sent you {fakes.length === 1 ? 'a fake copy' : `${fakes.length} fake copies`}</h3>
          <ul className="pc-facts">
            {fakes.slice(0, 4).map((f) => (
              <li key={f.dir}>
                {f.album}: <b>{f.verdict.toLowerCase()}</b>
              </li>
            ))}
          </ul>
          <p className="dim small">
            Their copies are ranked lower in search, and Download picks someone else when it can.{' '}
            <button className="link" onClick={() => forgetFakes({ user })}>
              Forget this
            </button>
          </p>
        </section>
      )}

      {confirmBlock && (
        <div className="confirm" role="alertdialog" aria-label={`Block ${user}`}>
          <span>Block {user}? They won’t be able to download from you, and anything still going to them stops now.</span>
          <button
            className="btn small danger"
            onClick={async () => {
              setConfirmBlock(false);
              await blockAndStop(user);
            }}
          >
            Block
          </button>
          <button className="btn quiet small" onClick={() => setConfirmBlock(false)}>
            Keep sharing
          </button>
        </div>
      )}

      <div className="pc-actions">
        <button className="btn small" onClick={() => browse(user)}>
          <Icon name="folder" size={16} /> {isMe ? 'Your shared files' : 'Browse their files'}
        </button>
        {!isMe && (
          <>
            <button className="btn quiet small" onClick={() => message(user)}>
              <Icon name="chat" size={16} /> Message
            </button>
            <button className="btn quiet small" aria-pressed={!!buddy} onClick={() => (buddy ? removeBuddy(user) : addBuddy(user))}>
              <Icon name={buddy ? 'check' : 'person'} size={16} /> {buddy ? 'In your people' : 'Add to people'}
            </button>
            {blocked.list && (
              <button
                className="btn quiet small"
                disabled={!blocked.editable}
                onClick={() => (isBlocked ? setBlocked(user, false) : setConfirmBlock(true))}
              >
                {isBlocked ? 'Unblock' : 'Block'}
              </button>
            )}
            <button className="btn quiet small" aria-pressed={isIgnored} onClick={() => (isIgnored ? unignore(user) : ignore(user))}>
              {isIgnored ? 'Stop ignoring' : 'Ignore'}
            </button>
          </>
        )}
      </div>
    </>
  );
}
